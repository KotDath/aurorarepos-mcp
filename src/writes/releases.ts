import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { AuthClient } from '../auth/client.js';
import { SessionStore } from '../auth/store.js';
import { AuroraError } from '../aurora/errors.js';
import type { ClientOptions } from '../aurora/client.js';
import { ORIGIN } from '../aurora/client.js';
import { plain } from '../aurora/normalize.js';
import { abortable, RequestGate } from '../aurora/gate.js';
import { DeveloperService } from '../developer/service.js';
import { version as normalizeVersion } from '../developer/normalize.js';
import { checkSignal, readPackage } from '../release/files.js';
import { ReleaseError } from '../release/errors.js';
import { FileAttemptJournal, type AttemptJournal } from './journal.js';
import { WriteError } from './errors.js';
import * as s from './release-schemas.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const html = (value: string) => `<p>${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('\n', '<br>')}</p>`;
const system = (versions: number[]) => versions.length === 2 ? 3 : versions[0] === 4 ? 2 : 1;
const empty = (value: string | null | undefined) => value ?? '';
const wall = (value: string | null | undefined) => empty(value).replace(' ', 'T').slice(0, 16);
type Package = Awaited<ReturnType<typeof readPackage>> & { slot: 'rpm32' | 'rpm64' };
type State = { editor: s.Editor; versions: Awaited<ReturnType<DeveloperService['versionsForWrite']>> };
type Plan = { operation: s.ReleaseOperation; args: s.ReleaseArguments; sessionHash: string; stateHash: string; packages: string; expires: number };

