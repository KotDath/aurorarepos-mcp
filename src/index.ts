#!/usr/bin/env node
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';
import { VERSION } from './version.js';

// stdout belongs exclusively to the MCP transport, including at startup.
if (process.argv.length > 2) {
  const argument = process.argv[2];
  if (argument === '--version') console.error(VERSION);
  else if (argument === '--help') console.error('aurorarepos-mcp: anonymous read-only stdio MCP server. Run without arguments from an MCP host.');
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
