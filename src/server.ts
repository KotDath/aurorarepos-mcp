import { McpServer } from '@modelcontextprotocol/server';
import { VERSION } from './version.js';

export function createServer(): McpServer {
  return new McpServer({ name: 'aurorarepos-mcp', version: VERSION });
}
