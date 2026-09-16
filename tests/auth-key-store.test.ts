import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const methods = { getPassword: vi.fn(), setPassword: vi.fn(), deleteCredential: vi.fn() };
  const constructor = vi.fn(function () { return methods; });
  return { methods, constructor };
});
vi.mock('@napi-rs/keyring', () => ({ AsyncEntry: mocks.constructor }));
vi.mock('../src/auth/native-environment.js', () => ({ prepareNativeEnvironment: async () => undefined }));
import { NativeKeyStore } from '../src/auth/key-store.js';

beforeEach(() => { vi.resetAllMocks(); mocks.constructor.mockImplementation(function () { return mocks.methods; }); });
describe('native cross-platform vault adapter', () => {
  it('pins Linux Secret Service and round-trips only a base64 encryption key', async () => {
    const store = new NativeKeyStore(), key = randomBytes(32);
    await store.set(key);
    expect(mocks.constructor).toHaveBeenCalledWith('aurorarepos-mcp', 'session-key-v1-default', { linux: { store: 'secret-service' } });
    expect(mocks.methods.setPassword).toHaveBeenCalledWith(key.toString('base64'), expect.any(AbortSignal));
    mocks.methods.getPassword.mockResolvedValue(key.toString('base64'));
    expect(await store.get()).toEqual(key);
    await store.delete(); expect(mocks.methods.deleteCredential).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it.each([undefined, null])('treats missing native entry %s as absent', async (value) => {
    mocks.methods.getPassword.mockResolvedValue(value); expect(await new NativeKeyStore().get()).toBeNull();
  });
  it.each(['bad', '', false])('rejects malformed native encryption key %s', async (value) => {
    mocks.methods.getPassword.mockResolvedValue(value);
    await expect(new NativeKeyStore().get()).rejects.toMatchObject({ code: 'SESSION_INVALID' });
  });
  it('fails closed on an unavailable backend/locked vault without exposing native errors', async () => {
    mocks.constructor.mockImplementation(() => { throw new Error('MUST_NOT_LEAK'); });
    await expect(new NativeKeyStore().get()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    mocks.constructor.mockImplementation(function () { return mocks.methods; });
    mocks.methods.getPassword.mockRejectedValue(new Error('MUST_NOT_LEAK'));
    const error = await new NativeKeyStore().get().catch((e: unknown) => e);
    expect(JSON.stringify(error)).not.toContain('MUST_NOT_LEAK');
    mocks.methods.deleteCredential.mockRejectedValue(new Error('MUST_NOT_LEAK'));
    await expect(new NativeKeyStore().delete()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });
});
