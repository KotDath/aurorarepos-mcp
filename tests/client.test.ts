import { describe, expect, it, vi } from 'vitest';
import { setMaxListeners } from 'node:events';
import { AuroraClient, ORIGIN, type Fetch } from '../src/aurora/client.js';
import { RequestGate } from '../src/aurora/gate.js';
import { backend, guest, json } from './helpers.js';

describe('public HTTP client', () => {
  it('uses only the fixed origin, endpoint mapping, and refuses redirects', async () => {
    const fetch = backend();
    const client = new AuroraClient({ fetch, minIntervalMs: 0 });
    await client.categories(4);
    await client.categories(5);
    await client.author(101);
    expect(fetch.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/site/category/2', '/api/site/category/1', '/api/site/author/101']);
    for (const [url, init] of fetch.mock.calls) {
      expect(url.origin).toBe(ORIGIN);
      expect(init.redirect).toBe('error');
    }
  });

  it('bootstraps a shared guest session, keeps cookies/CSRF in headers and translates details OS', async () => {
    const fetch = backend();
    const client = new AuroraClient({ fetch, minIntervalMs: 0 });
    await Promise.all([client.app('example-timer', 5), client.app('example-notes', 4)]);
    expect(fetch.mock.calls.filter(([url]) => url.pathname === '/')).toHaveLength(1);
    const calls = fetch.mock.calls.filter(([url]) => url.pathname === '/api/site/appitem');
    expect(calls.map(([, init]) => JSON.parse(String(init.body)))).toEqual([
      { slug: 'example-timer', system: 5 }, { slug: 'example-notes', system: 4 },
    ]);
    for (const [, init] of calls) {
      const headers = new Headers(init.headers);
      expect(headers.get('cookie')).toContain('synthetic-cookie-secret');
      expect(headers.get('x-csrf-token')).toBe('synthetic-csrf-secret');
      expect(headers.get('origin')).toBe(ORIGIN);
    }
  });

  it('refreshes once after 419; never loops indefinitely', async () => {
    const fetch = backend();
    const original = fetch.getMockImplementation();
    let posts = 0;
    fetch.mockImplementation(async (url, init) => url.pathname === '/api/site/appitem' && posts++ === 0
      ? json({ message: 'secret upstream error' }, 419) : original!(url, init));
    await new AuroraClient({ fetch, minIntervalMs: 0 }).app('example-timer', 5);
    expect(posts).toBe(2);
    expect(fetch.mock.calls.filter(([url]) => url.pathname === '/')).toHaveLength(2);

    const rejected = vi.fn<Fetch>(async (url) => url.pathname === '/' ? guest() : json({}, 419));
    await expect(new AuroraClient({ fetch: rejected, minIntervalMs: 0 }).app('example-timer', 5)).rejects.toMatchObject({ code: 'CSRF_REJECTED' });
    expect(rejected).toHaveBeenCalledTimes(4);
  });

  it.each([401, 403, 404, 500])('does not retry HTTP %i and sanitizes upstream errors', async (status) => {
    const fetch = vi.fn<Fetch>(async () => json({ secret: 'must-not-leak' }, status));
    const error = await new AuroraClient({ fetch, minIntervalMs: 0 }).systems().catch((e: unknown) => e);
    expect(JSON.stringify(error)).not.toContain('must-not-leak');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([429, 502, 503, 504])('retries GET HTTP %i only once', async (status) => {
    const fetch = vi.fn<Fetch>().mockResolvedValueOnce(json({}, status)).mockResolvedValueOnce(json([]));
    await new AuroraClient({ fetch, minIntervalMs: 0 }).systems();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry early when Retry-After exceeds the waiting budget', async () => {
    const fetch = vi.fn<Fetch>(async () => json({}, 429, { 'Retry-After': '60' }));
    await expect(new AuroraClient({ fetch }).systems()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a GET network failure, but never repeats arbitrary public POST failures', async () => {
    const fetch = vi.fn<Fetch>().mockRejectedValueOnce(new Error('secret')).mockResolvedValueOnce(json([]));
    await new AuroraClient({ fetch, minIntervalMs: 0 }).systems();
    expect(fetch).toHaveBeenCalledTimes(2);
    const postFetch = vi.fn<Fetch>(async (url) => url.pathname === '/' ? guest() : json({}, 503));
    await expect(new AuroraClient({ fetch: postFetch, minIntervalMs: 0 }).app('example', 5)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(postFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    () => new Response('<html>secret</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
  ])('rejects HTML or malformed JSON', async (response) => {
    await expect(new AuroraClient({ fetch: async () => response() }).systems()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([true, false])('bounds response bodies with/without Content-Length (%s)', async (length) => {
    const response = () => new Response('x'.repeat(101), {
      headers: { 'Content-Type': 'application/json', ...(length ? { 'Content-Length': '101' } : {}) },
    });
    await expect(new AuroraClient({ fetch: async () => response(), maxResponseBytes: 100 }).systems()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });

  it('rejects a changed guest bootstrap without leaking its HTML', async () => {
    await expect(new AuroraClient({ fetch: async () => new Response('<html>secret</html>') }).app('example', 5)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('times out an in-flight fetch and handles caller cancellation', async () => {
    const fetch: Fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('secret abort details')), { once: true });
    });
    await expect(new AuroraClient({ fetch, timeoutMs: 20 }).systems()).rejects.toMatchObject({ code: 'TIMEOUT' });
    const abort = new AbortController();
    const pending = new AuroraClient({ fetch }).systems(abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('times out a stalled response body, not just response headers', async () => {
    const fetch: Fetch = async () => new Response(new ReadableStream<Uint8Array>({}), {
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(new AuroraClient({ fetch, timeoutMs: 20 }).systems()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('cancels an already aborted request before making a network call', async () => {
    const fetch = backend();
    const signal = AbortSignal.abort();
    await expect(new AuroraClient({ fetch }).systems(signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(new AuroraClient({ fetch }).app('example', 5, signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('request gate', () => {
  it('bounds pending queue length and cleans up cancelled waiters', async () => {
    const gate = new RequestGate(0, 1);
    const signal = new AbortController();
    setMaxListeners(0, signal.signal);
    let release: () => void = () => undefined;
    const active = gate.run(async () => new Promise<void>((resolve) => { release = resolve; }), signal.signal);
    // Let the active job start before filling the waiting queue.
    await Promise.resolve();
    const waiters = Array.from({ length: 64 }, () => gate.run(async () => undefined, signal.signal));
    const settled = Promise.allSettled(waiters);
    await expect(gate.run(async () => undefined, signal.signal)).rejects.toMatchObject({ code: 'BUSY' });
    signal.abort();
    release();
    await active;
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
  });
  it('limits concurrency to two and removes cancelled queued work', async () => {
    const gate = new RequestGate(0, 2);
    const signal = new AbortController().signal;
    const releases: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    const work = async () => {
      active++; peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
    };
    const first = gate.run(work, signal);
    const second = gate.run(work, signal);
    const cancelled = new AbortController();
    const third = gate.run(work, cancelled.signal);
    cancelled.abort();
    await expect(third).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(releases).toHaveLength(2);
    releases.forEach((release) => release());
    await Promise.all([first, second]);
    expect(peak).toBe(2);
  });

  it('spaces request starts even when requests run concurrently', async () => {
    const gate = new RequestGate(25, 2);
    const starts: number[] = [];
    await Promise.all(Array.from({ length: 3 }, () => gate.run(async () => { starts.push(Date.now()); }, new AbortController().signal)));
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(24);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(24);
  });
});
