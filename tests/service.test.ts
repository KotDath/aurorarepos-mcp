import { describe, expect, it } from 'vitest';
import { AuroraClient } from '../src/aurora/client.js';
import { AuroraService } from '../src/aurora/service.js';
import { plain, safeUrl, versionsFromIds } from '../src/aurora/normalize.js';
import * as s from '../src/aurora/schemas.js';
import { backend, fixture, json } from './helpers.js';

function setup() {
  const fetch = backend();
  return { fetch, service: new AuroraService(new AuroraClient({ fetch, minIntervalMs: 0 })) };
}

describe('public service contract', () => {
  it('maps search filters, pagination and numeric OS IDs', async () => {
    const { fetch, service } = setup();
    const output = await service.search(s.searchInput.parse({ query: 'timer', aurora_version: 4, category_id: 7, author_id: 101, page_size: 2 }));
    const url = fetch.mock.calls[0]![0];
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '1', pagination: '2', search: 'timer', sortable: 'newest', system: '2', id: '7', user_id: '101' });
    expect(output.pagination.next_page).toBe(2);
    expect(output.apps[0]?.description).toBe('A timer & clock.');
    expect(output.apps[1]?.aurora_versions).toEqual([4, 5]);
    expect(s.searchOutput.safeParse(output).success).toBe(true);
  });

  it('normalizes nulls and empty search results', async () => {
    const { fetch, service } = setup();
    fetch.mockResolvedValueOnce(json({ current_page: 1, last_page: 1, total: 0, data: [] }));
    expect(await service.search(s.searchInput.parse({}))).toEqual({ apps: [], pagination: { page: 1, page_size: 10, total: 0, next_page: null } });
  });

  it('normalizes app, release packages, history and screenshot URLs', async () => {
    const { service } = setup();
    const app = await service.app(s.appInput.parse({ slug: 'example-timer' }));
    expect(app.description).toBe('A timer.');
    expect(app.category).toBe('Utilities');
    expect(app.downloads.armv7hl?.sha256).toBe('a'.repeat(64));
    expect(app.downloads.aarch64).toBeNull();
    expect(app.screenshots[0]).toBe('https://aurorarepos.ru/image/screen/example-timer-1.png');
    const history = await service.versions(s.versionsInput.parse({ slug: 'example-timer' }));
    expect(history.versions[0]?.notes).toBe('First release.');
    expect(history.versions[0]?.created_at).toBe('16-09-2026');
    expect(history.pagination.total).toBe(1);
    expect(history.pagination.next_page).toBeNull();
  });

  it('locally paginates author apps and handles application_id', async () => {
    const { service } = setup();
    const output = await service.author(s.authorInput.parse({ author_id: 101, page: 2, page_size: 1 }));
    expect(output.apps.map((a) => a.id)).toEqual([1002]);
    expect(output.apps[0]?.author_id).toBe(101);
    expect(output.pagination.total).toBe(2);
  });

  it('lists categories and maps system major versions', async () => {
    const { service } = setup();
    expect((await service.categories(s.categoriesInput.parse({}))).categories[0]).toEqual({ id: 7, name: 'Utilities' });
    expect((await service.systems()).systems.map((x) => x.aurora_version)).toEqual([5, 4]);
  });

  it('strips unknown fields, secrets and contact details even from nested raw responses', async () => {
    const { fetch, service } = setup();
    const app = fixture('app') as { data: Record<string, unknown> };
    Object.assign(app.data, { token: 'FAKE_SECRET_TOKEN', email: 'PRIVATE_EMAIL', csrf: 'FAKE_CSRF', hidden: 'PRIVATE_HIDDEN' });
    app.data.latest_app = { ...(app.data.latest_app as object), token: 'NESTED_SECRET' };
    fetch.mockImplementation(async (url) => url.pathname === '/' ? new Response('<meta name="csrf-token" content="TEST">') : json(app));
    const output = JSON.stringify(await service.app(s.appInput.parse({ slug: 'example-timer' })));
    for (const secret of ['FAKE_SECRET_TOKEN', 'PRIVATE_EMAIL', 'FAKE_CSRF', 'PRIVATE_HIDDEN', 'NESTED_SECRET']) expect(output).not.toContain(secret);
  });

  it('fails closed on incompatible upstream schemas', async () => {
    const { fetch, service } = setup();
    fetch.mockResolvedValueOnce(json({ data: 'changed-api-secret' }));
    await expect(service.search(s.searchInput.parse({}))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('does not claim empty history when the history field is missing', async () => {
    const { fetch, service } = setup();
    const app = fixture('app') as { data: Record<string, unknown> };
    delete app.data.history;
    fetch.mockImplementation(async (url) => url.pathname === '/' ? new Response('<meta name="csrf-token" content="TEST">') : json(app));
    await expect(service.versions(s.versionsInput.parse({ slug: 'example-timer' }))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('filters mixed OS history before local pagination, including combined system ID 3', async () => {
    const { fetch, service } = setup();
    const app = fixture('app') as { data: { history: Record<string, unknown>[] } };
    const first = app.data.history[0]!;
    app.data.history.push({ ...first, id: 2002, system: 2 }, { ...first, id: 2003, system: 3 });
    fetch.mockImplementation(async (url) => url.pathname === '/' ? new Response('<meta name="csrf-token" content="TEST">') : json(app));
    const five = await service.versions(s.versionsInput.parse({ slug: 'example-timer', page: 2, page_size: 1 }));
    expect(five.versions.map((v) => v.id)).toEqual([2003]);
    expect(five.pagination.total).toBe(2);
    const four = await service.versions(s.versionsInput.parse({ slug: 'example-timer', aurora_version: 4 }));
    expect(four.versions.map((v) => v.id)).toEqual([2002, 2003]);
  });
});

describe('output and input safety', () => {
  it('strips executable HTML, link targets and bounds output', () => {
    expect(plain('<p>Hello</p><script>SECRET</script><style>SECRET</style><a href="https://evil.example/?secret=1">Link</a><input value="SECRET">')).not.toMatch(/SECRET|evil\.example/);
    expect(plain('x'.repeat(9000), 1000)).toHaveLength(1000);
  });

  it.each(['https://evil.example/download/test.rpm', '//evil.example/download/test.rpm', 'javascript:alert(1)', 'https://user:secret@aurorarepos.ru/download/test.rpm', '/api/applogin', '/download/../api/applogin'])('rejects unsafe package URL %s', (url) => {
    expect(safeUrl(url, '/download/')).toBeNull();
  });

  it('removes URL query strings and never guesses unknown OS IDs', () => {
    expect(safeUrl('/download/test.rpm?secret=1#hash', '/download/')).toBe('https://aurorarepos.ru/download/test.rpm');
    expect(versionsFromIds([1, 2, 3, 999])).toEqual([4, 5]);
    expect(versionsFromIds([999])).toEqual([]);
  });

  it.each([{ page_size: 21 }, { page: 0 }, { query: 'x'.repeat(201) }, { aurora_version: 1 }, { url: 'https://evil.example' }, { author_id: -1 }])('rejects invalid search arguments %j', (input) => {
    expect(s.searchInput.safeParse(input).success).toBe(false);
  });

  it.each(['../secret', 'https://evil.example', 'Uppercase', 'a/b', 'x'.repeat(161)])('rejects invalid slug %s', (slug) => {
    expect(s.appInput.safeParse({ slug }).success).toBe(false);
  });
});
