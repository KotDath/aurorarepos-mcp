import { CookieJar } from 'tough-cookie';
import { describe, expect, it, vi } from 'vitest';
import { DeveloperService } from '../src/developer/service.js';
import { SessionStore } from '../src/auth/store.js';
import { snapshot } from '../src/auth/session.js';
import { AuthError } from '../src/auth/errors.js';
import type { Fetch } from '../src/aurora/client.js';
import { fixture, json } from './helpers.js';

type Record = { [key: string]: unknown };
const apps = () => (fixture('my-apps') as { data: { data: Record[] } }).data.data;
const versions = () => (fixture('my-versions') as { data: { data: Record[] } }).data.data;
function page(rows: Record[], url: URL) {
  const number = Number(url.searchParams.get('page')), size = Number(url.searchParams.get('pagination'));
  return { success: true, data: { current_page: number, per_page: size, last_page: Math.max(1, Math.ceil(rows.length / size)), total: rows.length, data: rows.slice((number - 1) * size, number * size) } };
}
export function developerBackend() {
  return vi.fn<Fetch>(async (url) => {
    if (url.pathname === '/api/getrole') return new Response('dev', { headers: { 'Content-Type': 'text/html' } });
    if (url.pathname === '/api/application') return json(page(apps(), url));
    if (url.pathname === '/api/application/201') return json(apps()[0]);
    if (url.pathname === '/api/application/ver') return json(page(versions(), url));
    if (url.pathname === '/api/application/appitem/301') return json(fixture('my-version'));
    throw new Error('Unexpected test endpoint');
  });
}
export function setupDeveloper(fetch = developerBackend(), timeout = 30_000) {
  const jar = new CookieJar(); jar.setCookieSync('aurora_session=SYNTHETIC_AUTH_COOKIE; Secure; HttpOnly; Path=/', 'https://aurorarepos.ru');
  const store = new SessionStore(); const load = vi.spyOn(store, 'load').mockResolvedValue(snapshot(jar));
  const save = vi.spyOn(store, 'save');
  return { service: new DeveloperService(store, { fetch, minIntervalMs: 0 }, timeout), fetch, load, save };
}

