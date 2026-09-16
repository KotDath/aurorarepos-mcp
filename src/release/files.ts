import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { abortError } from '../aurora/gate.js';
import { ReleaseError } from './errors.js';
import { readRpm } from './rpm.js';

export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export function checkSignal(signal: AbortSignal): void { if (signal.aborted) throw abortError(signal); }
export function localAbsolute(value: string, platform = process.platform): boolean {
  const api = platform === 'win32' ? path.win32 : path.posix;
  return api.isAbsolute(value) && ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}
function sameIdentity(a: BigIntStats, b: BigIntStats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
export async function readPackage(file: string, signal: AbortSignal) {
  checkSignal(signal);
  if (!localAbsolute(file) || path.extname(file).toLowerCase() !== '.rpm' || path.basename(file).length > 255) throw new ReleaseError('FILE_NOT_ALLOWED');
  try {
    const canonical = await realpath(file), before = await lstat(canonical, { bigint: true });
    if (!before.isFile()) throw new ReleaseError('FILE_NOT_ALLOWED');
    if (before.size > BigInt(MAX_FILE_BYTES)) throw new ReleaseError('FILE_TOO_LARGE');
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
    checkSignal(signal);
    const handle = await open(canonical, flags);
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || !sameFile(before, opened)) throw new ReleaseError('FILE_CHANGED');
      const size = Number(opened.size);
      const read = async (position: number, length: number): Promise<Buffer> => {
        checkSignal(signal);
        if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0 || position + length > size) throw new ReleaseError('INVALID_RPM');
        const buffer = Buffer.alloc(length); let offset = 0;
        while (offset < length) {
          checkSignal(signal);
          const result = await handle.read(buffer, offset, length - offset, position + offset);
          if (result.bytesRead === 0) throw new ReleaseError('INVALID_RPM');
          offset += result.bytesRead;
        }
        checkSignal(signal); return buffer;
      };
      const metadata = await readRpm(read, size), hash = createHash('sha256');
      for (let position = 0; position < size; position += 64 * 1024) hash.update(await read(position, Math.min(64 * 1024, size - position)));
      if (!sameFile(opened, await handle.stat({ bigint: true })) || await realpath(file) !== canonical ||
        !sameFile(opened, await lstat(canonical, { bigint: true }))) throw new ReleaseError('FILE_CHANGED');
      checkSignal(signal);
      return { filename: path.basename(file), size_bytes: size, sha256: hash.digest('hex'), metadata, signature_verified: false as const, payload_verified: false as const };
    } finally { await handle.close(); }
  } catch (error) {
    checkSignal(signal);
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError('FILE_READ_FAILED');
  }
}
