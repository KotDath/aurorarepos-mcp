import { CookieJar } from 'tough-cookie';
import { vi } from 'vitest';
import { DeveloperService } from '../src/developer/service.js';
import { SessionStore } from '../src/auth/store.js';
import { snapshot } from '../src/auth/session.js';
import type { Fetch } from '../src/aurora/client.js';
import { fixture, json } from './helpers.js';

export type TestRecord = { [key: string]: unknown };
export const apps = () => (fixture('my-apps') as { data: { data: TestRecord[] } }).data.data;
export const versions = () => (fixture('my-versions') as { data: { data: TestRecord[] } }).data.data;
export function page(rows: TestRecord[], url: URL) {
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
