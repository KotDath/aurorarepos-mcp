import { mkdtemp, rm, readdir, readFile, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileAttemptJournal } from '../src/writes/journal.js';
import { WriteService } from '../src/writes/service.js';
import { output } from '../src/writes/schemas.js';
import { setupWrites, memoryJournal } from './write-helpers.js';

describe('confirmed application card writes', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'aurorarepos-write-test-')); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });
  it.each(['create_app', 'rename_my_app'] as const)('previews and reconciles %s with no secret leakage or session writes', async (operation) => {
    const test = setupWrites(directory), args = operation === 'create_app' ? { name: 'New test app' } : { app_id: 201, name: 'New test app' };
    const preview = await test.service.preview(operation, args); expect(test.state.posts).toBe(0);
    expect(preview.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(preview.message).not.toMatch(/SYNTHETIC|token|email|PRIVATE/);
    expect(output.parse(await test.service.commit(operation, args, preview.ticket))).toMatchObject({ operation, name: args.name, publication_requested: false, release_created: false });
    const posts = test.fetch.mock.calls.filter(([, init]) => init.method === 'POST'); expect(posts).toHaveLength(1);
    expect(posts[0]?.[0].href).toBe('https://aurorarepos.ru/api/application/appname');
    const headers = new Headers(posts[0]?.[1].headers); expect(headers.get('X-CSRF-TOKEN')).toBe('SYNTHETIC_WRITE_CSRF');
    expect(headers.get('Cookie')).toContain('SYNTHETIC_WRITE_ACCOUNT_COOKIE'); expect(headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(posts[0]?.[1].redirect).toBe('error'); expect(JSON.parse(String(posts[0]?.[1].body))).toEqual({ id: operation === 'create_app' ? '' : 201, name: args.name });
    expect(test.save).not.toHaveBeenCalled();
  });
  it('rejects forged, reused, mismatched and declined tickets before dispatch', async () => {
    const test = setupWrites(directory), args = { app_id: 201, name: 'New name' };
    await expect(test.service.commit('rename_my_app', args, 'forged')).rejects.toMatchObject({ code: 'APPROVAL_INVALID' });
    const plan = await test.service.preview('rename_my_app', args);
    await expect(test.service.commit('rename_my_app', { ...args, name: 'Altered name' }, plan.ticket)).rejects.toMatchObject({ code: 'APPROVAL_INVALID' });
    await expect(test.service.commit('create_app', { name: args.name }, plan.ticket)).rejects.toMatchObject({ code: 'APPROVAL_INVALID' });
    test.service.decline(plan.ticket); await expect(test.service.commit('rename_my_app', args, plan.ticket)).rejects.toMatchObject({ code: 'APPROVAL_INVALID' });
    const next = await test.service.preview('rename_my_app', args); await test.service.commit('rename_my_app', args, next.ticket);
    await expect(test.service.commit('rename_my_app', args, next.ticket)).rejects.toMatchObject({ code: 'APPROVAL_INVALID' }); expect(test.state.posts).toBe(1);
  });
  it('consumes a ticket before concurrent commit calls', async () => {
    const test = setupWrites(directory), args = { name: 'New test app' }, plan = await test.service.preview('create_app', args);
    const results = await Promise.allSettled([test.service.commit('create_app', args, plan.ticket), test.service.commit('create_app', args, plan.ticket)]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']); expect(test.state.posts).toBe(1);
  });
  it('rejects expiry and prunes expired confirmations', async () => {
    let time = 1000; const test = setupWrites(directory, memoryJournal(), () => time), args = { name: 'New test app' };
    const plan = await test.service.preview('create_app', args); time += 5 * 60_000;
    await expect(test.service.commit('create_app', args, plan.ticket)).rejects.toMatchObject({ code: 'APPROVAL_INVALID' });
    expect(await test.service.preview('create_app', args)).toHaveProperty('ticket'); expect(test.state.posts).toBe(0);
  });
  it('refuses a session switch after approval', async () => {
    const test = setupWrites(directory), args = { name: 'New test app' }, plan = await test.service.preview('create_app', args);
    test.load.mockResolvedValue({ ...test.session, saved_at: '2026-09-16T00:00:00.000Z' });
    await expect(test.service.commit('create_app', args, plan.ticket)).rejects.toMatchObject({ code: 'WRITE_SESSION_CHANGED' }); expect(test.state.posts).toBe(0);
  });
  it('refuses local logout during network preflight', async () => {
    const test = setupWrites(directory), args = { name: 'New test app' }, plan = await test.service.preview('create_app', args);
    test.load.mockResolvedValueOnce(test.session).mockResolvedValueOnce(null);
    await expect(test.service.commit('create_app', args, plan.ticket)).rejects.toMatchObject({ code: 'WRITE_SESSION_CHANGED' }); expect(test.state.posts).toBe(0);
  });
  it('verifies role after CSRF bootstrap without falling back to guest writes', async () => {
    const test = setupWrites(directory), args = { name: 'New test app' }, plan = await test.service.preview('create_app', args), original = test.fetch.getMockImplementation()!;
    test.fetch.mockImplementation(async (url, init) => { if (url.pathname === '/') test.state.role = 'user'; return original(url, init); });
    await expect(test.service.commit('create_app', args, plan.ticket)).rejects.toMatchObject({ code: 'OWNERSHIP_UNVERIFIED' }); expect(test.state.posts).toBe(0);
  });
  it.each(['create_app', 'rename_my_app'] as const)('refuses stale %s state before writing', async (operation) => {
    const test = setupWrites(directory), args = operation === 'create_app' ? { name: 'New test app' } : { name: 'New test app', app_id: 201 };
    const plan = await test.service.preview(operation, args); test.state.rows[0]!.updated_at = 'changed';
    await expect(test.service.commit(operation, args, plan.ticket)).rejects.toMatchObject({ code: 'WRITE_STATE_CHANGED' }); expect(test.state.posts).toBe(0);
  });
  it.each(['admin', 'user', 'other'])('refuses non-dev %s scope before private catalog/write', async (role) => {
    const test = setupWrites(directory); test.state.role = role;
    await expect(test.service.preview('create_app', { name: 'New test app' })).rejects.toMatchObject({ code: 'OWNERSHIP_UNVERIFIED' });
    expect(test.fetch.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/getrole']); expect(test.state.posts).toBe(0);
  });
  it('refuses missing sessions, foreign app IDs and existing names', async () => {
    const test = setupWrites(directory); test.load.mockResolvedValueOnce(null);
    await expect(test.service.preview('create_app', { name: 'New test app' })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(test.service.preview('rename_my_app', { app_id: 888, name: 'New test app' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(test.service.preview('create_app', { name: test.state.rows[0]!.name })).rejects.toMatchObject({ code: 'APP_NAME_EXISTS' }); expect(test.state.posts).toBe(0);
  });
  it.each(['network', '419', 'redirect', 'invalid', 'unchanged'])('reports unknown %s outcome without retry or leaking response', async (mode) => {
    const journal = memoryJournal(), test = setupWrites(directory, journal), args = { name: 'New test app' }, plan = await test.service.preview('create_app', args); test.state.mode = mode;
    await expect(test.service.commit('create_app', args, plan.ticket)).rejects.toMatchObject({ code: 'WRITE_OUTCOME_UNKNOWN' }); expect(test.state.posts).toBe(1);
    const next = await test.service.preview('create_app', args);
    await expect(test.service.commit('create_app', args, next.ticket)).rejects.toMatchObject({ code: 'WRITE_ALREADY_ATTEMPTED' }); expect(test.state.posts).toBe(1);
  });
  it('reports cancellation after dispatch as unknown, but before dispatch as cancelled', async () => {
    const test = setupWrites(directory, memoryJournal(), undefined, 100), args = { name: 'New test app' }, plan = await test.service.preview('create_app', args); test.state.mode = 'stall';
    await expect(test.service.commit('create_app', args, plan.ticket)).rejects.toMatchObject({ code: 'WRITE_OUTCOME_UNKNOWN' }); expect(test.state.posts).toBe(1);
    const controller = new AbortController(); controller.abort();
    await expect(test.service.preview('create_app', args, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('never dispatches if the journal is unavailable', async () => {
    const journal = memoryJournal(), test = setupWrites(directory, journal), args = { name: 'New test app' }, plan = await test.service.preview('create_app', args);
    journal.claim.mockRejectedValue(Error('PRIVATE_STORAGE_PATH'));
    await expect(test.service.commit('create_app', args, plan.ticket)).rejects.toMatchObject({ code: 'WRITE_JOURNAL_UNAVAILABLE' }); expect(test.state.posts).toBe(0);
  });
  it.each([{ name: '' }, { name: '<script>evil</script>' }, { name: 'a'.repeat(201) }, { name: 'New name', confirm: true }])('rejects invalid inputs without storage/HTTP %j', async (input) => {
    const test = setupWrites(directory);
    await expect(test.service.preview('create_app', input)).rejects.toMatchObject({ code: 'INVALID_WRITE_INPUT' }); expect(test.load).not.toHaveBeenCalled(); expect(test.fetch).not.toHaveBeenCalled();
  });
  it('bounds pending confirmation capacity', async () => {
    const test = setupWrites(directory);
    for (let index = 0; index < 64; index++) await test.service.preview('create_app', { name: `New test app ${index}` });
    await expect(test.service.preview('create_app', { name: 'Next' })).rejects.toMatchObject({ code: 'APPROVAL_BUSY' }); expect(test.state.posts).toBe(0);
  });
  it('reuses durable markers across fresh service instances', async () => {
    const journal = new FileAttemptJournal(join(directory, 'attempts')), test = setupWrites(directory, journal), args = { name: 'New test app' };
    const plan = await test.service.preview('create_app', args); test.state.mode = 'network';
    await expect(test.service.commit('create_app', args, plan.ticket)).rejects.toMatchObject({ code: 'WRITE_OUTCOME_UNKNOWN' });
    const restarted = new WriteService(test.store, { fetch: test.fetch, minIntervalMs: 0 }, new FileAttemptJournal(join(directory, 'attempts')));
    const retry = await restarted.preview('create_app', args);
    await expect(restarted.commit('create_app', args, retry.ticket)).rejects.toMatchObject({ code: 'WRITE_ALREADY_ATTEMPTED' }); expect(test.state.posts).toBe(1);
    const records = await readdir(join(directory, 'attempts')); expect(records).toHaveLength(1);
    expect(records[0]).toMatch(/^[a-f0-9]{64}\.attempt$/); expect(await readFile(join(directory, 'attempts', records[0]!))).toHaveLength(0);
  });
});

describe('durable attempt journal', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'aurorarepos-journal-test-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  it('uses atomic claims across simultaneous instances', async () => {
    const path = join(directory, 'records'), a = new FileAttemptJournal(path), b = new FileAttemptJournal(path), key = 'a'.repeat(64);
    const results = await Promise.allSettled([a.claim(key), b.claim(key)]); expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await readdir(path)).toEqual([`${key}.attempt`]);
  });
  it('rejects malformed keys and full journals', async () => {
    const journal = new FileAttemptJournal(directory); await expect(journal.claim('../escape')).rejects.toMatchObject({ code: 'WRITE_JOURNAL_UNAVAILABLE' });
    for (let start = 0; start < 4096; start += 64) await Promise.all(Array.from({ length: 64 }, (_, offset) => writeFile(join(directory, `${start + offset}.attempt`), '')));
    await expect(journal.claim('b'.repeat(64))).rejects.toMatchObject({ code: 'WRITE_JOURNAL_UNAVAILABLE' });
  }, 30_000);
  it('refuses symlink/junction journal directories', async () => {
    const target = join(directory, 'actual'), alias = join(directory, 'alias'); await mkdir(target);
    await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(new FileAttemptJournal(alias).claim('c'.repeat(64))).rejects.toMatchObject({ code: 'WRITE_JOURNAL_UNAVAILABLE' });
  });
});
