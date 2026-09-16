import { lstat, mkdir, open, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { WriteError } from './errors.js';

export interface AttemptJournal { claim(key: string): Promise<void> }
// Empty, immutable attempt markers: hashes only, no account payloads/paths.
// Keep ambiguous/successful attempts across restarts; never silently delete.
export class FileAttemptJournal implements AttemptJournal {
  constructor(private readonly directory: string) {}
  async claim(key: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new WriteError('WRITE_JOURNAL_UNAVAILABLE');
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' &&
        ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw new WriteError('WRITE_JOURNAL_UNAVAILABLE');
      const entries = await opendir(this.directory); let count = 0;
      for await (const entry of entries) { if (entry.name && ++count >= 4096) throw new WriteError('WRITE_JOURNAL_UNAVAILABLE'); }
      const handle = await open(join(this.directory, `${key}.attempt`), 'wx', 0o600);
      try { await handle.sync(); } finally { await handle.close(); }
    } catch (error) {
      if (error instanceof WriteError) throw error;
      throw new WriteError((error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 'WRITE_ALREADY_ATTEMPTED' : 'WRITE_JOURNAL_UNAVAILABLE');
    }
  }
}
