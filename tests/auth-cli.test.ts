import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

async function run(args: string[]) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)), ...args], { stdio: 'pipe' });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.end();
  const code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  return { code, stdout, stderr };
}
describe('safe account CLI', () => {
  it('rejects piped login before prompting/network/storage and preserves protocol stdout', async () => {
    const result = await run(['auth', 'login']);
    expect(result.code).toBe(1); expect(result.stdout).toBe(''); expect(result.stderr).toContain('INTERACTIVE_REQUIRED');
  });
  it.each([{ args: ['login', '--password', 'SYNTHETIC_PASSWORD'] }, { args: ['status', '--cookie', 'SYNTHETIC_COOKIE'] }, { args: ['logout', '--all'] }, { args: [] }])('rejects extra credential/unknown arguments without echoing them', async ({ args }) => {
    const result = await run(['auth', ...args]);
    expect(result.code).toBe(1); expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage:'); expect(result.stderr).not.toMatch(/SYNTHETIC_PASSWORD|SYNTHETIC_COOKIE/);
  });
});
