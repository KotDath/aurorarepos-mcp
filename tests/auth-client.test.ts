import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CookieJar } from 'tough-cookie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthClient } from '../src/auth/client.js';
import { AuthService } from '../src/auth/service.js';
import { SessionStore } from '../src/auth/store.js';
import { snapshot } from '../src/auth/session.js';
import { AuthError } from '../src/auth/errors.js';
import type { KeyStore } from '../src/auth/key-store.js';
import { AuroraClient, type Fetch } from '../src/aurora/client.js';
import { guest, json } from './helpers.js';

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const account = () => json({ success: true }, 200, { 'Set-Cookie': 'aurorarepos_session=SYNTHETIC_AUTH_COOKIE; Secure; HttpOnly; Path=/' });
function http() {
  return vi.fn<Fetch>(async (url) => {
    if (url.pathname === '/') return guest();
    if (url.pathname === '/api/applogin' || url.pathname === '/api/2fa/verify') return account();
    if (url.pathname === '/api/2fa/resend') return json({ success: true });
    if (url.pathname === '/api/getrole') return json('dev');
    throw new Error('Unexpected test endpoint');
  });
}
async function setup(fetch = http()) {
  const directory = await mkdtemp(join(tmpdir(), 'aurorarepos-login-test-')); directories.push(directory);
  let key: Buffer | null = null;
  const keys: KeyStore = {
    get: async () => key ? Buffer.from(key) : null,
    set: async (value) => { key = Buffer.from(value); }, delete: async () => { key = null; },
  };
  const store = new SessionStore(keys, directory);
  return { fetch, store, service: new AuthService(store, { fetch, minIntervalMs: 0 }) };
}

