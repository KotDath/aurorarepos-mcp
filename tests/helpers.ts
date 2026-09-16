import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import type { Fetch } from '../src/aurora/client.js';

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as unknown;
}
export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
export const guest = () => new Response('<meta name="csrf-token" content="synthetic-csrf-secret">', {
  headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'aurorarepos_session=synthetic-cookie-secret; Secure; HttpOnly; Path=/' },
});
export function backend() {
  return vi.fn<Fetch>(async (url) => {
    if (url.pathname === '/') return guest();
    if (url.pathname === '/api/site/app') return json(fixture('catalog'));
    if (url.pathname === '/api/site/appitem') return json(fixture('app'));
    if (url.pathname === '/api/system/any') return json(fixture('systems'));
    if (url.pathname.startsWith('/api/site/category/')) return json(fixture('categories'));
    if (url.pathname.startsWith('/api/site/author/')) return json(fixture('author'));
    throw new Error('Unexpected test endpoint');
  });
}
