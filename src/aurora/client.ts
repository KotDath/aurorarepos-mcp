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
  timeoutMs?: number;
  maxResponseBytes?: number;
  minIntervalMs?: number;
};

export class AuroraClient {
  private readonly jar = new CookieJar();
  private readonly fetch: Fetch;
  private readonly gate: RequestGate;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private csrf: string | undefined;
  private bootstrap: Promise<void> | undefined;

  constructor(options: ClientOptions = {}) {
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.gate = new RequestGate(options.minIntervalMs ?? 250);
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
    const cancellation = signal ?? new AbortController().signal;
    await this.ensureGuest(cancellation);
    const token = this.csrf;
    const url = new URL('/api/site/appitem', ORIGIN);
    try { return await this.request(url, 'POST', { slug, system: version }, cancellation); }
    catch (error) {
      if (!(error instanceof AuroraError) || error.code !== 'CSRF_REJECTED') throw error;
      // Another concurrent request may already have refreshed this token.
      if (this.csrf === token) this.csrf = undefined;
      await this.ensureGuest(cancellation);
      return this.request(url, 'POST', { slug, system: version }, cancellation);
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

  private async request(url: URL, method: 'GET' | 'POST', data?: object, signal?: AbortSignal, html = false): Promise<unknown> {
    if (url.origin !== ORIGIN) throw new AuroraError('ACCESS_DENIED');
    const cancellation = signal ?? new AbortController().signal;
    for (let attempt = 0; attempt < 2; attempt++) {
      let retryAfterMs = 500;
      try {
        const timed = AbortSignal.any([cancellation, AbortSignal.timeout(this.timeoutMs)]);
        return await this.gate.run(async () => {
          try {
            const headers = new Headers({
              Accept: html ? 'text/html' : 'application/json',
              'User-Agent': `aurorarepos-mcp/${VERSION} (+https://github.com/KotDath/aurorarepos-mcp)`,
            });
            const cookies = await this.jar.getCookieString(url.href);
            if (cookies) headers.set('Cookie', cookies);
            if (method === 'POST') {
              headers.set('Content-Type', 'application/json');
              headers.set('X-CSRF-TOKEN', this.csrf ?? '');
              headers.set('Origin', ORIGIN);
              headers.set('Referer', `${ORIGIN}/app`);
            }
            const response = await this.fetch(url, {
              method, headers, redirect: 'error', signal: timed,
              ...(data ? { body: JSON.stringify(data) } : {}),
            });
            for (const cookie of response.headers.getSetCookie()) {
              await this.jar.setCookie(cookie, url.href, { ignoreError: true });
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
            if (!html && !/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) {
              await response.body?.cancel();
              throw new AuroraError('INVALID_RESPONSE');
            }
            const text = await this.readBody(response, timed);
            if (html) return text;
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