describe('account login and separate sessions', () => {
  it('bootstraps CSRF, logs in, verifies the protected endpoint and only then saves', async () => {
    const { service, store, fetch } = await setup();
    const client = await service.createLogin();
    expect(await client.begin('synthetic@example.com', 'SYNTHETIC_PASSWORD')).toEqual({ kind: 'ready' });
    expect(await store.load()).toBeNull();
    await service.finishLogin(client);
    const login = fetch.mock.calls.find(([url]) => url.pathname === '/api/applogin')!;
    expect(JSON.parse(login[1].body as string)).toEqual({ email: 'synthetic@example.com', password: 'SYNTHETIC_PASSWORD', code: null });
    expect(new Headers(login[1].headers).get('X-CSRF-TOKEN')).toBe('synthetic-csrf-secret');
    expect(fetch.mock.calls.at(-1)?.[0].pathname).toBe('/api/getrole');
    expect(JSON.stringify(await store.load())).toContain('SYNTHETIC_AUTH_COOKIE');
    expect(JSON.stringify(await store.load())).not.toMatch(/SYNTHETIC_PASSWORD|synthetic@example.com/);
    expect(await service.status()).toMatchObject({ state: 'stored', verified: false });
    expect(await service.status({ verify: true })).toMatchObject({ state: 'authenticated', verified: true });
  });
  it('keeps the temporary 2FA token in memory, supports explicit resend, verifies and saves', async () => {
    const { fetch, service, store } = await setup();
    fetch.mockResolvedValueOnce(guest()).mockResolvedValueOnce(json({ '2fa_required': true, method: 'email', token: 'SYNTHETIC_2FA_TOKEN', email: 'MUST_NOT_LEAK' }));
    const client = await service.createLogin();
    expect(await client.begin('synthetic@example.com', 'SYNTHETIC_PASSWORD')).toEqual({ kind: 'two_factor', method: 'email' });
    expect(fetch.mock.calls.some(([url]) => url.pathname === '/api/2fa/resend')).toBe(false);
    expect(await store.load()).toBeNull();
    await client.resend(); await client.verify('123456'); await service.finishLogin(client);
    const verify = fetch.mock.calls.find(([url]) => url.pathname === '/api/2fa/verify')!;
    expect(JSON.parse(verify[1].body as string)).toEqual({ code: '123456', token: 'SYNTHETIC_2FA_TOKEN' });
    expect(JSON.stringify(await store.load())).not.toMatch(/SYNTHETIC_2FA_TOKEN|SYNTHETIC_PASSWORD|123456|MUST_NOT_LEAK/);
    await expect(client.resend()).rejects.toMatchObject({ code: 'TWO_FACTOR_FAILED' });
  });
  it('never saves a session from a login HTTP 200 unless the protected check succeeds', async () => {
    const { service, store, fetch } = await setup(); const client = await service.createLogin();
    await client.begin('synthetic@example.com', 'SYNTHETIC_PASSWORD');
    fetch.mockResolvedValueOnce(json({ secret: 'MUST_NOT_LEAK' }, 401));
    await expect(service.finishLogin(client)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(await store.load()).toBeNull();
  });
  it('accepts a protected plain-text role while preserving JSON Accept and rejecting HTML', async () => {
    const { service, store, fetch } = await setup(); const client = await service.createLogin();
    await client.begin('synthetic@example.com', 'SYNTHETIC_PASSWORD');
    fetch.mockResolvedValueOnce(new Response('dev', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    await service.finishLogin(client); expect(await store.load()).not.toBeNull();
    expect(new Headers(fetch.mock.calls.at(-1)?.[1].headers).get('Accept')).toBe('application/json');
    fetch.mockResolvedValueOnce(new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(service.status({ verify: true })).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });
  it.each([401, 422, 500])('sanitizes login failure HTTP %s and does not retry credentials', async (status) => {
    const fetch = http(); fetch.mockResolvedValueOnce(guest()).mockResolvedValueOnce(json({ password: 'MUST_NOT_LEAK' }, status));
    const client = new AuthClient(undefined, { fetch, minIntervalMs: 0 });
    await expect(client.begin('synthetic@example.com', 'SYNTHETIC_PASSWORD')).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(fetch.mock.calls.filter(([url]) => url.pathname === '/api/applogin')).toHaveLength(1);
  });
  it('does not retry login after ambiguous network failure', async () => {
    const fetch = http(); fetch.mockResolvedValueOnce(guest()).mockRejectedValueOnce(new Error('SYNTHETIC_PASSWORD'));
    await expect(new AuthClient(undefined, { fetch, minIntervalMs: 0 }).begin('synthetic@example.com', 'SYNTHETIC_PASSWORD')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('never follows/forwards a login redirect and verifies known same-origin targets using GET', async () => {
    const { fetch, service, store } = await setup();
    fetch.mockResolvedValueOnce(guest()).mockResolvedValueOnce(new Response('', { status: 302, headers: { Location: '/application', 'Set-Cookie': 'aurorarepos_session=SYNTHETIC_AUTH_COOKIE; Secure; HttpOnly; Path=/' } }));
    const client = await service.createLogin(); await client.begin('synthetic@example.com', 'SYNTHETIC_PASSWORD'); await service.finishLogin(client);
    const login = fetch.mock.calls.find(([url]) => url.pathname === '/api/applogin')!;
    expect(login[1].redirect).toBe('manual'); expect(new Headers(login[1].headers).get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(fetch.mock.calls.some(([url]) => url.pathname === '/application')).toBe(false);
    expect(await store.load()).not.toBeNull();
  });
  it.each(['https://evil.example/', 'http://aurorarepos.ru/home', 'https://user:password@aurorarepos.ru/'])('ignores redirect Location %s and never claims authentication without a protected HTTPS check', async (location) => {
    const { fetch, service, store } = await setup();
    fetch.mockResolvedValueOnce(guest()).mockResolvedValueOnce(new Response('', { status: 302, headers: { Location: location } })).mockResolvedValueOnce(json({}, 401));
    const client = await service.createLogin(); await client.begin('synthetic@example.com', 'SYNTHETIC_PASSWORD');
    await expect(service.finishLogin(client)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(await store.load()).toBeNull(); expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.at(-1)?.[0].href).toBe('https://aurorarepos.ru/api/getrole');
    expect(fetch.mock.calls.at(-1)?.[1].method).toBe('GET');
  });
  it.each([301, 307, 308])('never forwards credentials on redirect status %s', async (status) => {
    const fetch = http(); fetch.mockResolvedValueOnce(guest()).mockResolvedValueOnce(new Response('', { status, headers: { Location: 'https://evil.example/' } }));
    await expect(new AuthClient(undefined, { fetch, minIntervalMs: 0 }).begin('synthetic@example.com', 'SYNTHETIC_PASSWORD')).rejects.toMatchObject({ code: 'REDIRECT_REJECTED' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('refreshes rejected login CSRF once without a general POST retry', async () => {
    const fetch = http(); fetch.mockResolvedValueOnce(guest()).mockResolvedValueOnce(json({}, 419)).mockResolvedValueOnce(guest()).mockResolvedValueOnce(account());
    expect(await new AuthClient(undefined, { fetch, minIntervalMs: 0 }).begin('synthetic@example.com', 'SYNTHETIC_PASSWORD')).toEqual({ kind: 'ready' });
    expect(fetch.mock.calls.filter(([url]) => url.pathname === '/api/applogin')).toHaveLength(2);
  });
  it.each([{}, { '2fa_required': true }, { success: false }, 'bad'])('fails closed on an unverified challenge/role response', async (response) => {
    const fetch = http(); fetch.mockResolvedValueOnce(guest()).mockResolvedValueOnce(json(response));
    const client = new AuthClient(undefined, { fetch, minIntervalMs: 0 });
    if (JSON.stringify(response) === '{}') {
      await client.begin('synthetic@example.com', 'SYNTHETIC_PASSWORD'); fetch.mockResolvedValueOnce(json(''));
      await expect(client.check()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    } else await expect(client.begin('synthetic@example.com', 'SYNTHETIC_PASSWORD')).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });
  it('does not send malformed credentials/codes and clears a canceled challenge', async () => {
    const fetch = http(), client = new AuthClient(undefined, { fetch, minIntervalMs: 0 });
    await expect(client.begin('not-email', 'password')).rejects.toThrow(AuthError);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(guest()).mockResolvedValueOnce(json({ '2fa_required': true, token: 'SYNTHETIC_2FA_TOKEN' }));
    await client.begin('synthetic@example.com', 'SYNTHETIC_PASSWORD');
    await expect(client.verify('abcd')).rejects.toMatchObject({ code: 'TWO_FACTOR_FAILED' });
    expect(fetch).toHaveBeenCalledTimes(2); client.cancel();
    await expect(client.verify('123456')).rejects.toMatchObject({ code: 'TWO_FACTOR_FAILED' });
  });
  it('reports 401 as expiry but 403 as access denial, without removing the local session', async () => {
    const { store, service, fetch } = await setup(); const jar = new CookieJar();
    jar.setCookieSync('aurorarepos_session=SYNTHETIC_AUTH_COOKIE; Secure; HttpOnly; Path=/', 'https://aurorarepos.ru'); await store.save(snapshot(jar));
    fetch.mockResolvedValueOnce(json({}, 401)); expect(await service.status({ verify: true })).toMatchObject({ state: 'expired', verified: true });
    fetch.mockResolvedValueOnce(json({}, 403)); expect(await service.status({ verify: true })).toMatchObject({ state: 'access_denied', verified: false });
    expect(await store.load()).not.toBeNull();
  });
  it('does not treat network errors as expiry or send account cookies through an anonymous client', async () => {
    const { service, store, fetch } = await setup(); const client = await service.createLogin(); await client.begin('synthetic@example.com', 'SYNTHETIC_PASSWORD'); await service.finishLogin(client);
    fetch.mockRejectedValue(new Error('MUST_NOT_LEAK'));
    await expect(service.status({ verify: true })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(await store.load()).not.toBeNull();
    const publicFetch = vi.fn<Fetch>(async () => json([])); await new AuroraClient({ fetch: publicFetch, minIntervalMs: 0 }).systems();
    expect(new Headers(publicFetch.mock.calls[0]?.[1].headers).get('Cookie')).toBeNull();
  });
});
