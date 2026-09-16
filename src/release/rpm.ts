import type { z } from 'zod';
import { ReleaseError } from './errors.js';
import { metadata } from './schemas.js';

export const MAX_HEADER_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 4096;
const MAGIC = Buffer.from([0x8e, 0xad, 0xe8, 1, 0, 0, 0, 0]);
type Entry = { tag: number; type: number; offset: number; count: number };
type Header = { entries: Map<number, Entry>; store: Buffer; end: number };
export type ReadAt = (position: number, length: number) => Promise<Buffer>;
function invalid(): never { throw new ReleaseError('INVALID_RPM'); }
function unsupported(): never { throw new ReleaseError('UNSUPPORTED_RPM'); }

async function header(read: ReadAt, position: number, size: number, regionTag: number): Promise<Header> {
  if (position + 16 > size) invalid();
  const intro = await read(position, 16);
  if (!intro.subarray(0, 8).equals(MAGIC)) invalid();
  const count = intro.readUInt32BE(8), bytes = intro.readUInt32BE(12);
  if (count < 1 || count > MAX_ENTRIES || bytes > MAX_HEADER_BYTES) invalid();
  const length = count * 16 + bytes, end = position + 16 + length;
  if (end > size) invalid();
  const body = await read(position + 16, length), store = body.subarray(count * 16), entries = new Map<number, Entry>();
  let stringBudget = MAX_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const start = i * 16, tag = body.readUInt32BE(start), type = body.readUInt32BE(start + 4),
      offset = body.readInt32BE(start + 8), items = body.readUInt32BE(start + 12);
    if (entries.has(tag) || offset < 0 || offset >= bytes || items < 1) invalid();
    const widths: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };
    const width = widths[type];
    if (width !== undefined) {
      if (items > Math.floor((bytes - offset) / width) || (type >= 3 && type <= 5 && offset % width !== 0)) invalid();
    } else if (type === 6 || type === 8 || type === 9) {
      if ((type === 6 && items !== 1) || items > bytes - offset) invalid();
      let cursor = offset;
      for (let j = 0; j < items; j++) {
        // Bound scanning even for overlapping malicious string-array entries.
        const stop = Math.min(bytes, cursor + stringBudget), nul = store.subarray(cursor, stop).indexOf(0);
        if (nul < 0) invalid();
        stringBudget -= nul + 1; cursor += nul + 1;
      }
    } else invalid();
    entries.set(tag, { tag, type, offset, count: items });
    if (i === 0 && tag !== regionTag) unsupported();
  }
  const region = entries.get(regionTag);
  if (!region || region.type !== 7 || region.count !== 16) invalid();
  const trailer = store.subarray(region.offset, region.offset + 16);
  if (trailer.readUInt32BE(0) !== regionTag || trailer.readUInt32BE(4) !== 7 ||
    trailer.readInt32BE(8) !== -count * 16 || trailer.readUInt32BE(12) !== 16) invalid();
  return { entries, store, end };
}
function text(value: Header, tag: number, max: number): string {
  const entry = value.entries.get(tag); if (!entry || entry.type !== 6 || entry.count !== 1) invalid();
  const end = value.store.indexOf(0, entry.offset), bytes = value.store.subarray(entry.offset, end);
  if (end < 0 || bytes.length < 1 || bytes.length > max || bytes.some((byte) => byte < 0x21 || byte > 0x7e)) invalid();
  return bytes.toString('ascii');
}
function integer(value: Header, tag: number, fallback: number): number {
  const entry = value.entries.get(tag); if (!entry) return fallback;
  if (entry.type !== 4 || entry.count !== 1) invalid();
  return value.store.readUInt32BE(entry.offset);
}
export async function readRpm(read: ReadAt, size: number): Promise<z.infer<typeof metadata>> {
  if (size < 96 + 16 * 2) invalid();
  const lead = await read(0, 96);
  if (!lead.subarray(0, 4).equals(Buffer.from([0xed, 0xab, 0xee, 0xdb]))) invalid();
  if (lead[4] !== 3 || lead[5] !== 0 || lead.readUInt16BE(6) !== 0 || lead.readUInt16BE(78) !== 5) unsupported();
  const signature = await header(read, 96, size, 62), mainStart = Math.ceil(signature.end / 8) * 8;
  if (mainStart > size) invalid();
  if (mainStart !== signature.end && (await read(signature.end, mainStart - signature.end)).some((byte) => byte !== 0)) invalid();
  const main = await header(read, mainStart, size, 63);
  if (main.end >= size) invalid();
  if (integer(main, 5114, 4) !== 4) unsupported();
  const name = text(main, 1000, 200), version = text(main, 1001, 80), release = text(main, 1002, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._+%-]*$/.test(name) || !/^[A-Za-z0-9][A-Za-z0-9._+~^]*$/.test(version) || !/^[A-Za-z0-9][A-Za-z0-9._+~^]*$/.test(release)) invalid();
  const arch = text(main, 1022, 40), os = text(main, 1021, 40), format = text(main, 1124, 40), compressor = text(main, 1125, 40);
  if (!['armv7hl', 'aarch64'].includes(arch) || os !== 'linux' || format !== 'cpio') unsupported();
  const prefix = await read(main.end, Math.min(6, size - main.end));
  const expected: Record<string, Buffer> = { gzip: Buffer.from([0x1f, 0x8b, 8]), xz: Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]),
    zstd: Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), bzip2: Buffer.from('BZh') };
  if (compressor === 'none') {
    if (!['070701', '070702'].includes(prefix.toString('ascii'))) invalid();
  } else {
    const magic = expected[compressor]; if (!magic) unsupported();
    if (!prefix.subarray(0, magic.length).equals(magic) || (compressor === 'bzip2' && (prefix[3] === undefined || prefix[3] < 0x31 || prefix[3] > 0x39))) invalid();
  }
  return metadata.parse({ name, version, release, epoch: integer(main, 1003, 0), arch, os, payload_format: format, payload_compressor: compressor });
}
