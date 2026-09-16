import * as z from 'zod/v4';
import { AuroraClient, systemId } from './client.js';
import { AuroraError } from './errors.js';
import { downloads, plain, release, safeUrl, summary, versionsFromIds } from './normalize.js';
import * as schemas from './schemas.js';

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AuroraError('INVALID_RESPONSE');
  return result.data;
}
function pagination(page: number, page_size: number, total: number) {
  return { page, page_size, total, next_page: page * page_size < total ? page + 1 : null };
}

export class AuroraService {
  constructor(private readonly client = new AuroraClient()) {}

  async search(input: z.infer<typeof schemas.searchInput>, signal?: AbortSignal) {
    const { query, aurora_version, page, page_size, sort, category_id, author_id } = input;
    const raw = parse(schemas.rawCatalog, await this.client.catalog({
      page, pagination: page_size, search: query, sortable: sort, system: systemId(aurora_version),
      ...(category_id ? { id: category_id } : {}), ...(author_id ? { user_id: author_id } : {}),
    }, signal));
    return parse(schemas.searchOutput, {
      apps: raw.data.slice(0, page_size).map((app) => summary(app, aurora_version)),
      pagination: { ...pagination(raw.current_page, page_size, raw.total), next_page: raw.current_page < raw.last_page ? raw.current_page + 1 : null },
    });
  }

  private async details(input: z.infer<typeof schemas.appInput>, signal?: AbortSignal) {
    return parse(schemas.rawDetails, await this.client.app(input.slug, input.aurora_version, signal)).data;
  }

  async app(input: z.infer<typeof schemas.appInput>, signal?: AbortSignal) {
    const raw = await this.details(input, signal);
    return parse(schemas.appOutput, {
      app: summary(raw, input.aurora_version), description: plain(raw.description, 8000),
      category: raw.category ? plain(typeof raw.category === 'string' ? raw.category : raw.category.label, 200) : null,
      developer: raw.dev ? plain(raw.dev, 200) : null,
      size_bytes: raw.size != null && raw.size >= 0 ? raw.size : null,
      downloads: downloads({ ...raw.latest_app, rpm32: raw.rpm32 ?? raw.latest_app?.rpm32, rpm64: raw.rpm64 ?? raw.latest_app?.rpm64 }),
      screenshots: (raw.screenshots ?? []).map((s) => safeUrl(s.src, '/image/')).filter((url) => url !== null).slice(0, 10),
      latest_release: raw.latest_app ? release(raw.latest_app) : null,
    });
  }

  async versions(input: z.infer<typeof schemas.versionsInput>, signal?: AbortSignal) {
    const raw = await this.details(input, signal);
    if (!raw.history) throw new AuroraError('INVALID_RESPONSE');
    if (raw.history.some((item) => !versionsFromIds([item.system ?? 0]).length)) throw new AuroraError('INVALID_RESPONSE');
    // The card selects the latest release by OS, but its history mixes OS versions.
    const history = raw.history.filter((item) => versionsFromIds([item.system ?? 0]).includes(input.aurora_version));
    const start = (input.page - 1) * input.page_size;
    return parse(schemas.versionsOutput, {
      slug: input.slug, aurora_version: input.aurora_version,
      versions: history.slice(start, start + input.page_size).map(release),
      pagination: pagination(input.page, input.page_size, history.length),
    });
  }

  async categories(input: z.infer<typeof schemas.categoriesInput>, signal?: AbortSignal) {
    const raw = parse(schemas.rawCategories, await this.client.categories(input.aurora_version, signal));
    if (raw.length > 100) throw new AuroraError('RESPONSE_TOO_LARGE');
    return parse(schemas.categoriesOutput, { categories: raw.map((c) => ({ id: c.id, name: plain(c.label, 200) })) });
  }

  async systems(signal?: AbortSignal) {
    const raw = parse(schemas.rawSystems, await this.client.systems(signal));
    return parse(schemas.systemsOutput, { systems: raw.map((s) => ({ id: s.id, name: plain(s.label, 200), aurora_version: s.id === 1 ? 5 : 4 })) });
  }

  async author(input: z.infer<typeof schemas.authorInput>, signal?: AbortSignal) {
    const raw = parse(schemas.rawAuthors, await this.client.author(input.author_id, signal));
    const start = (input.page - 1) * input.page_size;
    return parse(schemas.authorOutput, {
      author_id: input.author_id,
      apps: raw.slice(start, start + input.page_size).map((a) => summary({ ...a, id: a.application_id, user_id: input.author_id })),
      pagination: pagination(input.page, input.page_size, raw.length),
    });
  }
}
