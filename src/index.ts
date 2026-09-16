#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';

// stdout belongs exclusively to the MCP transport, including at startup.
void serveStdio(createServer);