export class ReleaseWriteService {
  private readonly pending = new Map<string, Plan>();
  private readonly gate = new RequestGate(0, 1);
  private readonly options: Omit<ClientOptions, 'jar'>;
  private readonly developer: DeveloperService;
  private readonly journal: AttemptJournal;
  constructor(private readonly store = new SessionStore(), options: Omit<ClientOptions, 'jar'> = {}, journal?: AttemptJournal,
    private readonly now: () => number = Date.now, private readonly timeoutMs = 120_000) {
    this.options = { ...options, gate: options.gate ?? new RequestGate(options.minIntervalMs ?? 250) };
    this.developer = new DeveloperService(store, this.options);
    this.journal = journal ?? new FileAttemptJournal(join(store.directory, 'write-attempts'));
  }
  private input(operation: s.ReleaseOperation, raw: unknown): s.ReleaseArguments {
    const parsed = (operation === 'upload_release' ? s.uploadInput : operation === 'update_my_app_version' ? s.updateInput : s.scheduleInput).safeParse(raw);
    if (!parsed.success) throw new WriteError('INVALID_WRITE_INPUT');
    return parsed.data;
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
  private async inspect(client: AuthClient, args: s.ReleaseArguments, signal: AbortSignal): Promise<State> {
    const app = await this.developer.appForWrite(client, args.app_id, signal);
    const versions = (await this.developer.versionsForWrite(client, app, signal)).sort((a, b) => a.id - b.id);
    const parsed = s.editorSchema.safeParse(await this.developer.editorForWrite(client, app, signal, 'version_id' in args ? args.version_id : undefined));
    if (!parsed.success) throw new WriteError('EDITOR_CONTRACT_UNVERIFIED');
    const editor = parsed.data;
    if (editor.screenshots.some((item) => item.application_id !== undefined && item.application_id !== app.id)) throw new AuroraError('OWNERSHIP_UNVERIFIED');
    // Retain only site-hosted asset references; never fetch/repost remote image bytes.
    for (const value of [editor.icon, ...editor.screenshots.map((item) => item.src)]) {
      const url = new URL(value, ORIGIN);
      if (url.origin !== ORIGIN || url.username || url.password || !url.pathname.startsWith('/image/') || url.search || url.hash) throw new WriteError('EDITOR_CONTRACT_UNVERIFIED');
    }
    if ('version_id' in args) {
      const selected = versions.find((item) => item.id === args.version_id);
      if (!selected || editor.ver !== selected.ver || editor.release !== selected.release || editor.system !== selected.system) throw new AuroraError('INVALID_RESPONSE');
    }
    return { editor, versions };
  }
  private async packages(args: s.ReleaseArguments, signal: AbortSignal, capture = false): Promise<Package[]> {
    if (!('aurora_versions' in args)) return [];
    const rows: Package[] = [];
    for (const slot of ['rpm32', 'rpm64'] as const) {
      const file = args[`${slot}_path`]; if (!file) continue;
      const pkg = await readPackage(file, signal, capture, 100_000_000);
      if (pkg.metadata.arch !== (slot === 'rpm32' ? 'armv7hl' : 'aarch64') || (slot === 'rpm64' && system(args.aurora_versions) === 2)) throw new ReleaseError('UNSUPPORTED_RPM');
      rows.push({ slot, ...pkg });
    }
    if (rows.length === 2) {
      const a = rows[0]!.metadata, b = rows[1]!.metadata;
      if (a.name !== b.name || a.version !== b.version || a.release !== b.release || a.epoch !== b.epoch) throw new ReleaseError('PACKAGE_MISMATCH');
    }
    return rows;
  }
  private packageHash(packages: Package[]) {
    return hash(packages.map((pkg) => ({ slot: pkg.slot, filename: pkg.filename, size_bytes: pkg.size_bytes, sha256: pkg.sha256, metadata: pkg.metadata })));
  }
  private checkUpload(args: s.ReleaseArguments, state: State, packages: Package[]) {
    if (!('aurora_versions' in args)) return;
    const pkg = packages[0]!.metadata;
    if (state.versions.some((row) => row.ver === pkg.version && row.release === pkg.release && row.system === system(args.aurora_versions))) throw new WriteError('RELEASE_EXISTS');
    const previous = state.versions.flatMap((row) => [row.rpm32, row.rpm64]).filter((value): value is string => !!value);
    if (previous.length && !previous.some((value) => {
      const url = new URL(value, ORIGIN);
      return url.origin === ORIGIN && decodeURIComponent(url.pathname.split('/').at(-1) ?? '').startsWith(`${pkg.name}-`);
    })) throw new WriteError('RELEASE_TARGET_MISMATCH');
  }
  private desired(args: s.ReleaseArguments, state: State, packages: Package[]): s.Editor {
    const editor = { ...state.editor };
    if ('aurora_versions' in args) {
      editor.ver = packages[0]!.metadata.version; editor.release = packages[0]!.metadata.release;
      editor.system = system(args.aurora_versions); editor.newcomment = html(args.release_notes);
    } else if ('is_delayed' in args) {
      editor.is_delayed = args.is_delayed; editor.publish_at = args.publish_at ?? '';
    } else {
      if (args.description !== undefined) editor.description = html(args.description);
      if (args.category_id !== undefined) editor.category_id = args.category_id;
      if (args.release_notes !== undefined) editor.newcomment = html(args.release_notes);
    }
    return editor;
  }
  private shared(editor: s.Editor) {
    return { name: editor.name, category_id: editor.category_id, description: plain(editor.description, 200_000),
      site: empty(editor.site), donate: empty(editor.donate), email: empty(editor.email), icon: editor.icon,
      validator: empty(editor.validator), notoff: empty(editor.notoff), user_id: editor.user_id,
      is_beta: editor.is_beta, is_delayed: editor.is_delayed, publish_at: wall(editor.publish_at),
      screenshots: editor.screenshots.map((item) => item.src).sort() };
  }
  private form(args: s.ReleaseArguments, editor: s.Editor, packages: Package[]): FormData {
    const form = new FormData();
    const fields = { app_id: args.app_id, ...('version_id' in args ? { id: args.version_id } : {}),
      name: editor.name, description: editor.description, cat_id: editor.category_id, ver: empty(editor.ver), release: empty(editor.release), system: editor.system,
      site: empty(editor.site), donate: empty(editor.donate), email: empty(editor.email), icon: editor.icon,
      validator: editor.validator === 'checked', notoff: editor.notoff === 'checked', newcomment: empty(editor.newcomment), devuser: editor.user_id,
      is_delayed: editor.is_delayed, publish_at: empty(editor.publish_at) };
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    for (const screenshot of editor.screenshots) form.append('screenInfo[]', screenshot.src);
    if ('aurora_versions' in args) {
      for (const slot of ['rpm32', 'rpm64'] as const) {
        const pkg = packages.find((item) => item.slot === slot);
        const field = slot === 'rpm32' ? 'file_rpm' : 'file_rpm64';
        if (pkg?.bytes) form.append(field, new Blob([new Uint8Array(pkg.bytes)], { type: 'application/x-rpm' }), pkg.filename);
        else form.append(field, slot === 'rpm32' ? 'null' : '');
      }
      form.append('size', String(packages.find((item) => item.slot === 'rpm32')?.size_bytes ?? 0));
    }
    return form;
  }
  async preview(operation: s.ReleaseOperation, raw: unknown, signal?: AbortSignal) {
    const args = this.input(operation, raw), timed = this.timed(signal);
    return abortable(this.gate.run(async () => {
      for (const [ticket, plan] of this.pending) if (plan.expires <= this.now()) this.pending.delete(ticket);
      if (this.pending.size >= 64) throw new WriteError('APPROVAL_BUSY');
      const { client, sessionHash } = await this.account(timed), state = await this.inspect(client, args, timed), packages = await this.packages(args, timed);
      this.checkUpload(args, state, packages);
      const desired = this.desired(args, state, packages), ticket = randomBytes(32).toString('base64url');
      checkSignal(timed);
      this.pending.set(ticket, { operation, args, sessionHash, stateHash: hash(state), packages: this.packageHash(packages), expires: this.now() + 300_000 });
      return { ticket, message: JSON.stringify({ action: operation, app_id: args.app_id, app_name: plain(state.editor.name, 200),
        version_id: 'version_id' in args ? args.version_id : null, version: desired.ver, release: desired.release, system: desired.system,
        packages: packages.map(({ slot, filename, sha256, size_bytes }) => ({ slot, filename, sha256, size_bytes })),
        changes: { ...('description' in args ? { description: args.description } : {}), ...('category_id' in args ? { category_id: args.category_id } : {}),
          ...('release_notes' in args ? { release_notes: args.release_notes } : {}), ...('is_delayed' in args ? { is_delayed: args.is_delayed, publish_at: args.publish_at } : {}) },
        preserved: 'Existing contacts, owner, icon, screenshots, beta and unchanged editor fields. No RPM replacement during metadata edits.',
        warning: 'Signatures/SDK compatibility and live write contract not verified. Server determines publication/moderation status. Scheduling uses website wall-clock time; timezone is not verified.',
        confirmation: 'Confirm this exact action?' }) };
    }, timed), timed);
  }
  decline(ticket: unknown): void { if (typeof ticket === 'string') this.pending.delete(ticket); }
  async commit(operation: s.ReleaseOperation, raw: unknown, ticket: unknown, signal?: AbortSignal) {
    const args = this.input(operation, raw), plan = typeof ticket === 'string' ? this.pending.get(ticket) : undefined;
    if (!plan || plan.expires <= this.now() || plan.operation !== operation || hash(plan.args) !== hash(args)) throw new WriteError('APPROVAL_INVALID');
    this.pending.delete(ticket as string);
    const timed = this.timed(signal); let dispatched = false;
    return abortable(this.gate.run(async () => {
      if (plan.expires <= this.now()) throw new WriteError('APPROVAL_INVALID');
      const { client, sessionHash } = await this.account(timed);
      if (sessionHash !== plan.sessionHash) throw new WriteError('WRITE_SESSION_CHANGED');
      await client.prepareWrite(timed);
      const before = await this.inspect(client, args, timed);
      if (hash(before) !== plan.stateHash) throw new WriteError('WRITE_STATE_CHANGED');
      const packages = await this.packages(args, timed, true);
      if (this.packageHash(packages) !== plan.packages) throw new WriteError('RELEASE_FILE_CHANGED');
      this.checkUpload(args, before, packages);
      const desired = this.desired(args, before, packages), body = this.form(args, desired, packages);
      const current = await abortable(this.store.load(), timed);
      if (!current || hash(current) !== sessionHash) throw new WriteError('WRITE_SESSION_CHANGED');
      const marker = hash({ operation, owner: before.editor.user_id, app_id: args.app_id,
        intent: operation === 'upload_release' ? { packages: packages.map(({ slot, sha256, metadata }) => ({ slot, sha256, metadata })), system: desired.system } : { args, before: plan.stateHash } });
      checkSignal(timed);
      try { await this.journal.claim(marker); } catch (error) { throw error instanceof WriteError ? error : new WriteError('WRITE_JOURNAL_UNAVAILABLE'); }
      checkSignal(timed);
      try {
        dispatched = true; await client.writeRelease(body, timed);
        const after = await this.inspect(client, args, timed);
        const matches = 'version_id' in args ? after.versions.filter((row) => row.id === args.version_id) : after.versions.filter((row) =>
          !before.versions.some((old) => old.id === row.id) && row.ver === desired.ver && row.release === desired.release && row.system === desired.system);
        if (matches.length !== 1 || hash(this.shared(after.editor)) !== hash(this.shared(desired))) throw new WriteError('WRITE_OUTCOME_UNKNOWN');
        const selected = matches[0]!;
        if (plain(selected.newcomment, 4000) !== plain(desired.newcomment, 4000)) throw new WriteError('WRITE_OUTCOME_UNKNOWN');
        if ('version_id' in args) {
          const old = before.versions.find((row) => row.id === args.version_id)!;
          if (selected.ver !== old.ver || selected.release !== old.release || selected.system !== old.system || selected.rpm32 !== old.rpm32 || selected.rpm64 !== old.rpm64 ||
            selected.sha256_32 !== old.sha256_32 || selected.sha256_64 !== old.sha256_64) throw new WriteError('WRITE_OUTCOME_UNKNOWN');
        } else {
          for (const pkg of packages) if (selected[pkg.slot === 'rpm32' ? 'sha256_32' : 'sha256_64']?.toLowerCase() !== pkg.sha256) throw new WriteError('WRITE_OUTCOME_UNKNOWN');
        }
        const version = normalizeVersion(selected);
        return s.releaseWriteOutput.parse({ operation, app_id: args.app_id, version, verified: true, uploaded: operation === 'upload_release',
          shared_metadata_preserved: true, publication_state: version.status.state, scheduling_timezone_verified: false });
      } catch { throw new WriteError('WRITE_OUTCOME_UNKNOWN'); }
    }, timed), timed).catch((error: unknown) => { if (dispatched) throw new WriteError('WRITE_OUTCOME_UNKNOWN'); throw error; });
  }
}
