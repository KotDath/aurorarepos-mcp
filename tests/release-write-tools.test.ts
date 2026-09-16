import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type ElicitResult } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/server.js';
import { AuthService } from '../src/auth/service.js';
import { AuroraClient } from '../src/aurora/client.js';
import { AuroraService } from '../src/aurora/service.js';
import { setupReleaseWrites } from './release-write-helpers.js';
import type { ReleaseOperation } from '../src/writes/release-schemas.js';

describe('release write user confirmation through MCP', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'aurorarepos-release-form-')); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });
  async function connect(mode: 'legacy' | 'auto', response?: ElicitResult, mutate?: (test: Awaited<ReturnType<typeof setupReleaseWrites>>) => void, yolo = false) {
    const test = await setupReleaseWrites(directory), publicFetch = vi.fn(async () => { throw Error('Unexpected public HTTP'); });
    const server = createServer(new AuroraService(new AuroraClient({ fetch: publicFetch })), new AuthService(test.store), undefined, undefined, undefined, test.service, { yolo });
    const client = new Client({ name: 'release-write-form-test', version: '1.0.0' }, {
      versionNegotiation: { mode }, ...(response ? { capabilities: { elicitation: { form: {} } } } : {}),
    });
    const elicited = vi.fn(async (message: string): Promise<ElicitResult> => {
      expect(message).toContain('Confirm this exact action'); expect(message).not.toMatch(/PRIVATE|SYNTHETIC/); expect(test.state.posts).toBe(0); mutate?.(test); return response!;
    });
    if (response) client.setRequestHandler('elicitation/create', async (request) => {
      expect(request.params.mode).toBe('form'); expect(request.params).toHaveProperty('requestedSchema.properties.confirm.default', false);
      return elicited(request.params.message);
    });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b); await client.listTools();
    return { client, server, test, elicited, publicFetch };
  }
  function args(test: Awaited<ReturnType<typeof setupReleaseWrites>>, operation: ReleaseOperation) {
    return operation === 'upload_release' ? test.args : operation === 'update_my_app_version' ? { app_id: 201, version_id: 301, release_notes: 'Updated notes' } : { app_id: 201, version_id: 301, is_delayed: false };
  }
  for (const operation of ['upload_release', 'update_my_app_version', 'schedule_my_app_version'] as const) {
    it.each(['legacy', 'auto'] as const)(`requires exact user confirmation for ${operation} (%s)`, async (mode) => {
      const { client, server, test, elicited, publicFetch } = await connect(mode, { action: 'accept', content: { confirm: true } });
      try {
        const result = await client.callTool({ name: operation, arguments: args(test, operation) });
        expect(result.isError).not.toBe(true); expect(test.state.posts).toBe(1); expect(elicited).toHaveBeenCalledTimes(1); expect(publicFetch).not.toHaveBeenCalled();
        expect(result.structuredContent).toMatchObject({ operation, verified: true, shared_metadata_preserved: true });
        expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SYNTHETIC/);
      } finally { await client.close(); await server.close(); }
    });
    it.each(['legacy', 'auto'] as const)(`does not dispatch declined ${operation} (%s)`, async (mode) => {
      const { client, server, test } = await connect(mode, { action: 'decline' });
      try {
        const result = await client.callTool({ name: operation, arguments: args(test, operation) });
        expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('APPROVAL_DECLINED'); expect(test.state.posts).toBe(0);
      } finally { await client.close(); await server.close(); }
    });
  }
  it.each(['legacy', 'auto'] as const)('cannot upload without host elicitation support (%s)', async (mode) => {
    const { client, server, test } = await connect(mode);
    try { await client.callTool({ name: 'upload_release', arguments: test.args }).catch(() => undefined); expect(test.state.posts).toBe(0); }
    finally { await client.close(); await server.close(); }
  });
  it('refuses changed shared state after the user sees the form', async () => {
    const { client, server, test } = await connect('auto', { action: 'accept', content: { confirm: true } }, (t) => { t.state.editor.description = 'Concurrent edit'; });
    try {
      const result = await client.callTool({ name: 'upload_release', arguments: test.args });
      expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('WRITE_STATE_CHANGED'); expect(test.state.posts).toBe(0);
    } finally { await client.close(); await server.close(); }
  });
  it('rejects model-supplied approval before storage or HTTP', async () => {
    const { client, server, test, elicited } = await connect('auto', { action: 'accept', content: { confirm: true } });
    try {
      const result = await client.callTool({ name: 'upload_release', arguments: { ...test.args, confirm: true } });
      expect(result.isError).toBe(true); expect(test.load).not.toHaveBeenCalled(); expect(test.fetch).not.toHaveBeenCalled(); expect(elicited).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
  for (const operation of ['upload_release', 'update_my_app_version', 'schedule_my_app_version'] as const) {
    it.each(['legacy', 'auto'] as const)(`executes ${operation} in YOLO without host elicitation support (%s)`, async (mode) => {
      const { client, server, test, elicited, publicFetch } = await connect(mode, undefined, undefined, true);
      try {
        const result = await client.callTool({ name: operation, arguments: args(test, operation) });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({ operation, verified: true, uploaded: operation === 'upload_release', shared_metadata_preserved: true });
        expect(test.state.posts).toBe(1); expect(elicited).not.toHaveBeenCalled(); expect(publicFetch).not.toHaveBeenCalled();
        const tool = (await client.listTools()).tools.find((item) => item.name === operation)!;
        expect(tool.description).toContain('YOLO mode'); expect(tool.description).not.toContain('Requires exact user form confirmation');
        expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
        expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SYNTHETIC/);
      } finally { await client.close(); await server.close(); }
    });
  }
  it('does not request an upload form in YOLO even when the host supports forms', async () => {
    const { client, server, test, elicited } = await connect('auto', { action: 'decline' }, undefined, true);
    try {
      const result = await client.callTool({ name: 'upload_release', arguments: test.args });
      expect(result.isError).not.toBe(true); expect(test.state.posts).toBe(1); expect(elicited).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
  it('still rejects invalid upload arguments before storage or HTTP in YOLO', async () => {
    const { client, server, test } = await connect('auto', undefined, undefined, true);
    try {
      const result = await client.callTool({ name: 'upload_release', arguments: { ...test.args, confirm: true } });
      expect(result.isError).toBe(true); expect(test.load).not.toHaveBeenCalled(); expect(test.fetch).not.toHaveBeenCalled(); expect(test.state.posts).toBe(0);
    } finally { await client.close(); await server.close(); }
  });
  it('still verifies server RPM hashes after a YOLO upload', async () => {
    const { client, server, test } = await connect('auto', undefined, undefined, true); test.state.mode = 'bad-hash';
    try {
      const result = await client.callTool({ name: 'upload_release', arguments: test.args });
      expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('WRITE_OUTCOME_UNKNOWN'); expect(test.state.posts).toBe(1);
    } finally { await client.close(); await server.close(); }
  });
});
