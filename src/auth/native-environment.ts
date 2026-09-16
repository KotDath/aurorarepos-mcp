import { lstat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join } from 'node:path';

type Options = { platform: string; uid: number | undefined; address?: string | undefined; runtimeDirectory?: string | undefined };
type Stat = Pick<Stats, 'uid' | 'mode' | 'isDirectory' | 'isSocket' | 'isSymbolicLink'>;

export async function discoverLinuxBus(options: Options, stat: (path: string) => Promise<Stat> = lstat): Promise<string | undefined> {
  if (options.platform !== 'linux' || options.address || options.uid === undefined) return undefined;
  const directory = options.runtimeDirectory || `/run/user/${options.uid}`;
  const path = join(directory, 'bus');
  try {
    const runtime = await stat(directory), bus = await stat(path);
    if (runtime.isSymbolicLink() || !runtime.isDirectory() || runtime.uid !== options.uid ||
      (runtime.mode & 0o077) !== 0 || bus.isSymbolicLink() || !bus.isSocket() || bus.uid !== options.uid) return undefined;
    // A local user-owned session bus only; never autolaunch/connect to a remote bus.
    return `unix:path=${encodeURIComponent(path)}`;
  } catch { return undefined; }
}
export async function prepareNativeEnvironment(): Promise<void> {
  const address = await discoverLinuxBus({
    platform: process.platform, uid: process.getuid?.(),
    address: process.env.DBUS_SESSION_BUS_ADDRESS, runtimeDirectory: process.env.XDG_RUNTIME_DIR,
  });
  // stdio hosts often sanitize env. Discover only the existing owned runtime
  // socket, without replacing an explicit configuration or changing OS state.
  if (address && !process.env.DBUS_SESSION_BUS_ADDRESS) process.env.DBUS_SESSION_BUS_ADDRESS = address;
}
