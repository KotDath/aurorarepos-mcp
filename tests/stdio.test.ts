import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

describe('built stdio entrypoint', () => {
  const run = promisify(execFile);
  const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  it.each([
    { mode: 'legacy', yolo: false }, { mode: 'auto', yolo: false },
    { mode: 'legacy', yolo: true }, { mode: 'auto', yolo: true },
  ] as const)('connects and closes ($mode, yolo=$yolo)', async ({ mode, yolo }) => {
    const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry, ...(yolo ? ['--yolo'] : [])],
      stderr: 'pipe',
    });
    const errors: string[] = [];
    transport.onerror = (error) => errors.push(error.message);
    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toMatchObject({ name: 'aurorarepos-mcp', version: VERSION });
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(17);
      const writes = tools.filter((tool) => tool.annotations?.readOnlyHint === false);
      expect(writes).toHaveLength(5);
      for (const tool of writes) expect(tool.description).toContain(yolo ? 'YOLO mode' : 'Requires exact user form confirmation');
      expect(client.getInstructions()).toContain(yolo ? 'YOLO mode' : 'All writes require exact user form confirmation');
      expect(errors).toEqual([]);
    } finally {
      await client.close();
    }
  }, 15_000);
  it('documents YOLO in help without writing protocol stdout', async () => {
    const result = await run(process.execPath, [entry, '--help']);
    expect(result.stdout).toBe(''); expect(result.stderr).toContain('--yolo'); expect(result.stderr).toContain('auth login');
  });
  it('reports the release version on stderr', async () => {
    const result = await run(process.execPath, [entry, '--version']);
    expect(result.stdout).toBe(''); expect(result.stderr.trim()).toBe(VERSION);
  });
  it('rejects extra arguments instead of silently enabling YOLO', async () => {
    await expect(run(process.execPath, [entry, '--yolo', '--unknown'])).rejects.toMatchObject({ code: 1, stdout: '' });
    await expect(run(process.execPath, [entry, '--unknown'])).rejects.toMatchObject({ code: 1, stdout: '' });
  });
});
