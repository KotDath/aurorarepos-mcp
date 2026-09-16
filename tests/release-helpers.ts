import { gzipSync } from 'node:zlib';

export type Tag = { tag: number; type: number; data: Buffer; count: number };
export function stringTag(tag: number, value: string): Tag { return { tag, type: 6, data: Buffer.from(`${value}\0`), count: 1 }; }
export function intTag(tag: number, value: number): Tag {
  const data = Buffer.alloc(4); data.writeUInt32BE(value); return { tag, type: 4, data, count: 1 };
}
export function rpmHeader(regionTag: number, tags: Tag[]): Buffer {
  const count = tags.length + 1, store: Buffer[] = [], indexed: { value: Tag; offset: number }[] = [];
  let offset = 0;
  for (const value of tags.toSorted((a, b) => a.tag - b.tag)) {
    const width = ({ 3: 2, 4: 4, 5: 8 } as Record<number, number>)[value.type] ?? 1;
    const pad = (width - offset % width) % width; if (pad) { store.push(Buffer.alloc(pad)); offset += pad; }
    indexed.push({ value, offset }); store.push(value.data); offset += value.data.length;
  }
  const trailer = Buffer.alloc(16); trailer.writeUInt32BE(regionTag, 0); trailer.writeUInt32BE(7, 4);
  trailer.writeInt32BE(-count * 16, 8); trailer.writeUInt32BE(16, 12);
  indexed.unshift({ value: { tag: regionTag, type: 7, data: trailer, count: 16 }, offset });
  store.push(trailer); offset += trailer.length;
  const intro = Buffer.from([0x8e, 0xad, 0xe8, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  intro.writeUInt32BE(count, 8); intro.writeUInt32BE(offset, 12);
  const index = Buffer.alloc(count * 16);
  indexed.forEach(({ value, offset }, i) => {
    index.writeUInt32BE(value.tag, i * 16); index.writeUInt32BE(value.type, i * 16 + 4);
    index.writeInt32BE(offset, i * 16 + 8); index.writeUInt32BE(value.count, i * 16 + 12);
  });
  return Buffer.concat([intro, index, ...store]);
}
export function syntheticRpm(options: { arch?: string; name?: string; version?: string; release?: string; epoch?: number; os?: string;
  compressor?: string; payload?: Buffer; extra?: Tag[]; source?: boolean; rpmFormat?: number } = {}) {
  const lead = Buffer.alloc(96); Buffer.from([0xed, 0xab, 0xee, 0xdb, 3, 0]).copy(lead); lead.writeUInt16BE(options.source ? 1 : 0, 6); lead.writeUInt16BE(5, 78);
  const signature = rpmHeader(62, [{ tag: 1004, type: 7, data: Buffer.alloc(16), count: 16 }]);
  const tags = [stringTag(1000, options.name ?? 'ru.example.Test'), stringTag(1001, options.version ?? '1.2.3'), stringTag(1002, options.release ?? '1'),
    stringTag(1015, 'PRIVATE_CONTACT@example.invalid'), stringTag(1021, options.os ?? 'linux'), stringTag(1022, options.arch ?? 'armv7hl'),
    stringTag(1124, 'cpio'), stringTag(1125, options.compressor ?? 'gzip'), ...(options.extra ?? [])];
  if (options.epoch !== undefined) tags.push(intTag(1003, options.epoch));
  if (options.rpmFormat !== undefined) tags.push(intTag(5114, options.rpmFormat));
  const main = rpmHeader(63, tags), padding = Buffer.alloc((8 - signature.length % 8) % 8);
  const payload = options.payload ?? gzipSync(Buffer.from('070701SYNTHETIC_CPIO_NOT_INSTALLABLE'));
  return { bytes: Buffer.concat([lead, signature, padding, main, payload]), mainStart: 96 + signature.length + padding.length,
    payloadStart: 96 + signature.length + padding.length + main.length };
}
