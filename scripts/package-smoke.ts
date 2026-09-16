import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { syntheticRpm } from '../tests/release-helpers.js';
import { prepareOutput } from '../src/release/schemas.js';

// Install OUR locally packed artifact into a fresh disposable project.
// Registry dependencies are downloaded normally, or use --offline if cached.
// Never log account state, connect to the website, or write to the OS vault.
const run = promisify(execFile), root = dirname(dirname(fileURLToPath(import.meta.url)));
const pnpm = process.env.npm_execpath;
if (!pnpm || !isAbsolute(pnpm)) throw Error('Run with pnpm smoke:package');
const directory = await mkdtemp(join(tmpdir(), 'aurorarepos-package-smoke-'));
let client: Client | undefined;
try {
  await run(process.execPath, [pnpm, 'pack', '--pack-destination', directory], { cwd: root, timeout: 60_000 });
  const archives = (await readdir(directory)).filter((name) => name.endsWith('.tgz'));
  if (archives.length !== 1) throw Error('Expected one local archive');
  const archive = join(directory, archives[0]!);
  const { stdout } = await run('tar', ['-tzf', archive], { timeout: 10_000 });
  const entries = stdout.trim().split(/\r?\n/);
  if (entries.some((name) => !/^package\/(?:package\.json|README\.md|CHANGELOG\.md|LICENSE|dist\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:js|d\.ts))$/.test(name))) throw Error('Unexpected packaged file');
  const workspace = join(directory, 'consumer'); await mkdir(workspace);
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'aurorarepos-package-consumer', private: true, type: 'module' }));
  await run(process.execPath, [pnpm, 'add', archive, '--ignore-scripts', ...(process.argv.includes('--offline') ? ['--offline'] : [])], { cwd: workspace, timeout: 60_000 });
  const installed = join(workspace, 'node_modules', 'aurorarepos-mcp');
  const pkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')) as { version: string; bin: Record<string, string> };
  if (pkg.bin['aurorarepos-mcp'] !== 'dist/index.js') throw Error('Unexpected package entrypoint');
  const entry = join(installed, pkg.bin['aurorarepos-mcp']);
  const help = await run(process.execPath, [entry, '--help'], { cwd: workspace, timeout: 10_000 });
  if (help.stdout || !help.stderr.includes('auth login')) throw Error('CLI must reserve stdout for MCP');
  const rpm = join(directory, 'ru.example.Test-1.2.3-1.armv7hl.rpm'); await writeFile(rpm, syntheticRpm().bytes);
  for (const mode of ['legacy', 'auto'] as const) {
    client = new Client({ name: 'installed-package-smoke', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], cwd: workspace, stderr: 'pipe' });
    await client.connect(transport);
    if (client.getServerVersion()?.version !== pkg.version) throw Error('Version mismatch');
    const tools = await client.listTools();
    if (tools.tools.length !== 17 || !tools.tools.some((tool) => tool.name === 'upload_release')) throw Error('Missing installed tools');
    const preview = await client.callTool({ name: 'prepare_release', arguments: { rpm32_path: rpm, aurora_versions: [5] } });
    if (preview.isError || prepareOutput.parse(preview.structuredContent).uploaded !== false) throw Error('Installed local preflight failed');
    await client.close(); client = undefined;
  }
  console.log(JSON.stringify({ installed_package: pkg.version, archive_files: entries.length, tools: 17, protocol_modes: 2, website_requests: 0 }));
} finally {
  await client?.close(); await rm(directory, { recursive: true, force: true });
}
