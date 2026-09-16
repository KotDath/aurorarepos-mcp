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
import { output } from '../src/writes/schemas.js';
import { setupWrites } from './write-helpers.js';

describe('write confirmation through MCP elicitation', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'aurorarepos-write-protocol-')); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });
  async function connect(mode: 'legacy' | 'auto', response?: ElicitResult, mutate?: (test: ReturnType<typeof setupWrites>) => void) {
    const test = setupWrites(directory), publicFetch = vi.fn(async () => { throw Error('Unexpected public HTTP'); });
    const server = createServer(new AuroraService(new AuroraClient({ fetch: publicFetch })), new AuthService(test.store), undefined, undefined, test.service);
    const client = new Client({ name: 'write-confirmation-test', version: '1.0.0' }, {
      versionNegotiation: { mode }, ...(response ? { capabilities: { elicitation: { form: {} } } } : {}),
    });
    const elicited = vi.fn(async (message: string): Promise<ElicitResult> => { expect(message).toContain('Confirm this exact action'); expect(test.state.posts).toBe(0); mutate?.(test); return response!; });
    if (response) client.setRequestHandler('elicitation/create', async (request) => {
      expect(request.params.mode).toBe('form'); expect(request.params).toHaveProperty('requestedSchema.properties.confirm.default', false);
      return elicited(request.params.message);
    });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b); await client.listTools();
    return { client, server, test, elicited, publicFetch };
  }
  it.each(['legacy', 'auto'] as const)('requires a user form and commits only its accepted exact action (%s)', async (mode) => {
    const { client, server, test, elicited, publicFetch } = await connect(mode, { action: 'accept', content: { confirm: true } });
    try {
      const result = await client.callTool({ name: 'rename_my_app', arguments: { app_id: 201, name: 'Confirmed name' } });
      expect(result.isError).not.toBe(true); const value = output.parse(result.structuredContent);
      expect(value).toMatchObject({ app_id: 201, name: 'Confirmed name', publication_requested: false });
      expect(elicited).toHaveBeenCalledTimes(1); expect(test.state.posts).toBe(1); expect(publicFetch).not.toHaveBeenCalled();
      expect(elicited.mock.calls[0]?.[0]).toContain('Confirmed name'); expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SYNTHETIC|token|email/);
      const text = result.content[0]; if (text?.type === 'text') expect(JSON.parse(text.text)).toEqual(value);
    } finally { await client.close(); await server.close(); }
  });
  it.each(['legacy', 'auto'] as const)('does not write on declined/cancelled/unchecked approval (%s)', async (mode) => {
    for (const response of [{ action: 'decline' }, { action: 'cancel' }, { action: 'accept', content: { confirm: false } }] satisfies ElicitResult[]) {
      const { client, server, test } = await connect(mode, response);
      try {
        const result = await client.callTool({ name: 'create_app', arguments: { name: 'Declined new app' } });
        expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('APPROVAL_DECLINED'); expect(test.state.posts).toBe(0);
      } finally { await client.close(); await server.close(); }
    }
  });
  it.each(['legacy', 'auto'] as const)('cannot write from a host without elicitation capability (%s)', async (mode) => {
    const { client, server, test } = await connect(mode);
    try {
      await client.callTool({ name: 'create_app', arguments: { name: 'Unsupported host app' } }).catch(() => undefined);
      expect(test.state.posts).toBe(0);
    } finally { await client.close(); await server.close(); }
  });
  it.each(['legacy', 'auto'] as const)('detects changed state while the approval form is open (%s)', async (mode) => {
    const { client, server, test } = await connect(mode, { action: 'accept', content: { confirm: true } }, (test) => { test.state.rows[0]!.name = 'Concurrent rename'; });
    try {
      const result = await client.callTool({ name: 'rename_my_app', arguments: { app_id: 201, name: 'Approved name' } });
      expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('WRITE_STATE_CHANGED'); expect(test.state.posts).toBe(0);
    } finally { await client.close(); await server.close(); }
  });
  it('rejects a model-supplied confirm flag before storage/HTTP and exposes honest write annotations', async () => {
    const { client, server, test, elicited } = await connect('auto', { action: 'accept', content: { confirm: true } });
    try {
      const tools = (await client.listTools()).tools.filter((tool) => ['create_app', 'rename_my_app'].includes(tool.name));
      expect(tools).toHaveLength(2);
      for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
      const result = await client.callTool({ name: 'create_app', arguments: { name: 'Invalid app', confirm: true } });
      expect(result.isError).toBe(true); expect(test.load).not.toHaveBeenCalled(); expect(test.fetch).not.toHaveBeenCalled(); expect(elicited).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
  it('returns unknown outcomes without raw response details or automatic retries', async () => {
    const { client, server, test } = await connect('auto', { action: 'accept', content: { confirm: true } }); test.state.mode = 'network';
    try {
      const result = await client.callTool({ name: 'create_app', arguments: { name: 'Unknown app' } });
      expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('WRITE_OUTCOME_UNKNOWN'); expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SYNTHETIC|Cookie|csrf/); expect(test.state.posts).toBe(1);
    } finally { await client.close(); await server.close(); }
  });
});
