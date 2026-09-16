import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/server.js';
import { AuroraClient } from '../src/aurora/client.js';
import { AuroraService } from '../src/aurora/service.js';
import { backend, json } from './helpers.js';
import { AuthService } from '../src/auth/service.js';
import { AuthError } from '../src/auth/errors.js';
import { setupDeveloper } from './developer-helpers.js';
import type { DeveloperService } from '../src/developer/service.js';

describe('MCP tools over a protocol connection', () => {
  async function connect(auth = new AuthService(), developer?: DeveloperService) {
    const fetch = backend();
    const server = createServer(new AuroraService(new AuroraClient({ fetch, minIntervalMs: 0 })), auth, developer);
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server, fetch };
  }

  it('exposes public/developer/status/local-preflight tools with schemas', async () => {
    const { client, server } = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['search_apps', 'get_app', 'get_app_versions', 'list_categories', 'list_systems', 'list_author_apps', 'auth_status', 'list_my_apps', 'get_my_app', 'list_my_app_versions', 'get_my_app_version', 'prepare_release', 'create_app', 'rename_my_app', 'upload_release', 'update_my_app_version', 'schedule_my_app_version'].sort());
      for (const tool of tools) {
        const write = ['create_app', 'rename_my_app', 'upload_release', 'update_my_app_version', 'schedule_my_app_version'].includes(tool.name);
        expect(tool.annotations?.readOnlyHint).toBe(!write);
        expect(tool.annotations?.destructiveHint).toBe(write);
        expect(tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
      }
    } finally { await client.close(); await server.close(); }
  });

  it('calls all six tools and returns matching JSON text and structured content', async () => {
    const { client, server } = await connect();
    try {
      await client.listTools();
      const calls = [
        { name: 'search_apps', arguments: {} },
        { name: 'get_app', arguments: { slug: 'example-timer' } },
        { name: 'get_app_versions', arguments: { slug: 'example-timer' } },
        { name: 'list_categories', arguments: {} },
        { name: 'list_systems', arguments: {} },
        { name: 'list_author_apps', arguments: { author_id: 101 } },
      ];
      for (const call of calls) {
        const output = await client.callTool(call);
        expect(output.isError).not.toBe(true);
        expect(output.structuredContent).toBeDefined();
        const content = output.content[0];
        expect(content?.type).toBe('text');
        if (content?.type === 'text') expect(JSON.parse(content.text)).toEqual(output.structuredContent);
        expect(JSON.stringify(output)).not.toMatch(/synthetic-csrf-secret|synthetic-cookie-secret|untrusted\(\)/);
      }
    } finally { await client.close(); await server.close(); }
  });

  it('returns sanitized recoverable tool errors, not raw upstream bodies', async () => {
    const { client, server, fetch } = await connect();
    try {
      await client.listTools();
      fetch.mockResolvedValueOnce(json({ secret: 'MUST_NOT_LEAK' }, 403));
      const output = await client.callTool({ name: 'list_systems', arguments: {} });
      expect(output.isError).toBe(true);
      expect(JSON.stringify(output)).toContain('ACCESS_DENIED');
      expect(JSON.stringify(output)).not.toContain('MUST_NOT_LEAK');
    } finally { await client.close(); await server.close(); }
  });

  it('rejects invalid tool arguments before contacting the website', async () => {
    const { client, server, fetch } = await connect();
    try {
      await client.listTools();
      const output = await client.callTool({ name: 'search_apps', arguments: { page_size: 100 } });
      expect(output.isError).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
  it('returns local auth state without credentials and passes explicit verification/cancellation', async () => {
    const auth = new AuthService();
    const status = vi.spyOn(auth, 'status').mockResolvedValue({ state: 'stored', saved_at: '2026-09-16T00:00:00.000Z', verified: false });
    const { client, server, fetch } = await connect(auth);
    try {
      await client.listTools();
      const output = await client.callTool({ name: 'auth_status', arguments: {} });
      expect(output.isError).not.toBe(true);
      expect(output.structuredContent).toEqual({ state: 'stored', saved_at: '2026-09-16T00:00:00.000Z', verified: false });
      expect(status).toHaveBeenCalledWith({ verify: false }, expect.any(AbortSignal));
      expect(fetch).not.toHaveBeenCalled();
      await client.callTool({ name: 'auth_status', arguments: { verify: true } });
      expect(status).toHaveBeenLastCalledWith({ verify: true }, expect.any(AbortSignal));
      const invalid = await client.callTool({ name: 'auth_status', arguments: { password: 'MUST_NOT_LEAK' } });
      expect(invalid.isError).toBe(true); expect(JSON.stringify(invalid)).not.toContain('MUST_NOT_LEAK');
      expect(status).toHaveBeenCalledTimes(2);
    } finally { await client.close(); await server.close(); }
  });
  it('reports secure storage failure as a sanitized error, not logged out', async () => {
    const auth = new AuthService(); vi.spyOn(auth, 'status').mockRejectedValue(new AuthError('STORAGE_UNAVAILABLE'));
    const { client, server } = await connect(auth);
    try {
      await client.listTools(); const output = await client.callTool({ name: 'auth_status', arguments: {} });
      expect(output.isError).toBe(true); expect(JSON.stringify(output)).toContain('STORAGE_UNAVAILABLE'); expect(output.structuredContent).toBeUndefined();
    } finally { await client.close(); await server.close(); }
  });
  it('calls all four developer tools with matching schema-validated structured/text outputs', async () => {
    const developer = setupDeveloper(); const { client, server, fetch } = await connect(new AuthService(), developer.service);
    try {
      await client.listTools();
      for (const call of [
        { name: 'list_my_apps', arguments: { page_size: 2 } },
        { name: 'get_my_app', arguments: { app_id: 201 } },
        { name: 'list_my_app_versions', arguments: { app_id: 201, page_size: 2 } },
        { name: 'get_my_app_version', arguments: { app_id: 201, version_id: 301 } },
      ]) {
        const output = await client.callTool(call); expect(output.isError).not.toBe(true); expect(output.structuredContent).toBeDefined();
        const text = output.content[0]; expect(text?.type).toBe('text'); if (text?.type === 'text') expect(JSON.parse(text.text)).toEqual(output.structuredContent);
        expect(JSON.stringify(output)).not.toMatch(/SYNTHETIC_PRIVATE|SYNTHETIC_AUTH_COOKIE|HIDDEN_SECRET|evil.example|token|email|testers/);
      }
      expect(fetch).not.toHaveBeenCalled(); expect(developer.save).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
  it('returns sanitized developer errors without private fields and rejects credential/owner overrides', async () => {
    const developer = setupDeveloper(); const { client, server } = await connect(new AuthService(), developer.service);
    try {
      await client.listTools();
      developer.load.mockResolvedValueOnce(null);
      const missing = await client.callTool({ name: 'list_my_apps', arguments: {} }); expect(missing.isError).toBe(true); expect(JSON.stringify(missing)).toContain('AUTH_REQUIRED');
      const wrong = await client.callTool({ name: 'get_my_app', arguments: { app_id: 999 } }); expect(wrong.isError).toBe(true); expect(JSON.stringify(wrong)).toContain('NOT_FOUND');
      const before = developer.fetch.mock.calls.length;
      const invalid = await client.callTool({ name: 'get_my_app_version', arguments: { app_id: 201, version_id: 301, user_id: 999, token: 'MUST_NOT_LEAK' } });
      expect(invalid.isError).toBe(true); expect(JSON.stringify(invalid)).not.toContain('MUST_NOT_LEAK'); expect(developer.fetch).toHaveBeenCalledTimes(before);
    } finally { await client.close(); await server.close(); }
  });
});
