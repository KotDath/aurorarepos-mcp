import { AuthError } from './errors.js';
import { prepareNativeEnvironment } from './native-environment.js';

export interface KeyStore {
  get(): Promise<Buffer | null>;
  set(key: Buffer): Promise<void>;
  delete(): Promise<void>;
}

export class NativeKeyStore implements KeyStore {
  // Lazy loading keeps anonymous stdio startup working without an OS vault.
  private async entry() {
    try {
      await prepareNativeEnvironment();
      const { AsyncEntry } = await import('@napi-rs/keyring');
      return new AsyncEntry('aurorarepos-mcp', 'session-key-v1-default', { linux: { store: 'secret-service' } });
    } catch { throw new AuthError('STORAGE_UNAVAILABLE'); }
  }
  async get(): Promise<Buffer | null> {
    try {
      const value = await (await this.entry()).getPassword(AbortSignal.timeout(10_000));
      // Native bindings can return null instead of undefined for a missing entry.
      if (value == null) return null;
      if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new AuthError('SESSION_INVALID');
      const key = Buffer.from(value, 'base64');
      if (key.length !== 32) throw new AuthError('SESSION_INVALID');
      return key;
    } catch (error) { throw error instanceof AuthError ? error : new AuthError('STORAGE_UNAVAILABLE'); }
  }
  async set(key: Buffer): Promise<void> {
    if (key.length !== 32) throw new AuthError('SESSION_INVALID');
    try { await (await this.entry()).setPassword(key.toString('base64'), AbortSignal.timeout(10_000)); }
    catch { throw new AuthError('STORAGE_UNAVAILABLE'); }
  }
  async delete(): Promise<void> {
    try { await (await this.entry()).deleteCredential(AbortSignal.timeout(10_000)); }
    catch { throw new AuthError('STORAGE_UNAVAILABLE'); }
  }
}
