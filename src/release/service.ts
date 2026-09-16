import { plain } from '../aurora/normalize.js';
import { abortable, RequestGate } from '../aurora/gate.js';
import { checkSignal, readPackage } from './files.js';
import { ReleaseError } from './errors.js';
import * as s from './schemas.js';

export class ReleaseService {
  private readonly gate = new RequestGate(0, 1);
  constructor(private readonly timeoutMs = 30_000) {}
  async prepare(raw: unknown, signal?: AbortSignal) {
    const result = s.prepareInput.safeParse(raw);
    if (!result.success) throw new ReleaseError('INVALID_RELEASE_INPUT');
    const timed = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(this.timeoutMs)]);
    checkSignal(timed);
    return abortable(this.gate.run(async () => {
      checkSignal(timed);
      const input = result.data;
      const packages = [];
      for (const slot of ['rpm32', 'rpm64'] as const) {
        const file = input[`${slot}_path`]; if (!file) continue;
        const pkg = await readPackage(file, timed);
        if (pkg.metadata.arch !== (slot === 'rpm32' ? 'armv7hl' : 'aarch64')) throw new ReleaseError('UNSUPPORTED_RPM');
        packages.push({ slot, ...pkg });
      }
      if (packages.length === 2) {
        const a = packages[0]!.metadata, b = packages[1]!.metadata;
        if (a.name !== b.name || a.epoch !== b.epoch || a.version !== b.version || a.release !== b.release) throw new ReleaseError('PACKAGE_MISMATCH');
      }
      checkSignal(timed);
      return s.prepareOutput.parse({ kind: 'local_release_preview', uploaded: false, approval_granted: false,
        target: { app_id: input.app_id ?? null, ownership_verified: false, aurora_versions: [...input.aurora_versions].sort(), compatibility_verified: false },
        release_notes: plain(input.release_notes, 4000), packages, warnings: [...s.warningCodes] });
    }, timed), timed);
  }
}
