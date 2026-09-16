import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { vi } from 'vitest';
import { SessionStore } from '../src/auth/store.js';
import { snapshot } from '../src/auth/session.js';
import type { Fetch } from '../src/aurora/client.js';
import { rawVersion } from '../src/developer/schemas.js';
import { editorSchema } from '../src/writes/release-schemas.js';
import { ReleaseWriteService } from '../src/writes/releases.js';
import { memoryJournal } from './write-helpers.js';
import { syntheticRpm } from './release-helpers.js';
import { apps, page, versions } from './developer-helpers.js';
import { json } from './helpers.js';

export async function setupReleaseWrites(directory: string, journal = memoryJournal(), now?: () => number, timeout?: number) {
  const rpm32_path = join(directory, 'ru.example.Test-1.2.3-1.armv7hl.rpm'), rpm64_path = join(directory, 'ru.example.Test-1.2.3-1.aarch64.rpm');
  await writeFile(rpm32_path, syntheticRpm().bytes); await writeFile(rpm64_path, syntheticRpm({ arch: 'aarch64' }).bytes);
  const state = { role: 'dev', mode: 'ok', posts: 0, editor: editorSchema.parse({ ...apps()[0], icon: '/image/icon/test.png',
    site: 'https://example.invalid/PRIVATE_SITE', donate: 'https://example.invalid/PRIVATE_DONATE', email: 'PRIVATE@example.invalid',
    screenshots: [{ id: 401, application_id: 201, src: '/image/screen/test.png' }], validator: 'checked', notoff: '', newcomment: 'Published notes' }),
    versions: [rawVersion.parse({ ...versions()[0], newcomment: 'Published notes', rpm32: '/rpm/ru.example.Test-1.0-1.armv7hl.rpm', rpm64: null })] };
  const fetch = vi.fn<Fetch>(async (url, init) => {
    if (url.pathname === '/') return new Response('<meta name="csrf-token" content="SYNTHETIC_RELEASE_CSRF">', { headers: { 'Content-Type': 'text/html' } });
    if (url.pathname === '/api/getrole') return new Response(state.role);
    if (url.pathname === '/api/application' && init.method === 'POST') {
      state.posts++;
      if (state.mode === 'network') throw Error('PRIVATE_NETWORK_ERROR');
      if (state.mode === '419') return json({ message: 'PRIVATE_REJECTION' }, 419);
      if (state.mode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } });
      if (state.mode === 'stall') return new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => reject(Error('aborted')), { once: true }); });
      if (state.mode === 'unchanged') return json({ success: true });
      const form = init.body as FormData;
      for (const field of ['name', 'description', 'site', 'email', 'donate', 'icon', 'newcomment'] as const) state.editor[field] = String(form.get(field));
      state.editor.category_id = Number(form.get('cat_id')); state.editor.is_delayed = form.get('is_delayed') === 'true'; state.editor.publish_at = String(form.get('publish_at'));
      state.editor.ver = String(form.get('ver')); state.editor.release = String(form.get('release')); state.editor.system = Number(form.get('system'));
      const id = form.has('id') ? Number(form.get('id')) : 999;
      let version = state.versions.find((row) => row.id === id);
      if (!version) { version = rawVersion.parse({ id, application_id: 201, system: state.editor.system, ver: state.editor.ver, release: state.editor.release, status: 1 }); state.versions.push(version); }
      version.newcomment = state.editor.newcomment;
      for (const [field, slot, digest] of [['file_rpm', 'rpm32', 'sha256_32'], ['file_rpm64', 'rpm64', 'sha256_64']] as const) {
        const file = form.get(field);
        if (file instanceof Blob) {
          version[slot] = `/rpm/${(file as File).name}`;
          version[digest] = createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
        }
      }
      if (state.mode === 'bad-hash') version.sha256_32 = 'b'.repeat(64);
      if (state.mode === 'erase-contact') state.editor.email = '';
      return json({ success: true, message: 'PRIVATE_CONTACT_TOKEN_SUCCESS' });
    }
    if (url.pathname === '/api/application') return json(page([{ ...state.editor, latest_app: state.versions.at(-1) }], url));
    if (url.pathname === '/api/application/201' || url.pathname === '/api/application/name/201') return json({ ...state.editor, latest_app: state.versions.at(-1) });
    if (url.pathname === '/api/application/ver') return json(page(state.versions, url));
    const match = url.pathname.match(/^\/api\/application\/appitem\/(\d+)$/);
    if (match) { const version = state.versions.find((row) => row.id === Number(match[1])); return json({ ...state.editor, ver: version?.ver, release: version?.release, system: version?.system, newcomment: version?.newcomment }); }
    throw Error('Unexpected release test endpoint');
  });
  const jar = new CookieJar(); jar.setCookieSync('aurora_session=SYNTHETIC_RELEASE_SESSION; Secure; HttpOnly; Path=/', 'https://aurorarepos.ru');
  const session = snapshot(jar), store = new SessionStore(undefined, directory);
  const load = vi.spyOn(store, 'load').mockResolvedValue(session), save = vi.spyOn(store, 'save');
  return { service: new ReleaseWriteService(store, { fetch, minIntervalMs: 0 }, journal, now, timeout), store, fetch, state, journal, load, save,
    args: { app_id: 201, rpm32_path, rpm64_path, aurora_versions: [5], release_notes: 'New translation & clear-chat behaviour' } };
}
