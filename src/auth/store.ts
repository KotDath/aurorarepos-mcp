import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import envPaths from 'env-paths';
import { z } from 'zod';
import { AuthError } from './errors.js';
import { NativeKeyStore, type KeyStore } from './key-store.js';
import { parseSession, type Session } from './session.js';

const MAX_BYTES = 256 * 1024;
const AAD = Buffer.from('aurorarepos-mcp:session:v1:default:https://aurorarepos.ru');
const base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const envelopeSchema = z.strictObject({ version: z.literal(1), nonce: base64, tag: base64, ciphertext: base64 });
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
async function removeIfPresent(path: string): Promise<void> {
  try { await unlink(path); } catch (error) { if (!missing(error)) throw error; }
}

export class SessionStore {
  readonly directory: string;
  private readonly path: string;
  constructor(private readonly keys: KeyStore = new NativeKeyStore(), directory = join(envPaths('aurorarepos-mcp', { suffix: '' }).data, 'auth')) {
    this.directory = directory;
    this.path = join(directory, 'session.enc.json');
  }
  private async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' &&
      ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw new AuthError('STORAGE_UNAVAILABLE');
  }
  private async readEncrypted(): Promise<Buffer | null> {
    let handle;
    try {
      const stat = await lstat(this.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new AuthError('SESSION_INVALID');
      handle = await open(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total > MAX_BYTES) throw new AuthError('SESSION_INVALID');
      return buffer.subarray(0, total);
    } catch (error) { if (missing(error)) return null; throw error; }
    finally { await handle?.close(); }
  }
  private decode(bytes: Buffer, key: Buffer): Session {
    try {
      const envelope = envelopeSchema.parse(JSON.parse(bytes.toString('utf8')));
      const nonce = Buffer.from(envelope.nonce, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
      if (nonce.length !== 12 || tag.length !== 16 || key.length !== 32) throw new AuthError('SESSION_INVALID');
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(AAD); decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
      try { return parseSession(JSON.parse(plaintext.toString('utf8'))); }
      finally { plaintext.fill(0); }
    } catch { throw new AuthError('SESSION_INVALID'); }
  }
  async load(): Promise<Session | null> {
    let key: Buffer | null = null;
    try {
      await this.prepare();
      // Distinguish a locked/unavailable vault from an absent local session.
      key = await this.keys.get();
      const bytes = await this.readEncrypted();
      if (!bytes) return null;
      if (!key) throw new AuthError('SESSION_INVALID');
      return this.decode(bytes, key);
    } catch (error) { throw error instanceof AuthError ? error : new AuthError('STORAGE_UNAVAILABLE'); }
    finally { key?.fill(0); }
  }
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    await this.prepare();
    const path = join(this.directory, 'session.lock');
    let lock;
    try { lock = await open(path, 'wx', 0o600); }
    catch (error) { throw new AuthError((error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 'STORAGE_BUSY' : 'STORAGE_UNAVAILABLE'); }
    try { return await work(); }
    finally { await lock.close(); await unlink(path); }
  }
  async save(raw: Session): Promise<void> {
    const session = parseSession(raw);
    try {
      await this.locked(async () => {
        let key = await this.keys.get();
        const path = join(this.directory, `session-${randomUUID()}.tmp`);
        try {
          const existing = await this.readEncrypted();
          if (existing) {
            if (!key) throw new AuthError('SESSION_INVALID');
            this.decode(existing, key); // Never silently replace an undecryptable session.
          }
          if (!key) { key = randomBytes(32); await this.keys.set(key); }
          const plaintext = Buffer.from(JSON.stringify(session));
          let envelope: Buffer;
          try {
            if (plaintext.length > MAX_BYTES / 2) throw new AuthError('SESSION_INVALID');
            const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
            cipher.setAAD(AAD);
            const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            envelope = Buffer.from(JSON.stringify({ version: 1, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
          } finally { plaintext.fill(0); }
          const handle = await open(path, 'wx', 0o600);
          try { await handle.writeFile(envelope); await handle.sync(); }
          finally { await handle.close(); }
          await rename(path, this.path);
        } finally {
          key?.fill(0);
          await removeIfPresent(path);
        }
      });
    } catch (error) { throw error instanceof AuthError ? error : new AuthError('STORAGE_UNAVAILABLE'); }
  }
  async clear(): Promise<void> {
    try {
      await this.locked(async () => {
        // Don't remove ciphertext while the vault cannot even be accessed.
        try { const key = await this.keys.get(); key?.fill(0); }
        catch (error) { if (!(error instanceof AuthError) || error.code !== 'SESSION_INVALID') throw error; }
        try { await unlink(this.path); } catch (error) { if (!missing(error)) throw error; }
        await this.keys.delete();
      });
    } catch (error) { throw error instanceof AuthError ? error : new AuthError('STORAGE_UNAVAILABLE'); }
  }
}
