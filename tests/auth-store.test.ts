import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CookieJar } from 'tough-cookie';
import { SessionStore } from '../src/auth/store.js';
import { AuthError } from '../src/auth/errors.js';
import { parseSession, restore, snapshot } from '../src/auth/session.js';
import type { KeyStore } from '../src/auth/key-store.js';

class MemoryKeys implements KeyStore {
  key: Buffer | null = null;
  available = true;
  async get() { if (!this.available) throw new AuthError('STORAGE_UNAVAILABLE'); return this.key ? Buffer.from(this.key) : null; }
  async set(key: Buffer) { this.key = Buffer.from(key); }
  async delete() { this.key = null; }
}
const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'aurorarepos-auth-test-')); directories.push(directory);
  const keys = new MemoryKeys(), store = new SessionStore(keys, directory);
  const jar = new CookieJar();
  jar.setCookieSync('aurora_session=SYNTHETIC_ACCOUNT_SECRET; Secure; HttpOnly; Path=/', 'https://aurorarepos.ru');
  return { directory, keys, store, session: snapshot(jar) };
}

describe('encrypted cross-platform session storage', () => {
  it('encrypts, restores cookies and removes only the session/key on logout', async () => {
    const { directory, keys, store, session } = await setup();
    expect(await store.load()).toBeNull();
    await store.save(session);
    const bytes = await readFile(join(directory, 'session.enc.json'));
    expect(bytes.toString()).not.toContain('SYNTHETIC_ACCOUNT_SECRET');
    expect(bytes.toString()).not.toContain('aurora_session');
    expect(keys.key?.length).toBe(32);
    expect(await store.load()).toEqual(session);
    expect(restore((await store.load())!).getCookieStringSync('https://aurorarepos.ru')).toContain('SYNTHETIC_ACCOUNT_SECRET');
    await store.clear();
    expect(await store.load()).toBeNull(); expect(keys.key).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });
  it('uses new nonces and atomically replaces the encrypted file without temp leftovers', async () => {
    const { directory, store, session } = await setup();
    await store.save(session); const before = await readFile(join(directory, 'session.enc.json'), 'utf8');
    await store.save(session); const after = await readFile(join(directory, 'session.enc.json'), 'utf8');
    expect(before).not.toBe(after); expect(await store.load()).toEqual(session);
    expect(await readdir(directory)).toEqual(['session.enc.json']);
  });
  it('does not mistake a locked vault for a logged-out account or use a file fallback', async () => {
    const { directory, keys, store, session } = await setup(); keys.available = false;
    await expect(store.load()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    await expect(store.save(session)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(await readdir(directory)).toEqual([]);
  });
  it.each(['tag', 'nonce', 'ciphertext', 'version'])('rejects tampered %s and preserves the original file on save', async (field) => {
    const { directory, store, session } = await setup(); await store.save(session);
    const path = join(directory, 'session.enc.json'), envelope = JSON.parse(await readFile(path, 'utf8'));
    envelope[field] = field === 'version' ? 2 : Buffer.from('tampered').toString('base64');
    const tampered = JSON.stringify(envelope); await writeFile(path, tampered);
    await expect(store.load()).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    await expect(store.save(session)).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    expect(await readFile(path, 'utf8')).toBe(tampered);
    expect(await readdir(directory)).toEqual(['session.enc.json']);
  });
  it('fails closed on a missing/wrong key rather than overwriting the session', async () => {
    const { directory, keys, store, session } = await setup(); await store.save(session);
    const before = await readFile(join(directory, 'session.enc.json'), 'utf8');
    keys.key = randomBytes(32);
    await expect(store.load()).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    keys.key = null;
    await expect(store.save(session)).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    expect(await readFile(join(directory, 'session.enc.json'), 'utf8')).toBe(before);
  });
  it('bounds reads and rejects corrupted JSON', async () => {
    const { directory, keys, store } = await setup(); keys.key = randomBytes(32);
    const path = join(directory, 'session.enc.json');
    for (const bytes of [Buffer.from('{'), Buffer.alloc(256 * 1024 + 1)]) {
      await writeFile(path, bytes); await expect(store.load()).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    }
  });
  it('rejects an existing lock without changing the session', async () => {
    const { directory, store, session } = await setup(); await writeFile(join(directory, 'session.lock'), '');
    await expect(store.save(session)).rejects.toMatchObject({ code: 'STORAGE_BUSY' });
    await expect(store.clear()).rejects.toMatchObject({ code: 'STORAGE_BUSY' });
    expect(await readdir(directory)).toEqual(['session.lock']);
  });
  it.skipIf(process.platform === 'win32')('uses private POSIX modes and rejects unsafe directories/symlink files', async () => {
    const { directory, store, session } = await setup(); await store.save(session);
    const path = join(directory, 'session.enc.json');
    expect((await lstat(directory)).mode & 0o777).toBe(0o700);
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    await chmod(directory, 0o755); await expect(store.load()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    await chmod(directory, 0o700); await rm(path); await symlink(join(directory, 'absent'), path);
    await expect(store.load()).rejects.toMatchObject({ code: 'SESSION_INVALID' });
  });
  it('validates saved sessions and rejects off-origin cookies/unknown envelope payload fields', async () => {
    const { session } = await setup();
    expect(() => parseSession({ ...session, password: 'DO_NOT_STORE' })).toThrow(AuthError);
    expect(() => parseSession({ ...session, cookies: [{ ...session.cookies[0], domain: 'evil.example' }] })).toThrow(AuthError);
    expect(() => parseSession({ ...session, cookies: [] })).toThrow(AuthError);
  });
});
