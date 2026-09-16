import { CookieJar } from 'tough-cookie';
import { AuroraError, httpError } from './errors.js';
import { abortable, abortError, RequestGate, wait } from './gate.js';
import { VERSION } from '../version.js';

export const ORIGIN = 'https://aurorarepos.ru';
export type AuroraVersion = 4 | 5;
export const systemId = (version: AuroraVersion): number => version === 5 ? 1 : 2;
export type Fetch = (input: URL, init: RequestInit) => Promise<Response>;
export type ClientOptions = {
  fetch?: Fetch;
  jar?: CookieJar;
  gate?: RequestGate;
  timeoutMs?: number;
  maxResponseBytes?: number;
  minIntervalMs?: number;
};

export class AuroraClient {
  private readonly jar: CookieJar;
  private readonly fetch: Fetch;
  private readonly gate: RequestGate;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private csrf: string | undefined;
  private bootstrap: Promise<void> | undefined;

  constructor(options: ClientOptions = {}) {
    this.jar = options.jar ?? new CookieJar();
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.gate = options.gate ?? new RequestGate(options.minIntervalMs ?? 250);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
  }

  catalog(params: Record<string, string | number>, signal?: AbortSignal): Promise<unknown> {
    const url = new URL('/api/site/app', ORIGIN);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return this.request(url, 'GET', undefined, signal);
  }
  systems(signal?: AbortSignal): Promise<unknown> {
    return this.request(new URL('/api/system/any', ORIGIN), 'GET', undefined, signal);
  }
  categories(version: AuroraVersion, signal?: AbortSignal): Promise<unknown> {
    return this.request(new URL(`/api/site/category/${systemId(version)}`, ORIGIN), 'GET', undefined, signal);
  }
  author(id: number, signal?: AbortSignal): Promise<unknown> {
    if (!Number.isSafeInteger(id) || id < 1) throw new AuroraError('UPSTREAM_ERROR');
    return this.request(new URL(`/api/site/author/${id}`, ORIGIN), 'GET', undefined, signal);
  }
  async app(slug: string, version: AuroraVersion, signal?: AbortSignal): Promise<unknown> {
    return this.sessionPost('/api/site/appitem', { slug, system: version }, signal);
  }

  accountLogin(email: string, password: string, signal?: AbortSignal): Promise<unknown> {
    return this.sessionPost('/api/applogin', { email, password, code: null }, signal);
  }
  accountVerify(token: string, code: string, signal?: AbortSignal): Promise<unknown> {
    return this.sessionPost('/api/2fa/verify', { token, code }, signal);
  }
  accountResend(token: string, signal?: AbortSignal): Promise<unknown> {
    return this.sessionPost('/api/2fa/resend', { token }, signal);
  }
  accountRole(signal?: AbortSignal): Promise<unknown> {
    return this.request(new URL('/api/getrole', ORIGIN), 'GET', undefined, signal, false, true);
  }
  developerApps(page: number, size: number, signal?: AbortSignal): Promise<unknown> {
    const url = new URL('/api/application', ORIGIN);
    url.searchParams.set('page', String(page)); url.searchParams.set('pagination', String(size));
    return this.request(url, 'GET', undefined, signal);
  }
  developerApp(id: number, signal?: AbortSignal): Promise<unknown> {
    this.validId(id);
    return this.request(new URL(`/api/application/${id}`, ORIGIN), 'GET', undefined, signal);
  }
  developerVersions(id: number, page: number, size: number, signal?: AbortSignal): Promise<unknown> {
    this.validId(id);
    const url = new URL('/api/application/ver', ORIGIN);
    url.searchParams.set('id', String(id)); url.searchParams.set('page', String(page)); url.searchParams.set('pagination', String(size));
    return this.request(url, 'GET', undefined, signal);
  }
  developerVersion(id: number, signal?: AbortSignal): Promise<unknown> {
    this.validId(id);
    return this.request(new URL(`/api/application/appitem/${id}`, ORIGIN), 'GET', undefined, signal);
  }
  developerEditorName(id: number, signal?: AbortSignal): Promise<unknown> {
    this.validId(id);
    return this.request(new URL(`/api/application/name/${id}`, ORIGIN), 'GET', undefined, signal);
  }
  developerRelease(data: FormData, signal?: AbortSignal): Promise<unknown> {
    if (!this.csrf) throw new AuroraError('CSRF_REJECTED');
    return this.request(new URL('/api/application', ORIGIN), 'POST', data, signal);
  }
  async prepareDeveloperWrite(signal?: AbortSignal): Promise<void> {
    await this.ensureGuest(signal ?? new AbortController().signal);
  }
  developerAppName(id: number | '', name: string, signal?: AbortSignal): Promise<unknown> {
    if (id !== '') this.validId(id);
    if (!this.csrf) throw new AuroraError('CSRF_REJECTED');
    // Mutations deliberately bypass sessionPost's 419 refresh/retry path.
    return this.request(new URL('/api/application/appname', ORIGIN), 'POST', { id, name }, signal);
  }
  private validId(id: number): void {
    if (!Number.isSafeInteger(id) || id < 1) throw new AuroraError('UPSTREAM_ERROR');
  }

  private async sessionPost(path: string, data: object, signal?: AbortSignal): Promise<unknown> {
    const cancellation = signal ?? new AbortController().signal;
    await this.ensureGuest(cancellation);
    const token = this.csrf;
    const url = new URL(path, ORIGIN);
    try { return await this.request(url, 'POST', data, cancellation); }
    catch (error) {
      if (!(error instanceof AuroraError) || error.code !== 'CSRF_REJECTED') throw error;
      // Another concurrent request may already have refreshed this token.
      if (this.csrf === token) this.csrf = undefined;
      await this.ensureGuest(cancellation);
      return this.request(url, 'POST', data, cancellation);
    }
  }

