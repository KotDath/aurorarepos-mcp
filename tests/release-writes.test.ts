import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupReleaseWrites } from './release-write-helpers.js';
import { syntheticRpm, stringTag } from './release-helpers.js';
import { releaseWriteOutput, scheduleInput } from '../src/writes/release-schemas.js';
import { FileAttemptJournal } from '../src/writes/journal.js';

describe('confirmed release writes', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'aurorarepos-release-write-')); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });
  it('uploads exact paired bytes once and preserves shared/contact/media fields', async () => {
    const t = await setupReleaseWrites(directory), before = structuredClone(t.state.editor);
    const preview = await t.service.preview('upload_release', t.args);
    expect(t.state.posts).toBe(0); expect(preview.message).toContain('Confirm this exact action');
    expect(preview.message).not.toMatch(/PRIVATE|SYNTHETIC|rpm32_path|email/);
    const result = releaseWriteOutput.parse(await t.service.commit('upload_release', t.args, preview.ticket));
    expect(result).toMatchObject({ uploaded: true, publication_state: 'pending_review', shared_metadata_preserved: true });
    expect(t.state.editor).toMatchObject({ description: before.description, site: before.site, email: before.email, icon: before.icon, screenshots: before.screenshots });
    const post = t.fetch.mock.calls.find(([, init]) => init.method === 'POST')!;
    expect(post[0].href).toBe('https://aurorarepos.ru/api/application'); expect(post[1].redirect).toBe('error');
    const headers = post[1].headers as Headers;
    expect(headers.has('Content-Type')).toBe(false); expect(headers.get('X-CSRF-TOKEN')).toBe('SYNTHETIC_RELEASE_CSRF');
    const form = post[1].body as FormData;
    expect(form.get('devuser')).toBe('101'); expect(form.get('validator')).toBe('true'); expect(form.getAll('screenInfo[]')).toEqual(['/image/screen/test.png']);
    expect(Buffer.from(await (form.get('file_rpm') as Blob).arrayBuffer())).toEqual(syntheticRpm().bytes);
    expect(t.state.posts).toBe(1); expect(t.save).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SYNTHETIC/);
    await expect(t.service.commit('upload_release', t.args, preview.ticket)).rejects.toMatchObject({ code: 'APPROVAL_INVALID' });
    await expect(t.service.preview('upload_release', t.args)).rejects.toMatchObject({ code: 'RELEASE_EXISTS' });
  });
  it('updates only requested metadata, escaping plain text and retaining RPMs', async () => {
    const t = await setupReleaseWrites(directory), before = structuredClone(t.state.versions[0]);
    const args = { app_id: 201, version_id: 301, description: 'New & local', category_id: 9, release_notes: 'Fresh text' };
    const preview = await t.service.preview('update_my_app_version', args);
    const result = await t.service.commit('update_my_app_version', args, preview.ticket);
    expect(result.uploaded).toBe(false); expect(t.state.editor.description).toBe('<p>New &amp; local</p>');
    const form = t.fetch.mock.calls.find(([, init]) => init.method === 'POST')![1].body as FormData;
    expect(form.has('file_rpm')).toBe(false); expect(form.has('file_rpm64')).toBe(false); expect(form.get('id')).toBe('301');
    expect(t.state.versions[0]).toMatchObject({ rpm32: before!.rpm32, sha256_32: before!.sha256_32, ver: before!.ver });
  });
  it.each([true, false])('sets/cancels website wall-clock schedule without status claims (%s)', async (is_delayed) => {
    const t = await setupReleaseWrites(directory);
    const args = { app_id: 201, version_id: 301, is_delayed, ...(is_delayed ? { publish_at: '2026-12-01T15:30' } : {}) };
    const preview = await t.service.preview('schedule_my_app_version', args);
    expect(preview.message).toContain('timezone is not verified');
    const result = await t.service.commit('schedule_my_app_version', args, preview.ticket);
    expect(t.state.editor.is_delayed).toBe(is_delayed); expect(result.scheduling_timezone_verified).toBe(false); expect(result.publication_state).toBe('published');
  });
  it.each(['2026-02-30T12:00', '2026-12-01T25:00', '2026-12-01T12:00Z', '2026-12-01 12:00'])('refuses invalid/ambiguous date %s', (publish_at) => {
    expect(scheduleInput.safeParse({ app_id: 201, version_id: 301, is_delayed: true, publish_at }).success).toBe(false);
  });
  it('requires date iff delayed is enabled', () => {
    expect(scheduleInput.safeParse({ app_id: 201, version_id: 301, is_delayed: true }).success).toBe(false);
    expect(scheduleInput.safeParse({ app_id: 201, version_id: 301, is_delayed: false, publish_at: '2026-12-01T12:00' }).success).toBe(false);
  });
  it.each(['network', '419', 'redirect', 'unchanged', 'bad-hash', 'erase-contact'])('does not retry uncertain %s result', async (mode) => {
    const t = await setupReleaseWrites(directory), plan = await t.service.preview('upload_release', t.args); t.state.mode = mode;
    await expect(t.service.commit('upload_release', t.args, plan.ticket)).rejects.toMatchObject({ code: 'WRITE_OUTCOME_UNKNOWN' });
    expect(t.state.posts).toBe(1); expect(t.journal.claim).toHaveBeenCalledTimes(1);
  });
  it('refuses changed package bytes after approval', async () => {
    const t = await setupReleaseWrites(directory), plan = await t.service.preview('upload_release', t.args);
    await writeFile(t.args.rpm32_path, syntheticRpm({ extra: [stringTag(1004, 'Changed RPM header')] }).bytes);
    await expect(t.service.commit('upload_release', t.args, plan.ticket)).rejects.toMatchObject({ code: 'RELEASE_FILE_CHANGED' }); expect(t.state.posts).toBe(0);
  });
  it('refuses stale shared metadata and switched session', async () => {
    const t = await setupReleaseWrites(directory), plan = await t.service.preview('upload_release', t.args); t.state.editor.email = 'changed@example.invalid';
    await expect(t.service.commit('upload_release', t.args, plan.ticket)).rejects.toMatchObject({ code: 'WRITE_STATE_CHANGED' });
    const next = await t.service.preview('upload_release', t.args); t.load.mockResolvedValue(null);
    await expect(t.service.commit('upload_release', t.args, next.ticket)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' }); expect(t.state.posts).toBe(0);
  });
  it.each(['admin', 'user', 'guest'])('refuses unverified role %s before editor/private reads', async (role) => {
    const t = await setupReleaseWrites(directory); t.state.role = role;
    await expect(t.service.preview('upload_release', t.args)).rejects.toBeDefined();
    expect(t.fetch.mock.calls).toHaveLength(1); expect(t.state.posts).toBe(0);
  });
  it('rejects unknown flags, empty edits, forged/declined/expired tickets', async () => {
    let now = Date.now(); const t = await setupReleaseWrites(directory, undefined, () => now);
    await expect(t.service.preview('upload_release', { ...t.args, confirm: true })).rejects.toMatchObject({ code: 'INVALID_WRITE_INPUT' });
    await expect(t.service.preview('update_my_app_version', { app_id: 201, version_id: 301 })).rejects.toMatchObject({ code: 'INVALID_WRITE_INPUT' });
    await expect(t.service.commit('upload_release', t.args, 'forged')).rejects.toMatchObject({ code: 'APPROVAL_INVALID' });
    const plan = await t.service.preview('upload_release', t.args); t.service.decline(plan.ticket);
    await expect(t.service.commit('upload_release', t.args, plan.ticket)).rejects.toMatchObject({ code: 'APPROVAL_INVALID' });
    const next = await t.service.preview('upload_release', t.args); now += 300_001;
    await expect(t.service.commit('upload_release', t.args, next.ticket)).rejects.toMatchObject({ code: 'APPROVAL_INVALID' }); expect(t.state.posts).toBe(0);
  });
  it('refuses wrong package name/architecture, Aurora 4 64-bit and mismatched pair', async () => {
    const t = await setupReleaseWrites(directory);
    await expect(t.service.preview('upload_release', { ...t.args, aurora_versions: [4] })).rejects.toMatchObject({ code: 'UNSUPPORTED_RPM' });
    await writeFile(t.args.rpm64_path, syntheticRpm({ arch: 'aarch64', version: '9.0' }).bytes);
    await expect(t.service.preview('upload_release', t.args)).rejects.toMatchObject({ code: 'PACKAGE_MISMATCH' });
    await writeFile(t.args.rpm32_path, syntheticRpm({ name: 'ru.example.Other' }).bytes);
    await expect(t.service.preview('upload_release', { ...t.args, rpm64_path: undefined })).rejects.toMatchObject({ code: 'RELEASE_TARGET_MISMATCH' });
  });
  it('refuses missing editor preservation fields and external asset URLs', async () => {
    const t = await setupReleaseWrites(directory); t.state.editor.icon = 'https://evil.example/private.png';
    await expect(t.service.preview('upload_release', t.args)).rejects.toMatchObject({ code: 'EDITOR_CONTRACT_UNVERIFIED' }); expect(t.state.posts).toBe(0);
    t.state.editor.icon = '';
    await expect(t.service.preview('upload_release', t.args)).rejects.toMatchObject({ code: 'EDITOR_CONTRACT_UNVERIFIED' });
  });
  it('retains durable attempt markers across service restart after an ambiguous upload', async () => {
    const journalDir = join(directory, 'attempts'), a = await setupReleaseWrites(directory, undefined);
    const journal = new FileAttemptJournal(journalDir);
    vi.spyOn(a.journal, 'claim').mockImplementation((key) => journal.claim(key));
    a.state.mode = 'network'; const plan = await a.service.preview('upload_release', a.args);
    await expect(a.service.commit('upload_release', a.args, plan.ticket)).rejects.toMatchObject({ code: 'WRITE_OUTCOME_UNKNOWN' });
    const b = await setupReleaseWrites(directory); vi.spyOn(b.journal, 'claim').mockImplementation((key) => new FileAttemptJournal(journalDir).claim(key));
    const next = await b.service.preview('upload_release', b.args);
    await expect(b.service.commit('upload_release', b.args, next.ticket)).rejects.toMatchObject({ code: 'WRITE_ALREADY_ATTEMPTED' }); expect(b.state.posts).toBe(0);
  });
  it('returns an uncertain outcome when cancelled during dispatch', async () => {
    const t = await setupReleaseWrites(directory, undefined, undefined, 1000), plan = await t.service.preview('upload_release', t.args);
    t.state.mode = 'stall';
    await expect(t.service.commit('upload_release', t.args, plan.ticket)).rejects.toMatchObject({ code: 'WRITE_OUTCOME_UNKNOWN' }); expect(t.state.posts).toBe(1);
  });
});
