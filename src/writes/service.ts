import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { AuthClient } from '../auth/client.js';
import { SessionStore } from '../auth/store.js';
import { AuroraError } from '../aurora/errors.js';
import { abortable, RequestGate } from '../aurora/gate.js';
import type { ClientOptions } from '../aurora/client.js';
import { DeveloperService } from '../developer/service.js';
import { checkSignal } from '../release/files.js';
import { WriteError } from './errors.js';
import { FileAttemptJournal, type AttemptJournal } from './journal.js';
import * as s from './schemas.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type SnapshotRow = { id: number; name: string; user_id: number; updated_at?: string | null | undefined };
const snapshot = (value: SnapshotRow) => {
  if (value.name.length > 200 || (value.updated_at?.length ?? 0) > 80) throw new AuroraError('INVALID_RESPONSE');
  return { id: value.id, name: value.name, user_id: value.user_id, updated_at: value.updated_at ?? null };
};
type Plan = { operation: s.Operation; args: s.Arguments; sessionHash: string; before: SnapshotRow[]; digest: string; expires: number };
export class WriteService {
  private readonly pending = new Map<string, Plan>();
  private readonly gate = new RequestGate(0, 1);
  private readonly options: Omit<ClientOptions, 'jar'>;
  private readonly developer: DeveloperService;
  private readonly journal: AttemptJournal;
  constructor(private readonly store = new SessionStore(), options: Omit<ClientOptions, 'jar'> = {}, journal?: AttemptJournal,
    private readonly now: () => number = Date.now, private readonly timeoutMs = 30_000) {
    this.options = { ...options, gate: options.gate ?? new RequestGate(options.minIntervalMs ?? 250) };
    this.developer = new DeveloperService(store, this.options);
    this.journal = journal ?? new FileAttemptJournal(join(store.directory, 'write-attempts'));
  }
  private input(operation: s.Operation, raw: unknown): s.Arguments {
    const value = (operation === 'create_app' ? s.createInput : s.renameInput).safeParse(raw);
    if (!value.success) throw new WriteError('INVALID_WRITE_INPUT'); return value.data;
  }
  private timed(signal?: AbortSignal): AbortSignal {
    return AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(this.timeoutMs)]);
  }
  private async account(signal: AbortSignal) {
    checkSignal(signal); const session = await abortable(this.store.load(), signal);
    if (!session) throw new AuroraError('AUTH_REQUIRED');
    const client = new AuthClient(session, this.options);
    if (await client.role(signal) !== 'dev') throw new AuroraError('OWNERSHIP_UNVERIFIED');
    return { client, sessionHash: hash(session) };
  }
  private async inspect(client: AuthClient, operation: s.Operation, args: s.Arguments, signal: AbortSignal) {
    if (operation === 'rename_my_app' && 'app_id' in args) return [snapshot(await this.developer.appForWrite(client, args.app_id, signal))];
    return (await this.developer.catalogForWrite(client, signal)).map(snapshot).sort((a, b) => a.id - b.id);
  }
  async preview(operation: s.Operation, raw: unknown, signal?: AbortSignal) {
    const args = this.input(operation, raw), timed = this.timed(signal); checkSignal(timed);
    return abortable(this.gate.run(async () => {
      for (const [key, plan] of this.pending) if (plan.expires <= this.now()) this.pending.delete(key);
      if (this.pending.size >= 64) throw new WriteError('APPROVAL_BUSY');
      const { client, sessionHash } = await this.account(timed), before = await this.inspect(client, operation, args, timed);
      if (before.some((app) => app.name === args.name)) throw new WriteError('APP_NAME_EXISTS');
      const ticket = randomBytes(32).toString('base64url'), plan: Plan = { operation, args, sessionHash, before,
        digest: hash(before), expires: this.now() + 5 * 60_000 };
      checkSignal(timed); this.pending.set(ticket, plan);
      return { ticket, message: JSON.stringify({ action: operation, app_id: 'app_id' in args ? args.app_id : null,
        previous_name: operation === 'rename_my_app' ? before[0]?.name : null, new_name: args.name,
        effect: 'Create/rename an app card only. Does not upload a release or publish it.',
        contract: 'Observed frontend; live writes have not been verified. Confirm this exact action?' }) };
    }, timed), timed);
  }
  decline(ticket: unknown): void { if (typeof ticket === 'string') this.pending.delete(ticket); }
  async commit(operation: s.Operation, raw: unknown, ticket: unknown, signal?: AbortSignal) {
    const args = this.input(operation, raw);
    const plan = typeof ticket === 'string' ? this.pending.get(ticket) : undefined;
    if (!plan || plan.expires <= this.now() || plan.operation !== operation || hash(plan.args) !== hash(args)) throw new WriteError('APPROVAL_INVALID');
    // Consume synchronously, before queueing/awaiting. Re-entry never resends.
    this.pending.delete(ticket as string);
    const timed = this.timed(signal); checkSignal(timed);
    let dispatched = false;
    return abortable(this.gate.run(async () => {
      if (plan.expires <= this.now()) throw new WriteError('APPROVAL_INVALID');
      const { client, sessionHash } = await this.account(timed);
      if (sessionHash !== plan.sessionHash) throw new WriteError('WRITE_SESSION_CHANGED');
      await client.prepareWrite(timed); // Bootstrap CSRF then verify role again.
      const before = await this.inspect(client, operation, args, timed);
      if (hash(before) !== plan.digest) throw new WriteError('WRITE_STATE_CHANGED');
      const current = await abortable(this.store.load(), timed);
      if (!current || hash(current) !== sessionHash) throw new WriteError('WRITE_SESSION_CHANGED');
      const marker = hash({ operation, account: sessionHash, args, before: operation === 'rename_my_app' ? before : undefined });
      checkSignal(timed);
      try { await this.journal.claim(marker); }
      catch (error) { throw error instanceof WriteError ? error : new WriteError('WRITE_JOURNAL_UNAVAILABLE'); }
      checkSignal(timed);
      try {
        dispatched = true;
        await client.writeName('app_id' in args ? args.app_id : '', args.name, timed);
        const rows = await this.inspect(client, operation, args, timed);
        const matches = operation === 'create_app' ? rows.filter((row) => row.name === args.name && !before.some((old) => old.id === row.id)) : rows.filter((row) => row.name === args.name && row.user_id === before[0]?.user_id);
        if (matches.length !== 1) throw new WriteError('WRITE_OUTCOME_UNKNOWN');
        return s.output.parse({ operation, app_id: matches[0]!.id, name: args.name, verified: true, publication_requested: false, release_created: false });
      } catch { throw new WriteError('WRITE_OUTCOME_UNKNOWN'); }
    }, timed), timed).catch((error: unknown) => {
      if (dispatched) throw new WriteError('WRITE_OUTCOME_UNKNOWN');
      throw error;
    });
  }
}