  private async ensureGuest(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw abortError(signal);
    if (this.csrf) return;
    if (!this.bootstrap) {
      this.bootstrap = this.request(new URL('/', ORIGIN), 'GET', undefined, undefined, true)
        .then((html) => {
          if (typeof html !== 'string') throw new AuroraError('INVALID_RESPONSE');
          const tag = html.match(/<meta\b[^>]*\bname=["']csrf-token["'][^>]*>/i)?.[0];
          const token = tag?.match(/\bcontent=["']([^"']{1,512})["']/i)?.[1];
          if (!token || /[\r\n]/.test(token)) throw new AuroraError('INVALID_RESPONSE');
          this.csrf = token;
        }).finally(() => { this.bootstrap = undefined; });
    }
    // A cancelled waiter must not cancel the shared bootstrap for other calls.
    await abortable(this.bootstrap, signal);
  }

  private async request(url: URL, method: 'GET' | 'POST', data?: object | FormData, signal?: AbortSignal, html = false, plain = false): Promise<unknown> {
    if (url.origin !== ORIGIN) throw new AuroraError('ACCESS_DENIED');
    const cancellation = signal ?? new AbortController().signal;
    for (let attempt = 0; attempt < 2; attempt++) {
      let retryAfterMs = 500;
      try {
        const multipart = data instanceof FormData;
        const timed = AbortSignal.any([cancellation, AbortSignal.timeout(multipart ? Math.max(this.timeoutMs, 120_000) : this.timeoutMs)]);
        return await this.gate.run(async () => {
          try {
            const headers = new Headers({
              Accept: html ? 'text/html' : 'application/json',
              'User-Agent': `aurorarepos-mcp/${VERSION} (+https://github.com/KotDath/aurorarepos-mcp)`,
            });
            const cookies = await this.jar.getCookieString(url.href);
            if (cookies) headers.set('Cookie', cookies);
            if (method === 'POST') {
              if (!multipart) headers.set('Content-Type', 'application/json');
              headers.set('X-CSRF-TOKEN', this.csrf ?? '');
              headers.set('Origin', ORIGIN);
              headers.set('Referer', `${ORIGIN}/app`);
            }
            const accountPost = method === 'POST' && ['/api/applogin', '/api/2fa/verify', '/api/2fa/resend'].includes(url.pathname);
            if (accountPost) {
              headers.set('X-Requested-With', 'XMLHttpRequest');
              headers.set('Referer', `${ORIGIN}/login`);
            }
            if (url.pathname === '/api/getrole' || url.pathname.startsWith('/api/application')) headers.set('X-Requested-With', 'XMLHttpRequest');
            const response = await this.fetch(url, {
              method, headers, redirect: accountPost ? 'manual' : 'error', signal: timed,
              ...(data ? { body: multipart ? data : JSON.stringify(data) } : {}),
            });
            for (const cookie of response.headers.getSetCookie()) {
              await this.jar.setCookie(cookie, url.href, { ignoreError: true });
            }
            if (accountPost && response.status >= 300 && response.status < 400) {
              // Ignore Location entirely: never follow/forward a credential POST,
              // even if it points to HTTP or another origin. A 302/303 is only
              // a candidate; authentication requires a fixed HTTPS protected GET.
              await response.body?.cancel();
              if (url.pathname === '/api/2fa/resend' || ![302, 303].includes(response.status)) throw new AuroraError('REDIRECT_REJECTED');
              return {};
            }
            if (!response.ok) {
              const after = response.headers.get('retry-after');
              if (after) {
                const seconds = Number(after);
                retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(after) - Date.now();
                if (!Number.isFinite(retryAfterMs)) retryAfterMs = 500;
              }
              await response.body?.cancel();
              throw httpError(response.status);
            }
            if (!html && !plain && !/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) {
              await response.body?.cancel();
              throw new AuroraError('INVALID_RESPONSE');
            }
            const text = await this.readBody(response, timed);
            if (html || plain) return text;
            try { return JSON.parse(text) as unknown; }
            catch { throw new AuroraError('INVALID_RESPONSE'); }
          } catch (error) {
            if (timed.aborted) throw abortError(timed);
            if (error instanceof AuroraError) throw error;
            throw new AuroraError('NETWORK_ERROR');
          }
        }, timed);
      } catch (error) {
        if (cancellation.aborted) throw abortError(cancellation);
        const retryable = error instanceof AuroraError &&
          ['NETWORK_ERROR', 'RATE_LIMITED', 'UPSTREAM_UNAVAILABLE'].includes(error.code);
        // Respect long Retry-After values by returning an error rather than retrying early.
        if (method !== 'GET' || attempt || !retryable || retryAfterMs > 2000) throw error;
        await wait(Math.max(250, retryAfterMs), cancellation);
      }
    }
    throw new AuroraError('INTERNAL_ERROR');
  }

  private async readBody(response: Response, signal: AbortSignal): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new AuroraError('INVALID_RESPONSE');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (Number(response.headers.get('content-length')) > this.maxBytes) throw new AuroraError('RESPONSE_TOO_LARGE');
      while (true) {
        const { value, done } = await abortable(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > this.maxBytes) throw new AuroraError('RESPONSE_TOO_LARGE');
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
}
