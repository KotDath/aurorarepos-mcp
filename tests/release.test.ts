import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir, symlink, link, truncate, appendFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRpm } from '../src/release/rpm.js';
import { allowedRoots, envRoots, localAbsolute, MAX_FILE_BYTES } from '../src/release/files.js';
import { ReleaseService } from '../src/release/service.js';
import { prepareOutput, warningCodes } from '../src/release/schemas.js';
import { intTag, stringTag, syntheticRpm } from './release-helpers.js';

vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs/promises')>() }));

async function parse(bytes: Buffer) {
  return readRpm(async (start, length) => bytes.subarray(start, start + length), bytes.length);
}
describe('bounded RPM structural metadata parser', () => {
  it.each(['armv7hl', 'aarch64'])('reads allowlisted fields for %s without contacts or payload', async (arch) => {
    const { bytes } = syntheticRpm({ arch, epoch: 3 });
    const value = await parse(bytes);
    expect(value).toMatchObject({ name: 'ru.example.Test', version: '1.2.3', release: '1', epoch: 3, arch, os: 'linux', payload_format: 'cpio', payload_compressor: 'gzip' });
    expect(JSON.stringify(value)).not.toMatch(/PRIVATE_CONTACT|SYNTHETIC_CPIO|example.invalid/);
  });
  it('defaults missing epoch to zero and accepts uncompressed cpio prefix', async () => {
    expect(await parse(syntheticRpm({ compressor: 'none', payload: Buffer.from('070701synthetic') }).bytes)).toMatchObject({ epoch: 0, payload_compressor: 'none' });
  });
  it.each([
    { arch: 'noarch' }, { arch: 'x86_64' }, { os: 'windows' }, { source: true }, { rpmFormat: 6 }, { compressor: 'unknown' },
  ])('explicitly rejects unsupported package %j', async (options) => {
    await expect(parse(syntheticRpm(options).bytes)).rejects.toMatchObject({ code: 'UNSUPPORTED_RPM' });
  });
  it.each(['name', 'version', 'release'] as const)('rejects unsafe %s metadata', async (field) => {
    await expect(parse(syntheticRpm({ [field]: '<script>PRIVATE</script>' }).bytes)).rejects.toMatchObject({ code: 'INVALID_RPM' });
  });
  it.each([0, 4, 95, 111, 128])('rejects truncation at %s bytes', async (length) => {
    await expect(parse(syntheticRpm().bytes.subarray(0, length))).rejects.toMatchObject({ code: 'INVALID_RPM' });
  });
  it('rejects empty payload and a compressor/payload mismatch', async () => {
    await expect(parse(syntheticRpm({ payload: Buffer.alloc(0) }).bytes)).rejects.toMatchObject({ code: 'INVALID_RPM' });
    await expect(parse(syntheticRpm({ payload: Buffer.from('not-gzip') }).bytes)).rejects.toMatchObject({ code: 'INVALID_RPM' });
  });
  it.each(['magic', 'entries', 'size', 'negative_offset', 'bad_type', 'bad_count', 'region'] as const)('rejects malformed header %s', async (mutation) => {
    const { bytes, mainStart } = syntheticRpm();
    if (mutation === 'magic') bytes[mainStart] = 0;
    if (mutation === 'entries') bytes.writeUInt32BE(4097, mainStart + 8);
    if (mutation === 'size') bytes.writeUInt32BE(8 * 1024 * 1024 + 1, mainStart + 12);
    if (mutation === 'negative_offset') bytes.writeInt32BE(-1, mainStart + 16 + 8);
    if (mutation === 'bad_type') bytes.writeUInt32BE(99, mainStart + 16 + 4);
    if (mutation === 'bad_count') bytes.writeUInt32BE(0xffff_ffff, mainStart + 16 + 12);
    if (mutation === 'region') {
      const count = bytes.readUInt32BE(mainStart + 8), offset = bytes.readInt32BE(mainStart + 24);
      bytes.writeInt32BE(-16, mainStart + 16 + count * 16 + offset + 8);
    }
    await expect(parse(bytes)).rejects.toMatchObject({ code: 'INVALID_RPM' });
  });
  it('rejects duplicate tags, wrong string type/count and missing required metadata', async () => {
    for (const extra of [[stringTag(1000, 'other')], [intTag(1003, 1), intTag(1003, 2)]]) {
      await expect(parse(syntheticRpm({ extra }).bytes)).rejects.toMatchObject({ code: 'INVALID_RPM' });
    }
    const { bytes, mainStart } = syntheticRpm(); bytes.writeUInt32BE(2, mainStart + 16 * 2 + 12);
    await expect(parse(bytes)).rejects.toMatchObject({ code: 'INVALID_RPM' });
  });
  it('does not read an unbounded header body', async () => {
    const { bytes } = syntheticRpm(); bytes.writeUInt32BE(0xffff_ffff, 108);
    const read = vi.fn(async (start: number, length: number) => bytes.subarray(start, start + length));
    await expect(readRpm(read, bytes.length)).rejects.toMatchObject({ code: 'INVALID_RPM' });
    expect(read.mock.calls.map(([, length]) => length)).toEqual([96, 16]);
  });
});

