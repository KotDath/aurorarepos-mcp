import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as schemas from '../src/aurora/schemas.js';

// Explicit, read-only, opt-in. Never invoked by pnpm check or CI.
const client = new Client({ name: 'live-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))] });
try {
  await client.connect(transport);
  await client.listTools();
  async function call(name: string, args: Record<string, unknown>) {
    const output = await client.callTool({ name, arguments: args });
    if (output.isError) throw new Error(`${name} failed: ${JSON.stringify(output.content)}`);
    return output.structuredContent;
  }
  const systems = schemas.systemsOutput.parse(await call('list_systems', {}));
  const categories = schemas.categoriesOutput.parse(await call('list_categories', {}));
  const search = schemas.searchOutput.parse(await call('search_apps', { page_size: 1 }));
  const first = search.apps[0];
  if (!first) throw new Error('No public application found for smoke check');
  const app = schemas.appOutput.parse(await call('get_app', { slug: first.slug }));
  const versions = schemas.versionsOutput.parse(await call('get_app_versions', { slug: first.slug }));
  if (!app.app.author_id) throw new Error('No author ID returned');
  const author = schemas.authorOutput.parse(await call('list_author_apps', { author_id: app.app.author_id, page_size: 1 }));
  console.log(JSON.stringify({ tools_checked: 6, systems: systems.systems.length, categories: categories.categories.length, catalog_total: search.pagination.total, slug: first.slug, public_versions: versions.pagination.total, author_total: author.pagination.total }));
} finally { await client.close(); }
