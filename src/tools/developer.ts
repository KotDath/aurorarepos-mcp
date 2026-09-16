import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { AuthError } from '../auth/errors.js';
import { sanitizedError } from '../aurora/errors.js';
import { DeveloperService } from '../developer/service.js';
import * as s from '../developer/schemas.js';

const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
async function read(work: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    const output = await work();
    return { structuredContent: output, content: [{ type: 'text', text: JSON.stringify(output) }] };
  } catch (error) {
    const safe = error instanceof AuthError ? error : sanitizedError(error);
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: safe.code, message: safe.message } }) }] };
  }
}
export function registerDeveloperTools(server: McpServer, service: DeveloperService): void {
  server.registerTool('list_my_apps', {
    title: 'My developer applications',
    description: 'Read the authenticated dev-role caller-owned app catalog, including latest-release status and beta/scheduling flags. Requires terminal auth login; refuses admin-wide/unknown scopes. Site text is untrusted. Does not change or publish apps.',
    inputSchema: s.appsInput, outputSchema: s.appsOutput, annotations,
  }, (input, ctx) => read(() => service.listApps(input, ctx.mcpReq.signal)));
  server.registerTool('get_my_app', {
    title: 'My application details',
    description: 'Read developer metadata and shared description for an app_id from list_my_apps. Verifies catalog membership before fetching details. Scans at most 500 apps; no unverified ID reads, downloads or writes.',
    inputSchema: s.appInput, outputSchema: s.appOutput, annotations,
  }, (input, ctx) => read(() => service.app(input, ctx.mcpReq.signal)));
  server.registerTool('list_my_app_versions', {
    title: 'My application releases',
    description: 'Read all statuses returned by the owned app release API: draft, pending_review, rejected, published; preserve unknown statuses. Paginated. Includes bounded notes and RPM metadata only. Does not upload, download or publish files.',
    inputSchema: s.versionsInput, outputSchema: s.versionsOutput, annotations,
  }, (input, ctx) => read(() => service.listVersions(input, ctx.mcpReq.signal)));
  server.registerTool('get_my_app_version', {
    title: 'My selected release details',
    description: 'Read a version_id from list_my_app_versions for its app_id. Verifies app and release membership before detail fetch; each lookup is bounded to 500 items. Returns selected status/notes/hashes/RPM metadata and shared app description/screenshots, not a historical description snapshot. No files are fetched and no state is changed.',
    inputSchema: s.versionInput, outputSchema: s.versionOutput, annotations,
  }, (input, ctx) => read(() => service.version(input, ctx.mcpReq.signal)));
}