describe('local release policy and preview', () => {
  let directory: string, roots: string[], service: ReleaseService;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'aurorarepos-release-test-'));
    roots = [directory]; service = new ReleaseService(() => roots);
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
  async function file(name = 'test.rpm', options: Parameters<typeof syntheticRpm>[0] = {}) {
    const target = path.join(directory, name), { bytes } = syntheticRpm(options); await writeFile(target, bytes); return { target, bytes };
  }
  it('prepares matching RPMs with full-file checksums, explicit warnings and no path exposure', async () => {
    const a = await file('32.rpm'), b = await file('64.rpm', { arch: 'aarch64' });
    const value = prepareOutput.parse(await service.prepare({ rpm32_path: a.target, rpm64_path: b.target, aurora_versions: [5, 4], app_id: 201, release_notes: '<b>Fix</b><script>HIDDEN</script>' }));
    expect(value.packages.map((pkg) => pkg.sha256)).toEqual([a, b].map(({ bytes }) => createHash('sha256').update(bytes).digest('hex')));
    expect(value).toMatchObject({ uploaded: false, approval_granted: false, target: { ownership_verified: false, compatibility_verified: false, aurora_versions: [4, 5] }, release_notes: 'Fix' });
    expect(value.warnings).toEqual(warningCodes); expect(JSON.stringify(value)).not.toMatch(/PRIVATE_CONTACT|SYNTHETIC_CPIO|HIDDEN/); expect(JSON.stringify(value)).not.toContain(directory);
  });
  it('supports only one architecture without claiming the other exists', async () => {
    const { target } = await file('64.rpm', { arch: 'aarch64' });
    expect((await service.prepare({ rpm64_path: target, aurora_versions: [5] })).packages).toHaveLength(1);
  });
  it.each(['name', 'version', 'release', 'epoch'] as const)('rejects paired %s mismatch', async (field) => {
    const a = await file('32.rpm'), b = await file('64.rpm', { arch: 'aarch64', [field]: field === 'epoch' ? 2 : 'different' });
    await expect(service.prepare({ rpm32_path: a.target, rpm64_path: b.target, aurora_versions: [5] })).rejects.toMatchObject({ code: 'PACKAGE_MISMATCH' });
  });
  it('rejects reversed slots and duplicate file paths', async () => {
    const { target } = await file();
    await expect(service.prepare({ rpm64_path: target, aurora_versions: [5] })).rejects.toMatchObject({ code: 'UNSUPPORTED_RPM' });
    await expect(service.prepare({ rpm32_path: target, rpm64_path: target, aurora_versions: [5] })).rejects.toMatchObject({ code: 'UNSUPPORTED_RPM' });
  });
  it('defaults to disabled reads, handles malformed configuration and never returns policy paths', async () => {
    vi.stubEnv('AURORAREPOS_RPM_ROOTS', ''); const { target } = await file();
    await expect(new ReleaseService().prepare({ rpm32_path: target, aurora_versions: [5] })).rejects.toMatchObject({ code: 'FILE_ACCESS_DISABLED' });
    vi.stubEnv('AURORAREPOS_RPM_ROOTS', '{bad'); expect(() => envRoots()).toThrow('Invalid local RPM directory policy');
    vi.stubEnv('AURORAREPOS_RPM_ROOTS', JSON.stringify([directory])); expect(envRoots()).toEqual([directory]);
  });
  it.each([null, 'root', ['relative'], Array(9).fill('/dedicated'), [path.parse(tmpdir()).root], [homedir()]])('rejects invalid policy %j', async (policy) => {
    await expect(allowedRoots(policy, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_FILE_POLICY' });
  });
  it.each([{}, { rpm32_path: '/test.rpm' }, { rpm32_path: '/test.rpm', aurora_versions: [3] },
    { rpm32_path: '/test.rpm', aurora_versions: [5, 5] }, { rpm32_path: '/test.rpm', aurora_versions: [5], roots: ['/'] },
    { rpm32_path: '/test.rpm', aurora_versions: [5], app_id: -1 }, { rpm32_path: '/test.rpm', aurora_versions: [5], release_notes: 'a'.repeat(4001) }])('rejects invalid arguments before policy access', async (input) => {
    const policy = vi.fn(() => roots);
    await expect(new ReleaseService(policy).prepare(input)).rejects.toMatchObject({ code: 'INVALID_RELEASE_INPUT' }); expect(policy).not.toHaveBeenCalled();
  });
  it('rejects outside/sibling-prefix/traversal/non-RPM/directory paths', async () => {
    const { target } = await file('test.txt'); await mkdir(path.join(directory, 'folder.rpm'));
    for (const candidate of [path.join(directory, '..', 'outside.rpm'), `${directory}-sibling/file.rpm`, `${directory}${path.sep}..${path.sep}file.rpm`, target, path.join(directory, 'folder.rpm'), 'relative.rpm']) {
      await expect(service.prepare({ rpm32_path: candidate, aurora_versions: [5] })).rejects.toMatchObject({ code: 'FILE_NOT_ALLOWED' });
    }
  });
  it('rejects hardlinks and absent files with safe errors', async () => {
    const { target } = await file(); const linked = path.join(directory, 'hard.rpm'); await link(target, linked);
    await expect(service.prepare({ rpm32_path: linked, aurora_versions: [5] })).rejects.toMatchObject({ code: 'FILE_NOT_ALLOWED' });
    await expect(service.prepare({ rpm32_path: path.join(directory, 'missing.rpm'), aurora_versions: [5] })).rejects.toMatchObject({ code: 'FILE_READ_FAILED' });
  });
  it.skipIf(process.platform === 'win32')('rejects file symlinks even to an allowed package', async () => {
    const { target } = await file(); const linked = path.join(directory, 'symbolic.rpm'); await symlink(target, linked);
    await expect(service.prepare({ rpm32_path: linked, aurora_versions: [5] })).rejects.toMatchObject({ code: 'FILE_NOT_ALLOWED' });
  });
  it('rejects directory symlinks/junctions below an allowed root', async () => {
    await mkdir(path.join(directory, 'actual')); const { bytes } = syntheticRpm(); await writeFile(path.join(directory, 'actual', 'test.rpm'), bytes);
    await symlink(path.join(directory, 'actual'), path.join(directory, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(service.prepare({ rpm32_path: path.join(directory, 'alias', 'test.rpm'), aurora_versions: [5] })).rejects.toMatchObject({ code: 'FILE_NOT_ALLOWED' });
  });
  it('rejects oversized sparse files before parsing', async () => {
    const { target } = await file(); await truncate(target, MAX_FILE_BYTES + 1);
    await expect(service.prepare({ rpm32_path: target, aurora_versions: [5] })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });
  it('honors cancellation before accessing the filesystem policy', async () => {
    const policy = vi.fn(() => roots), controller = new AbortController(); controller.abort();
    await expect(new ReleaseService(policy).prepare({ rpm32_path: '/test.rpm', aurora_versions: [5] }, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' }); expect(policy).not.toHaveBeenCalled();
  });
  it('detects a file mutation during reading and closes the descriptor', async () => {
    const { target } = await file(); const original = fs.open;
    let closed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args), read = handle.read.bind(handle), close = handle.close.bind(handle);
      vi.spyOn(handle, 'read').mockImplementation(async (...readArgs: Parameters<typeof handle.read>) => {
        const result = await read(...readArgs); await appendFile(target, 'changed'); return result;
      });
      vi.spyOn(handle, 'close').mockImplementation(async () => { closed = true; await close(); });
      return handle;
    });
    await expect(service.prepare({ rpm32_path: target, aurora_versions: [5] })).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    expect(closed).toBe(true);
  });
  it('returns a timeout even when a filesystem lookup stalls', async () => {
    vi.spyOn(fs, 'realpath').mockImplementation(() => new Promise<string>(() => {}));
    await expect(new ReleaseService(() => roots, 10).prepare({ rpm32_path: path.join(directory, 'test.rpm'), aurora_versions: [5] })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  it('serializes local operations and supports cancellation while queued', async () => {
    const { target } = await file(), original = fs.open;
    let release!: () => void, opened!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), started = new Promise<void>((resolve) => { opened = resolve; });
    const open = vi.spyOn(fs, 'open').mockImplementation(async (...args) => { opened(); await gate; return original(...args); });
    const input = { rpm32_path: target, aurora_versions: [5] }, first = service.prepare(input);
    await started;
    const controller = new AbortController(), queued = service.prepare(input, controller.signal); controller.abort();
    await expect(queued).rejects.toMatchObject({ code: 'CANCELLED' }); expect(open).toHaveBeenCalledTimes(1);
    release(); await first;
    await service.prepare(input); expect(open).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['C:\\build\\test.rpm', 'win32', true], ['C:/build/test.rpm', 'win32', true], ['C:\\build\\test.rpm:secret', 'win32', false],
    ['\\\\server\\share\\test.rpm', 'win32', false], ['\\\\?\\C:\\test.rpm', 'win32', false], ['C:relative.rpm', 'win32', false],
    ['C:\\build\\CON.rpm', 'win32', false], ['C:\\build\\NUL', 'win32', false], ['C:\\build.\\test.rpm', 'win32', false],
    ['/build/test.rpm', 'linux', true], ['/build/../test.rpm', 'linux', false], ['//server/share/test.rpm', 'linux', false], ['/build/./test.rpm', 'linux', false],
  ] as const)('checks local path syntax %s on %s', (candidate, platform, expected) => {
    expect(localAbsolute(candidate, platform)).toBe(expected);
  });
});
