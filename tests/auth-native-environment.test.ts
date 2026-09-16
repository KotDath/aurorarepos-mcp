import { describe, expect, it, vi } from 'vitest';
import { discoverLinuxBus } from '../src/auth/native-environment.js';

const directory = { uid: 1000, mode: 0o700, isDirectory: () => true, isSocket: () => false, isSymbolicLink: () => false };
const socket = { uid: 1000, mode: 0o777, isDirectory: () => false, isSocket: () => true, isSymbolicLink: () => false };
describe('Linux native vault environment discovery', () => {
  it('finds only an existing owned session socket when stdio strips DBUS variables', async () => {
    const stat = vi.fn().mockResolvedValueOnce(directory).mockResolvedValueOnce(socket);
    expect(await discoverLinuxBus({ platform: 'linux', uid: 1000 }, stat)).toBe('unix:path=%2Frun%2Fuser%2F1000%2Fbus');
    expect(stat.mock.calls.map(([path]) => path)).toEqual(['/run/user/1000', '/run/user/1000/bus']);
  });
  it.each(['darwin', 'win32'])('does not discover/alter environments on %s', async (platform) => {
    const stat = vi.fn(); expect(await discoverLinuxBus({ platform, uid: 1000 }, stat)).toBeUndefined(); expect(stat).not.toHaveBeenCalled();
  });
  it('never overwrites an explicit bus address or guesses an unknown uid', async () => {
    const stat = vi.fn();
    expect(await discoverLinuxBus({ platform: 'linux', uid: 1000, address: 'unix:path=/custom/bus' }, stat)).toBeUndefined();
    expect(await discoverLinuxBus({ platform: 'linux', uid: undefined }, stat)).toBeUndefined(); expect(stat).not.toHaveBeenCalled();
  });
  it.each([
    { ...directory, uid: 0 }, { ...directory, mode: 0o755 }, { ...directory, isSymbolicLink: () => true },
  ])('rejects unsafe runtime directories', async (runtime) => {
    const stat = vi.fn().mockResolvedValueOnce(runtime).mockResolvedValueOnce(socket);
    expect(await discoverLinuxBus({ platform: 'linux', uid: 1000 }, stat)).toBeUndefined();
  });
  it.each([{ ...socket, uid: 0 }, { ...socket, isSocket: () => false }, { ...socket, isSymbolicLink: () => true }])('rejects unsafe runtime sockets', async (bus) => {
    const stat = vi.fn().mockResolvedValueOnce(directory).mockResolvedValueOnce(bus);
    expect(await discoverLinuxBus({ platform: 'linux', uid: 1000 }, stat)).toBeUndefined();
  });
  it('does not autolaunch a missing bus', async () => {
    expect(await discoverLinuxBus({ platform: 'linux', uid: 1000 }, vi.fn().mockRejectedValue(new Error('missing')))).toBeUndefined();
  });
});
