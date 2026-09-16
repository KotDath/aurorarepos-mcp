import { randomBytes, randomUUID } from 'node:crypto';
import { AsyncEntry } from '@napi-rs/keyring';

// Opt-in native OS integration; never runs in pnpm check. Does not use accounts.
try {
  const entry = new AsyncEntry('aurorarepos-mcp-storage-test', randomUUID(), { linux: { store: 'secret-service' } });
  const secret = randomBytes(32).toString('base64');
  try {
    await entry.setPassword(secret, AbortSignal.timeout(10_000));
    if (await entry.getPassword(AbortSignal.timeout(10_000)) !== secret) throw new Error('Round-trip failed');
  } finally { await entry.deleteCredential(AbortSignal.timeout(10_000)); }
  if (await entry.getPassword(AbortSignal.timeout(10_000)) != null) throw new Error('Deletion failed');
  console.log(`Native OS keyring write/read/delete: PASS (${process.platform}/${process.arch})`);
} catch {
  console.error('Native keyring smoke failed. Unlock/configure the OS vault; no plaintext fallback is used. Review aurorarepos-mcp-storage-test entries if deletion failed.');
  process.exitCode = 1;
}