describe('caller-owned developer reads', () => {
  it('lists own apps with statuses, scheduling/beta flags, nullable draft slug and strict pagination', async () => {
    const { service, fetch, save } = setupDeveloper();
    const result = await service.listApps({ page_size: 2 });
    expect(result.pagination).toEqual({ page: 1, page_size: 2, total: 2, next_page: null });
    expect(result.apps[0]).toMatchObject({ id: 201, status: { code: 3, state: 'published' }, is_delayed: false });
    expect(result.apps[1]).toMatchObject({ id: 202, slug: null, status: { code: 0, state: 'draft' }, is_delayed: true, is_beta: true });
    expect(fetch.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/getrole', '/api/application']);
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/HIDDEN_SECRET|SYNTHETIC_PRIVATE|user_id|evil.example|token|email/);
  });
  it('establishes ownership from the first page before returning subsequent pages', async () => {
    const { service, fetch } = setupDeveloper(); const result = await service.listApps({ page: 2, page_size: 1 });
    expect(result.apps.map((app) => app.id)).toEqual([202]); expect(result.pagination).toMatchObject({ total: 2, next_page: null });
    expect(fetch.mock.calls.filter(([url]) => url.pathname === '/api/application').map(([url]) => url.searchParams.get('page'))).toEqual(['1', '2']);
  });
  it('finds membership before fetching app details and does not follow upstream links', async () => {
    const { service, fetch } = setupDeveloper(); const result = await service.app({ app_id: 201 });
    expect(result.app.id).toBe(201); expect(result.app.latest_release?.downloads.armv7hl?.url).toBe('https://aurorarepos.ru/rpm/synthetic-1.0-1.armv7hl.rpm');
    expect(fetch.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/getrole', '/api/application', '/api/application/201']);
    for (const [url, init] of fetch.mock.calls) { expect(url.origin).toBe('https://aurorarepos.ru'); expect(init.method).toBe('GET'); expect(init.redirect).toBe('error'); expect(new Headers(init.headers).get('Cookie')).toContain('SYNTHETIC_AUTH_COOKIE'); }
  });
  it('returns releases with correct app/OS/status and bounded package metadata', async () => {
    const { service } = setupDeveloper(); const result = await service.listVersions({ app_id: 201, page_size: 2 });
    expect(result.versions[0]).toMatchObject({ id: 301, app_id: 201, aurora_versions: [5], status: { code: 3, state: 'published' } });
    expect(result.versions[1]).toMatchObject({ id: 303, aurora_versions: [4, 5], status: { code: 0, state: 'draft' }, downloads: { armv7hl: null, aarch64: null } });
    expect(JSON.stringify(result)).not.toMatch(/HIDDEN_SECRET|SYNTHETIC_PRIVATE|token|email|evil.example/);
  });
  it('finds release membership before the edit-detail read; root id remains an app ID', async () => {
    const { service, fetch } = setupDeveloper(); const result = await service.version({ app_id: 201, version_id: 301 });
    expect(result.version.id).toBe(301); expect(result.version.app_id).toBe(201);
    expect(result.shared_app_description).toBe('Shared description'); expect(result.screenshots).toEqual(['https://aurorarepos.ru/image/synthetic.png']);
    expect(fetch.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/getrole', '/api/application', '/api/application/ver', '/api/application/appitem/301']);
    expect(JSON.stringify(result)).not.toMatch(/HIDDEN_SECRET|SYNTHETIC_PRIVATE|token|email|testers/);
  });
  it('does not confuse overall latest_app with an older selected release', async () => {
    const fetch = developerBackend();
    fetch.mockImplementation(async (url) => {
      if (url.pathname === '/api/getrole') return json('dev');
      if (url.pathname === '/api/application') return json(page(apps(), url));
      if (url.pathname === '/api/application/ver') return json(page(versions(), url));
      if (url.pathname === '/api/application/appitem/303') return json({ ...(fixture('my-version') as Record), ver: '1.1', system: 3 });
      throw Error('Unexpected endpoint');
    });
    const { service } = setupDeveloper(fetch); const result = await service.version({ app_id: 201, version_id: 303 });
    expect(result.version).toMatchObject({ id: 303, version: '1.1', status: { code: 0, state: 'draft' } });
  });
  it.each(['admin', 'user', 'publisher', 'unknown'])('refuses role %s before querying any private app catalog', async (role) => {
    const { service, fetch } = setupDeveloper(); fetch.mockResolvedValueOnce(json(role));
    await expect(service.listApps({})).rejects.toMatchObject({ code: 'OWNERSHIP_UNVERIFIED' }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['app', 'versions', 'version'])('never queries unverified app IDs (%s)', async (operation) => {
    const { service, fetch } = setupDeveloper();
    const work = operation === 'app' ? service.app({ app_id: 999 }) : operation === 'versions' ? service.listVersions({ app_id: 999 }) : service.version({ app_id: 999, version_id: 301 });
    await expect(work).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fetch.mock.calls.every(([url]) => url.pathname === '/api/getrole' || url.pathname === '/api/application')).toBe(true);
  });
  it('never queries a release ID absent from the owned app release list', async () => {
    const { service, fetch } = setupDeveloper(); await expect(service.version({ app_id: 201, version_id: 999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fetch.mock.calls.some(([url]) => url.pathname.includes('/appitem/'))).toBe(false);
  });
  it.each(['root_id', 'owner', 'latest_app_owner'])('fails closed on inconsistent app detail %s', async (kind) => {
    const { service, fetch } = setupDeveloper();
    const value = structuredClone(apps()[0]!); if (kind === 'root_id') value.id = 999; else if (kind === 'owner') value.user_id = 999; else (value.latest_app as Record).application_id = 999;
    fetch.mockResolvedValueOnce(json('dev')).mockResolvedValueOnce(json(page(apps(), new URL('https://aurorarepos.ru/?page=1&pagination=20')))).mockResolvedValueOnce(json(value));
    await expect(service.app({ app_id: 201 })).rejects.toMatchObject({ code: 'OWNERSHIP_UNVERIFIED' });
  });
  it('rejects a mixed-owner catalog before returning any data', async () => {
    const { service, fetch } = setupDeveloper(); const records = apps(); records[1]!.user_id = 999;
    fetch.mockResolvedValueOnce(json('dev')).mockResolvedValueOnce(json(page(records, new URL('https://aurorarepos.ru/?page=1&pagination=2'))));
    await expect(service.listApps({ page_size: 2 })).rejects.toMatchObject({ code: 'OWNERSHIP_UNVERIFIED' });
  });
  it.each(['application_id', 'nested_owner'])('rejects release ownership mismatch %s before detail fetch', async (kind) => {
    const { service, fetch } = setupDeveloper(); const records = versions();
    if (kind === 'application_id') records[0]!.application_id = 999; else (records[0]!.application as Record).user_id = 999;
    fetch.mockResolvedValueOnce(json('dev')).mockResolvedValueOnce(json(page(apps(), new URL('https://aurorarepos.ru/?page=1&pagination=20')))).mockResolvedValueOnce(json(page(records, new URL('https://aurorarepos.ru/?page=1&pagination=20'))));
    await expect(service.version({ app_id: 201, version_id: 301 })).rejects.toMatchObject({ code: 'OWNERSHIP_UNVERIFIED' });
    expect(fetch.mock.calls.some(([url]) => url.pathname.includes('/appitem/'))).toBe(false);
  });
  it('does not accept details for the latest release when an older release was requested', async () => {
    const { service, fetch } = setupDeveloper(); fetch.mockImplementation(async (url) => {
      if (url.pathname === '/api/getrole') return json('dev'); if (url.pathname === '/api/application') return json(page(apps(), url));
      if (url.pathname === '/api/application/ver') return json(page(versions(), url)); return json(fixture('my-version'));
    });
    await expect(service.version({ app_id: 201, version_id: 303 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it.each([401, 403])('preserves session/permission error HTTP %s and never relogs in', async (status) => {
    const { service, fetch, save } = setupDeveloper(); fetch.mockResolvedValueOnce(json({ token: 'HIDDEN_SECRET' }, status));
    await expect(service.listApps({})).rejects.toMatchObject({ code: status === 401 ? 'AUTH_REQUIRED' : 'ACCESS_DENIED' });
    expect(fetch).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled();
  });
  it('requires a stored session, distinguishes vault failure and reloads between calls', async () => {
    const { service, load, fetch } = setupDeveloper(); await service.listApps({}); load.mockResolvedValueOnce(null);
    await expect(service.app({ app_id: 201 })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    load.mockRejectedValueOnce(new AuthError('STORAGE_UNAVAILABLE'));
    await expect(service.listApps({})).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' }); expect(load).toHaveBeenCalledTimes(3); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([{ page_size: 21 }, { user_id: 999 }, { page: 0 }, { page: 10001 }, { token: 'HIDDEN_SECRET' }])('rejects invalid list input before vault/network', async (input) => {
    const { service, load, fetch } = setupDeveloper(); await expect(service.listApps(input)).rejects.toThrow(); expect(load).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5])('rejects invalid private ID %s before vault/network', async (id) => {
    const { service, load, fetch } = setupDeveloper(); await expect(service.version({ app_id: id, version_id: 301 })).rejects.toThrow(); expect(load).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('handles empty catalogs and pages beyond the end without inventing memberships', async () => {
    const { service, fetch } = setupDeveloper(); fetch.mockImplementation(async (url) => url.pathname === '/api/getrole' ? json('dev') : json(page([], url)));
    expect(await service.listApps({ page: 2 })).toEqual({ apps: [], pagination: { page: 2, page_size: 10, total: 0, next_page: null } });
    await expect(service.app({ app_id: 201 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it.each(['per_page', 'current_page', 'last_page', 'total', 'success'])('rejects inconsistent paginator %s', async (key) => {
    const { service, fetch } = setupDeveloper(); const value = page(apps(), new URL('https://aurorarepos.ru/?page=1&pagination=2'));
    if (key === 'success') value.success = false; else (value.data as unknown as Record)[key] = 999;
    fetch.mockResolvedValueOnce(json('dev')).mockResolvedValueOnce(json(value));
    await expect(service.listApps({ page_size: 2 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('preserves unknown status codes and distinguishes no release from a draft', async () => {
    const { service, fetch } = setupDeveloper(); const records = apps(); (records[0]!.latest_app as Record).status = '9'; records[1]!.latest_app = null;
    fetch.mockResolvedValueOnce(json('dev')).mockResolvedValueOnce(json(page(records, new URL('https://aurorarepos.ru/?page=1&pagination=2'))));
    const result = await service.listApps({ page_size: 2 }); expect(result.apps[0]?.status).toEqual({ code: 9, state: 'unknown' }); expect(result.apps[1]?.status).toEqual({ code: null, state: 'no_release' });
  });
  it('bounds membership scans and never fetches unverified detail after the bound', async () => {
    const records = Array.from({ length: 501 }, (_, index) => ({ ...apps()[0], id: index + 1000, latest_app: null }));
    const { service, fetch } = setupDeveloper(); fetch.mockImplementation(async (url) => url.pathname === '/api/getrole' ? json('dev') : json(page(records, url)));
    await expect(service.app({ app_id: 201 })).rejects.toMatchObject({ code: 'LOOKUP_LIMIT' }); expect(fetch).toHaveBeenCalledTimes(26);
    expect(fetch.mock.calls.some(([url]) => url.pathname.includes('/201'))).toBe(false);
  });
  it('propagates cancellation before vault access and bounds a stalled vault operation', async () => {
    const { service, load, fetch } = setupDeveloper(); const cancelled = new AbortController(); cancelled.abort();
    await expect(service.listApps({}, cancelled.signal)).rejects.toMatchObject({ code: 'CANCELLED' }); expect(load).not.toHaveBeenCalled();
    const timed = setupDeveloper(developerBackend(), 10); timed.load.mockImplementationOnce(() => new Promise(() => undefined));
    await expect(timed.service.listApps({})).rejects.toMatchObject({ code: 'TIMEOUT' }); expect(fetch).not.toHaveBeenCalled();
  });
});
