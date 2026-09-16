import type { z } from 'zod';
import { AuthClient } from '../auth/client.js';
import { SessionStore } from '../auth/store.js';
import type { ClientOptions } from '../aurora/client.js';
import { AuroraError } from '../aurora/errors.js';
import { abortable, abortError, RequestGate } from '../aurora/gate.js';
import { plain, safeUrl } from '../aurora/normalize.js';
import * as s from './schemas.js';
import * as n from './normalize.js';

type App = z.infer<typeof s.rawApp>;
type Version = z.infer<typeof s.rawVersion>;
type Page<T> = { current_page: number; per_page: number; last_page: number; total: number; data: T[] };
const MAX_PAGES = 25;
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new AuroraError('INVALID_RESPONSE');
  return result.data;
}
function pagination<T>(value: Page<T>, page: number, size: number) {
  if (value.current_page !== page || value.per_page !== size || value.data.length > size ||
    value.last_page !== Math.max(1, Math.ceil(value.total / size)) ||
    value.data.length !== Math.max(0, Math.min(size, value.total - (page - 1) * size))) throw new AuroraError('INVALID_RESPONSE');
  return { page, page_size: size, total: value.total, next_page: page < value.last_page ? page + 1 : null };
}
function validateApp(value: App, owner: number, id = value.id): void {
  if (value.id !== id || value.user_id !== owner) throw new AuroraError('OWNERSHIP_UNVERIFIED');
  if (value.latest_app) validateVersion(value.latest_app, id, owner);
}
function validateVersion(value: Version, appId: number, owner: number): void {
  if (value.application_id !== appId || (value.application && (value.application.id !== appId || value.application.user_id !== owner))) throw new AuroraError('OWNERSHIP_UNVERIFIED');
}
export class DeveloperService {
  private readonly options: Omit<ClientOptions, 'jar'>;
  constructor(private readonly store = new SessionStore(), options: Omit<ClientOptions, 'jar'> = {}, private readonly operationTimeoutMs = 30_000) {
    this.options = { ...options, gate: options.gate ?? new RequestGate(options.minIntervalMs ?? 250) };
  }
  private async account(signal: AbortSignal): Promise<AuthClient> {
    if (signal.aborted) throw abortError(signal);
    const session = await abortable(this.store.load(), signal);
    if (!session) throw new AuroraError('AUTH_REQUIRED');
    const client = new AuthClient(session, this.options);
    if (await client.role(signal) !== 'dev') throw new AuroraError('OWNERSHIP_UNVERIFIED');
    return client;
  }
  private deadline(signal?: AbortSignal): AbortSignal {
    return AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(this.operationTimeoutMs)]);
  }
  private async appsPage(client: AuthClient, page: number, size: number, signal: AbortSignal, owner?: number) {
    const value = parse(s.rawApps, await client.apps(page, size, signal)).data;
    pagination(value, page, size);
    const knownOwner = owner ?? value.data[0]?.user_id;
    if (knownOwner !== undefined) for (const app of value.data) validateApp(app, knownOwner);
    return value;
  }
  private async owned(client: AuthClient, id: number, signal: AbortSignal): Promise<App> {
    let owner: number | undefined;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const value = await this.appsPage(client, page, 20, signal, owner);
      owner ??= value.data[0]?.user_id;
      const match = value.data.find((app) => app.id === id);
      if (match) return match;
      if (page >= value.last_page) throw new AuroraError('NOT_FOUND');
    }
    throw new AuroraError('LOOKUP_LIMIT');
  }
  private async versionsPage(client: AuthClient, app: App, page: number, size: number, signal: AbortSignal) {
    const value = parse(s.rawVersions, await client.versions(app.id, page, size, signal)).data;
    pagination(value, page, size);
    for (const version of value.data) validateVersion(version, app.id, app.user_id);
    return value;
  }
  async listApps(raw: unknown, signal?: AbortSignal) {
    const { page, page_size } = s.appsInput.parse(raw), timed = this.deadline(signal), client = await this.account(timed);
    const anchor = await this.appsPage(client, 1, page === 1 ? page_size : 1, timed);
    if (anchor.total > 0 && !anchor.data[0]) throw new AuroraError('INVALID_RESPONSE');
    const value = page === 1 ? anchor : await this.appsPage(client, page, page_size, timed, anchor.data[0]?.user_id);
    if (page !== 1 && !anchor.data[0] && value.data.length > 0) throw new AuroraError('OWNERSHIP_UNVERIFIED');
    return s.appsOutput.parse({ apps: value.data.map((app) => n.app(app, false)), pagination: pagination(value, page, page_size) });
  }
  async app(raw: unknown, signal?: AbortSignal) {
    const { app_id } = s.appInput.parse(raw), timed = this.deadline(signal), client = await this.account(timed);
    const owned = await this.owned(client, app_id, timed);
    const value = parse(s.rawApp, await client.app(app_id, timed)); validateApp(value, owned.user_id, app_id);
    return s.appOutput.parse({ app: n.app(value) });
  }
  async listVersions(raw: unknown, signal?: AbortSignal) {
    const { app_id, page, page_size } = s.versionsInput.parse(raw), timed = this.deadline(signal), client = await this.account(timed);
    const app = await this.owned(client, app_id, timed), value = await this.versionsPage(client, app, page, page_size, timed);
    return s.versionsOutput.parse({ app_id, versions: value.data.map((version) => n.version(version, 500)), pagination: pagination(value, page, page_size) });
  }
  async version(raw: unknown, signal?: AbortSignal) {
    const { app_id, version_id } = s.versionInput.parse(raw), timed = this.deadline(signal), client = await this.account(timed);
    const app = await this.owned(client, app_id, timed);
    let selected: Version | undefined;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const value = await this.versionsPage(client, app, page, 20, timed);
      selected = value.data.find((version) => version.id === version_id);
      if (selected) break;
      if (page >= value.last_page) throw new AuroraError('NOT_FOUND');
    }
    if (!selected) throw new AuroraError('LOOKUP_LIMIT');
    const details = parse(s.rawApp, await client.version(version_id, timed));
    // latest_app is overall metadata, not necessarily the selected release.
    validateApp(details, app.user_id, app_id);
    if (details.ver !== selected.ver || details.release !== selected.release || details.system !== selected.system) throw new AuroraError('INVALID_RESPONSE');
    for (const screenshot of details.screenshots ?? []) if (screenshot.application_id !== undefined && screenshot.application_id !== app_id) throw new AuroraError('OWNERSHIP_UNVERIFIED');
    return s.versionOutput.parse({ version: n.version(selected), shared_app_description: plain(details.description, 8000),
      screenshots: (details.screenshots ?? []).flatMap((item) => { const url = safeUrl(item.src, '/image/'); return url ? [url] : []; }).slice(0, 10) });
  }
}
