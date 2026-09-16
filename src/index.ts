#!/usr/bin/env node
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';
import { VERSION } from './version.js';
import { runAuthCli } from './auth/cli.js';

// stdout belongs exclusively to the MCP transport, including at startup.
if (process.argv[2] === 'auth') {
  await runAuthCli(process.argv.slice(3));
} else if (process.argv.length > 2) {
  const argument = process.argv[2];
  if (argument === '--version') console.error(VERSION);
  else if (argument === '--help') console.error('aurorarepos-mcp: stdio MCP server with public/developer reads, local RPM preview and user-confirmed app-card writes. Run without arguments from an MCP host. Account CLI: auth login | auth status [--verify] | auth logout.');
  else { console.error('Unsupported argument. Use --help.'); process.exitCode = 1; }
} else {
  const handle = serveStdio(() => createServer(), {
    transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 64 * 1024 }),
    onerror: () => console.error('MCP transport error. Raw messages are not logged.'),
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void handle.close(); });
  }
}
