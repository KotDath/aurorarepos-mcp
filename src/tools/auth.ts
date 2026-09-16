import type { McpServer } from '@modelcontextprotocol/server';
import { AuthService, authStatusInput, authStatusOutput } from '../auth/service.js';
import { safeAuthError } from '../auth/errors.js';

export function registerAuthTool(server: McpServer, service: AuthService): void {
  server.registerTool('auth_status', {
    title: 'Account session status',
    description: 'Inspect the local encrypted account session. By default no website request is made; stored does not mean authenticated. Set verify=true to check a read-only protected endpoint. Never returns credentials/cookies. To log in, the user must run aurorarepos-mcp auth login in their own terminal; never request a password or 2FA code in chat.',
    inputSchema: authStatusInput, outputSchema: authStatusOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input, ctx) => {
    try {
      const output = authStatusOutput.parse(await service.status(input, ctx.mcpReq.signal));
      return { structuredContent: output, content: [{ type: 'text', text: JSON.stringify(output) }] };
    } catch (error) {
      const safe = safeAuthError(error);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: safe.code, message: safe.message } }) }] };
    }
  });
}
