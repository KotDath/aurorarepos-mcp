import { CookieJar } from 'tough-cookie';
import { vi } from 'vitest';
import { SessionStore } from '../src/auth/store.js';
import { snapshot } from '../src/auth/session.js';
import type { Fetch } from '../src/aurora/client.js';
import { WriteService } from '../src/writes/service.js';
import { WriteError } from '../src/writes/errors.js';
import type { AttemptJournal } from '../src/writes/journal.js';
import { apps, page } from './developer-helpers.js';
import { json } from './helpers.js';

export function writeBackend() {
  const state = { rows: apps(), role: 'dev', mode: 'ok', posts: 0 };
  const fetch = vi.fn<Fetch>(async (url, init) => {
    if (url.pathname === '/') return new Response('<meta name="csrf-token" content="SYNTHETIC_WRITE_CSRF">', { headers: { 'Content-Type': 'text/html' } });
    if (url.pathname === '/api/getrole') return new Response(state.role);
    if (url.pathname === '/api/application/appname' && init.method === 'POST') {
      state.posts++;
      if (state.mode === 'network') throw Error('PRIVATE_UPSTREAM_NETWORK_ERROR');
      if (state.mode === '419') return json({ message: 'PRIVATE_REJECTION' }, 419);
      if (state.mode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://evil.example/private' } });
      if (state.mode === 'invalid') return new Response('PRIVATE_INVALID_RESPONSE', { headers: { 'Content-Type': 'text/html' } });
      if (state.mode === 'stall') return new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => reject(Error('aborted')), { once: true }); });
      const input = JSON.parse(String(init.body)) as { id: number | ''; name: string };
      if (state.mode !== 'unchanged') {
        if (input.id === '') state.rows.push({ ...state.rows[0], id: 999, name: input.name, latest_app: null, slug: null });
        else { const app = state.rows.find((row) => row.id === input.id)!; app.name = input.name; app.updated_at = '2026-09-16T13:00:00Z'; }
      }
      return json({ success: true, message: 'PRIVATE_SUCCESS_TOKEN_CONTACT' });
    }
    if (url.pathname === '/api/application') return json(page(state.rows, url));
    const id = Number(url.pathname.match(/^\/api\/application\/(\d+)$/)?.[1]);
    if (id) return json(state.rows.find((row) => row.id === id));
    throw Error('Unexpected write test endpoint');
  });
  return { fetch, state };
}
export function memoryJournal() {
  const keys = new Set<string>();
  return { claim: vi.fn(async (key: string) => { if (keys.has(key)) throw new WriteError('WRITE_ALREADY_ATTEMPTED'); keys.add(key); }), keys };
}
export function setupWrites(directory: string, journal: AttemptJournal = memoryJournal(), now?: () => number, timeout = 30_000) {
  const { fetch, state } = writeBackend(), jar = new CookieJar();
  jar.setCookieSync('aurora_session=SYNTHETIC_WRITE_ACCOUNT_COOKIE; Secure; HttpOnly; Path=/', 'https://aurorarepos.ru');
  const session = snapshot(jar), store = new SessionStore(undefined, directory);
  const load = vi.spyOn(store, 'load').mockResolvedValue(session), save = vi.spyOn(store, 'save');
  return { service: new WriteService(store, { fetch, minIntervalMs: 0 }, journal, now, timeout), store, fetch, state, load, save, session };
}
