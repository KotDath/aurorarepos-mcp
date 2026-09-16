#!/usr/bin/env node
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';
import { VERSION } from './version.js';
import { runAuthCli } from './auth/cli.js';

// stdout belongs exclusively to the MCP transport, including at startup.
const args = process.argv.slice(2);
if (args[0] === 'auth') {
  await runAuthCli(process.argv.slice(3));
} else if (args.length !== 0 && !(args.length === 1 && args[0] === '--yolo')) {
  const argument = args.length === 1 ? args[0] : undefined;
  if (argument === '--version') console.error(VERSION);
  else if (argument === '--help') console.error('aurorarepos-mcp: stdio MCP server with public/developer reads, local RPM preview and app-card/release writes. Run without arguments for user-confirmed writes, or with --yolo to execute writes without MCP confirmation. Account CLI: auth login | auth status [--verify] | auth logout.');
  else { console.error('Unsupported argument. Use --help.'); process.exitCode = 1; }
} else {
  const yolo = args[0] === '--yolo';
  if (yolo) console.error('YOLO mode: MCP write confirmations are disabled. Agent tool calls can change Aurora Repos immediately.');
  const handle = serveStdio(() => createServer(undefined, undefined, undefined, undefined, undefined, undefined, { yolo }), {
    transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 64 * 1024 }),
    onerror: () => console.error('MCP transport error. Raw messages are not logged.'),
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void handle.close(); });
  }
}
