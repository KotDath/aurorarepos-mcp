import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { abortError } from '../aurora/gate.js';
import { ReleaseError } from './errors.js';
import { readRpm } from './rpm.js';

export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export type Root = { declared: string; canonical: string; identity: BigIntStats };
export function checkSignal(signal: AbortSignal): void { if (signal.aborted) throw abortError(signal); }
export function localAbsolute(value: string, platform = process.platform): boolean {
  const api = platform === 'win32' ? path.win32 : path.posix;
  if (!api.isAbsolute(value) || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || value.split(/[\\/]/).some((part) => part === '.' || part === '..')) return false;
  if (platform === 'win32') return /^[A-Za-z]:[\\/]/.test(value) && !value.slice(2).includes(':') &&
    !value.slice(3).split(/[\\/]/).some((part) => /[ .]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
  return !value.includes('\\') && !value.startsWith('//');
}
function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
function sameIdentity(a: BigIntStats, b: BigIntStats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && b.nlink === 1n;
}
export function envRoots(): unknown {
  const raw = process.env.AURORAREPOS_RPM_ROOTS;
  if (!raw) return [];
  if (raw.length > 32 * 1024) throw new ReleaseError('INVALID_FILE_POLICY');
  try { return JSON.parse(raw) as unknown; } catch { throw new ReleaseError('INVALID_FILE_POLICY'); }
}
export async function allowedRoots(raw: unknown, signal: AbortSignal): Promise<Root[]> {
  checkSignal(signal);
  if (!Array.isArray(raw) || raw.length > 8 || raw.some((value) => typeof value !== 'string' || value.length > 4096 || !localAbsolute(value))) throw new ReleaseError('INVALID_FILE_POLICY');
  if (raw.length === 0) throw new ReleaseError('FILE_ACCESS_DISABLED');
  const roots: Root[] = [];
  try {
    const userHome = await realpath(homedir());
    for (const value of raw as string[]) {
      checkSignal(signal);
      const declared = path.normalize(value), canonical = await realpath(declared), identity = await lstat(canonical, { bigint: true });
      if (!identity.isDirectory() || canonical === path.parse(canonical).root || path.relative(userHome, canonical) === '') throw new ReleaseError('INVALID_FILE_POLICY');
      roots.push({ declared, canonical, identity });
    }
  } catch (error) { if (error instanceof ReleaseError) throw error; checkSignal(signal); throw new ReleaseError('INVALID_FILE_POLICY'); }
  return roots;
}
async function inspect(root: Root, file: string, signal: AbortSignal): Promise<BigIntStats> {
  checkSignal(signal);
  const base = within(root.declared, file) ? root.declared : root.canonical;
  if (!within(base, file)) throw new ReleaseError('FILE_NOT_ALLOWED');
  if (await realpath(root.declared) !== root.canonical || !sameIdentity(root.identity, await lstat(root.canonical, { bigint: true }))) throw new ReleaseError('FILE_CHANGED');
  let cursor = base;
  const parts = path.relative(base, file).split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    checkSignal(signal); cursor = path.join(cursor, parts[i]!);
    const stat = await lstat(cursor, { bigint: true });
    if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) throw new ReleaseError('FILE_NOT_ALLOWED');
    if (i === parts.length - 1 && (!stat.isFile() || stat.nlink !== 1n)) throw new ReleaseError('FILE_NOT_ALLOWED');
  }
  const canonical = await realpath(file);
  if (!within(root.canonical, canonical)) throw new ReleaseError('FILE_NOT_ALLOWED');
  checkSignal(signal);
  return lstat(file, { bigint: true });
}
export async function readPackage(file: string, roots: Root[], signal: AbortSignal) {
  checkSignal(signal);
  if (!localAbsolute(file) || path.extname(file).toLowerCase() !== '.rpm' || path.basename(file).length > 255) throw new ReleaseError('FILE_NOT_ALLOWED');
  const root = roots.find((value) => within(value.declared, file) || within(value.canonical, file));
  if (!root) throw new ReleaseError('FILE_NOT_ALLOWED');
  try {
    const before = await inspect(root, file, signal);
    if (before.size > BigInt(MAX_FILE_BYTES)) throw new ReleaseError('FILE_TOO_LARGE');
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
    checkSignal(signal);
    const handle = await open(file, flags);
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
      if (!sameFile(opened, await handle.stat({ bigint: true })) || !sameFile(opened, await inspect(root, file, signal))) throw new ReleaseError('FILE_CHANGED');
      checkSignal(signal);
      return { filename: path.basename(file), size_bytes: size, sha256: hash.digest('hex'), metadata, signature_verified: false as const, payload_verified: false as const };
    } finally { await handle.close(); }
  } catch (error) {
    checkSignal(signal);
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError('FILE_READ_FAILED');
  }
}
