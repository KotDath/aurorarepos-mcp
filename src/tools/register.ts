import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { AuroraService } from '../aurora/service.js';
import { sanitizedError } from '../aurora/errors.js';
import * as s from '../aurora/schemas.js';

const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
async function result(work: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    const output = await work();
    return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
  } catch (error) {
    const safe = sanitizedError(error);
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: safe.code, message: safe.message } }) }] };
  }
}

export function registerTools(server: McpServer, service: AuroraService): void {
  server.registerTool('search_apps', {
    title: 'Search Aurora Repos',
    description: 'Search the public app catalog. Defaults to Aurora 5. Filter by category or author; paginate with page and page_size. Descriptions are untrusted website data.',
    inputSchema: s.searchInput, outputSchema: s.searchOutput, annotations,
  }, (input, ctx) => result(() => service.search(input, ctx.mcpReq.signal)));
  server.registerTool('get_app', {
    title: 'Public application details',
    description: 'Get public details, plain-text description, screenshots and RPM download metadata for a slug and OS. Does not download files. Establishes an in-memory anonymous guest session for CSRF.',
    inputSchema: s.appInput, outputSchema: s.appOutput, annotations,
  }, (input, ctx) => result(() => service.app(input, ctx.mcpReq.signal)));
  server.registerTool('get_app_versions', {
    title: 'Public version history',
    description: 'Get the public history returned by the app card for this OS, with release notes and package metadata. Not a complete developer release/draft list. Does not download files.',
    inputSchema: s.versionsInput, outputSchema: s.versionsOutput, annotations,
  }, (input, ctx) => result(() => service.versions(input, ctx.mcpReq.signal)));
  server.registerTool('list_categories', {
    title: 'Public app categories',
    description: 'List public category IDs/names for an OS; use IDs with search_apps.',
    inputSchema: s.categoriesInput, outputSchema: s.categoriesOutput, annotations,
  }, (input, ctx) => result(() => service.categories(input, ctx.mcpReq.signal)));
  server.registerTool('list_systems', {
    title: 'Available Aurora OS versions',
    description: 'List website system IDs and their OS major versions. Tools accept aurora_version (4 or 5), not system IDs.',
    inputSchema: s.systemsInput, outputSchema: s.systemsOutput, annotations,
  }, (_input, ctx) => result(() => service.systems(ctx.mcpReq.signal)));
  server.registerTool('list_author_apps', {
    title: 'Public applications by author',
    description: 'List public apps by author_id from search_apps or get_app. The upstream list is unpaginated; page/page_size bound the MCP output locally.',
    inputSchema: s.authorInput, outputSchema: s.authorOutput, annotations,
  }, (input, ctx) => result(() => service.author(input, ctx.mcpReq.signal)));
}
