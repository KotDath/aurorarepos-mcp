import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/server.js';
import { AuroraClient } from '../src/aurora/client.js';
import { AuroraService } from '../src/aurora/service.js';
import { AuthService } from '../src/auth/service.js';
import { ReleaseService } from '../src/release/service.js';
import { prepareOutput } from '../src/release/schemas.js';
import { syntheticRpm } from './release-helpers.js';

describe('local release preparation over MCP', () => {
  let directory: string, rpm: string, bytes: Buffer;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'aurorarepos-preflight-protocol-'));
    rpm = path.join(directory, 'test.rpm'); bytes = syntheticRpm().bytes; await writeFile(rpm, bytes);
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
  async function connect(release = new ReleaseService()) {
    const fetch = vi.fn(async () => { throw Error('Unexpected HTTP'); }), auth = new AuthService();
    const load = vi.spyOn(auth.store, 'load').mockRejectedValue(Error('Unexpected vault access'));
    const server = createServer(new AuroraService(new AuroraClient({ fetch })), auth, undefined, release);
    const client = new Client({ name: 'release-protocol-test', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b); await client.listTools();
    return { client, server, fetch, load };
  }
  it('returns matching validated preview without HTTP/vault access or file mutations', async () => {
    const { client, server, fetch, load } = await connect();
    try {
      const result = await client.callTool({ name: 'prepare_release', arguments: { rpm32_path: rpm, aurora_versions: [5], app_id: 201 } });
      expect(result.isError).not.toBe(true); const output = prepareOutput.parse(result.structuredContent);
      expect(output).toMatchObject({ uploaded: false, approval_granted: false, target: { ownership_verified: false } });
      const text = result.content[0]; expect(text?.type).toBe('text'); if (text?.type === 'text') expect(JSON.parse(text.text)).toEqual(output);
      expect(JSON.stringify(result)).not.toContain(directory); expect(JSON.stringify(result)).not.toMatch(/PRIVATE_CONTACT|SYNTHETIC_CPIO/);
      expect(fetch).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
      expect(await readdir(directory)).toEqual(['test.rpm']); expect(await readFile(rpm)).toEqual(bytes);
    } finally { await client.close(); await server.close(); }
  });
  it.each(['', '{bad', '["/unrelated"]'])('accepts absolute RPM paths without directory configuration (%j)', async (value) => {
    vi.stubEnv('AURORAREPOS_RPM_ROOTS', value);
    const { client, server, fetch, load } = await connect();
    try {
      expect((await client.listTools()).tools).toHaveLength(14);
      const result = await client.callTool({ name: 'prepare_release', arguments: { rpm32_path: rpm, aurora_versions: [5] } });
      expect(result.isError).not.toBe(true); expect(prepareOutput.parse(result.structuredContent).packages).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(directory);
      expect(fetch).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
  it('sanitizes missing paths and refuses unknown owner/approval arguments without echoing them', async () => {
    const { client, server, fetch, load } = await connect();
    try {
      const outside = await client.callTool({ name: 'prepare_release', arguments: { rpm32_path: path.join(tmpdir(), 'PRIVATE_PATH.rpm'), aurora_versions: [5] } });
      expect(outside.isError).toBe(true); expect(JSON.stringify(outside)).toContain('FILE_READ_FAILED'); expect(JSON.stringify(outside)).not.toContain('PRIVATE_PATH');
      const invalid = await client.callTool({ name: 'prepare_release', arguments: { rpm32_path: rpm, aurora_versions: [5], roots: ['/'], user_id: 999, approval_token: 'PRIVATE_APPROVAL' } });
      expect(invalid.isError).toBe(true); expect(JSON.stringify(invalid)).not.toContain('PRIVATE_APPROVAL'); expect(JSON.stringify(invalid)).not.toContain(directory);
      expect(fetch).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
  it.each(['legacy', 'auto'] as const)('prepares a synthetic RPM in a real stdio subprocess (%s)', async (mode) => {
    const client = new Client({ name: 'release-stdio-test', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
      stderr: 'pipe' });
    const errors: string[] = []; transport.onerror = (error) => errors.push(error.message);
    try {
      await client.connect(transport); expect((await client.listTools()).tools).toHaveLength(14);
      const result = await client.callTool({ name: 'prepare_release', arguments: { rpm32_path: rpm, aurora_versions: [4, 5] } });
      expect(result.isError).not.toBe(true); expect(prepareOutput.parse(result.structuredContent).packages[0]?.metadata.arch).toBe('armv7hl');
      expect(JSON.stringify(result)).not.toContain(directory); expect(errors).toEqual([]);
      expect(await readdir(directory)).toEqual(['test.rpm']); expect(await readFile(rpm)).toEqual(bytes);
    } finally { await client.close(); }
  }, 15_000);
});
