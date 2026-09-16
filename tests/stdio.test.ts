import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';

describe('built stdio entrypoint', () => {
  it.each(['legacy', 'auto'] as const)('connects and closes (%s)', async (mode) => {
    const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
      stderr: 'pipe',
    });
    const errors: string[] = [];
    transport.onerror = (error) => errors.push(error.message);
    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toMatchObject({ name: 'aurorarepos-mcp', version: '0.1.0' });
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(14);
      expect(errors).toEqual([]);
    } finally {
      await client.close();
    }
  }, 15_000);
});
