import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { AuroraClient } from '../src/aurora/client.js';
import { AuroraService } from '../src/aurora/service.js';
import { backend, json } from './helpers.js';

describe('MCP tools over a protocol connection', () => {
  async function connect() {
    const fetch = backend();
    const server = createServer(new AuroraService(new AuroraClient({ fetch, minIntervalMs: 0 })));
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server, fetch };
  }

  it('exposes exactly six read-only tools with input/output schemas', async () => {
    const { client, server } = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['search_apps', 'get_app', 'get_app_versions', 'list_categories', 'list_systems', 'list_author_apps'].sort());
      for (const tool of tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.annotations?.destructiveHint).toBe(false);
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
});
