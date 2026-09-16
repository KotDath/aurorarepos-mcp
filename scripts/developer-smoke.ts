import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as s from '../src/developer/schemas.js';

// Explicit opt-in authenticated GET reads. No credentials or account payloads
// are logged/saved; preserve only OS-vault/location metadata, not all env.
const env: Record<string, string> = {};
for (const key of ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_DATA_HOME']) {
  const value = process.env[key]; if (value && !value.startsWith('()')) env[key] = value;
}
const client = new Client({ name: 'developer-live-smoke', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))], env }));
  const tools = await client.listTools();
  for (const name of ['list_my_apps', 'get_my_app', 'list_my_app_versions', 'get_my_app_version']) if (!tools.tools.some((tool) => tool.name === name)) throw Error('Missing developer tool');
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw Error('Developer tool failed');
    return result.structuredContent;
  }
  const apps = s.appsOutput.parse(await call('list_my_apps', { page_size: 1 }));
  const first = apps.apps[0]; if (!first) throw Error('No owned application for smoke check');
  s.appOutput.parse(await call('get_my_app', { app_id: first.id }));
  const versions = s.versionsOutput.parse(await call('list_my_app_versions', { app_id: first.id, page_size: 1 }));
  const release = versions.versions[0]; if (!release) throw Error('No owned release for smoke check');
  const detail = s.versionOutput.parse(await call('get_my_app_version', { app_id: first.id, version_id: release.id }));
  console.log(JSON.stringify({ tools_checked: 4, apps_total: apps.pagination.total, versions_total: versions.pagination.total, selected_status: detail.version.status.state }));
} catch {
  console.error('Developer live smoke failed. Check auth status --verify, dev role and whether your account has an app/release. No private response is logged.');
  process.exitCode = 1;
} finally { await client.close(); }
