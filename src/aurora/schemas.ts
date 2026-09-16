import * as z from 'zod/v4';

const integer = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const positiveInteger = integer.pipe(z.number().positive());
const text = z.string().max(200_000).nullish();
const numeric = z.union([z.number().finite(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number)]).nullish();

export const rawRelease = z.object({
  id: integer.optional(), system: integer.optional(), ver: text, release: text,
  newcomment: text, created_at: text, rpm32: text, rpm64: text,
  sha256_32: text, sha256_64: text,
});
export const rawApp = z.object({
  id: positiveInteger, name: z.string().min(1).max(1000),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160),
  user_id: integer.nullish(), category_id: integer.nullish(), description: text,
  system: integer.optional(), all_systems: text,
  available_systems: z.array(integer).max(100).optional(),
  ver: text, release: text, rpm32: text, rpm64: text, size: numeric,
  stars: numeric, star: numeric, download_count: numeric, count: numeric,
  category: z.union([z.string().max(1000), z.object({ id: positiveInteger, label: z.string().max(1000) })]).nullish(), dev: text,
  latest_app: rawRelease.nullish(),
  screenshots: z.array(z.object({ src: z.string().max(2000) })).max(1000).optional(),
  history: z.array(rawRelease).max(10_000).optional(),
});
export const rawCatalog = z.object({
  current_page: positiveInteger, last_page: positiveInteger, total: integer,
  data: z.array(rawApp).max(100),
});
export const rawDetails = z.object({ success: z.literal(true), data: rawApp });
export const rawAuthors = z.array(z.object({
  application_id: positiveInteger, name: z.string().min(1).max(1000),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160),
  system: integer.optional(), ver: text, release: text,
  stars: numeric, download_count: numeric,
})).max(10_000);
export const rawCategories = z.array(z.object({ id: positiveInteger, label: z.string().max(1000) })).max(1000);
export const rawSystems = z.array(z.object({ id: z.union([z.literal(1), z.literal(2)]), label: z.string().max(1000) })).max(100);

const nullableText = (max: number) => z.string().max(max).nullable();
export const packageSchema = z.object({ url: z.url(), sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable() });
export const downloadsSchema = z.object({ armv7hl: packageSchema.nullable(), aarch64: packageSchema.nullable() });
export const appSchema = z.object({
  id: z.number().int().positive(), name: z.string().max(200), slug: z.string().max(160),
  description: z.string().max(1000), author_id: z.number().int().positive().nullable(),
  category_id: z.number().int().positive().nullable(), aurora_versions: z.array(z.union([z.literal(4), z.literal(5)])).max(2),
  version: nullableText(80), release: nullableText(80),
  download_count: z.number().nonnegative().nullable(), rating: z.number().min(0).max(5).nullable(),
  webpage: z.url(),
});
export const releaseSchema = z.object({
  id: z.number().int().positive().nullable(), aurora_versions: z.array(z.union([z.literal(4), z.literal(5)])).max(2),
  version: nullableText(80), release: nullableText(80), notes: z.string().max(4000),
  created_at: nullableText(80), downloads: downloadsSchema,
});
export const paginationSchema = z.object({
  page: z.number().int().positive(), page_size: z.number().int().min(1).max(20),
  total: z.number().int().nonnegative(), next_page: z.number().int().positive().nullable(),
});
export const searchOutput = z.object({ apps: z.array(appSchema).max(20), pagination: paginationSchema });
export const appOutput = z.object({
  app: appSchema, description: z.string().max(8000), category: nullableText(200), developer: nullableText(200),
  size_bytes: z.number().nonnegative().nullable(), downloads: downloadsSchema,
  screenshots: z.array(z.url()).max(10), latest_release: releaseSchema.nullable(),
});
export const versionsOutput = z.object({
  slug: z.string(), aurora_version: z.union([z.literal(4), z.literal(5)]),
  versions: z.array(releaseSchema).max(20), pagination: paginationSchema,
});
export const categoriesOutput = z.object({ categories: z.array(z.object({ id: z.number().int().positive(), name: z.string().max(200) })).max(100) });
export const systemsOutput = z.object({ systems: z.array(z.object({ id: z.number().int(), name: z.string().max(200), aurora_version: z.union([z.literal(4), z.literal(5)]) })).max(2) });
export const authorOutput = z.object({ author_id: z.number().int().positive(), apps: z.array(appSchema).max(20), pagination: paginationSchema });

export const versionInput = z.union([z.literal(4), z.literal(5)]).default(5).describe('OS major version; 5 by default. Not the website system ID.');
export const slugInput = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160).describe('Application slug from search_apps.');
export const pageInput = z.number().int().min(1).max(10_000).default(1);
export const sizeInput = z.number().int().min(1).max(20).default(10);
export const searchInput = z.strictObject({
  query: z.string().trim().max(200).default(''), aurora_version: versionInput,
  category_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  author_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  sort: z.enum(['newest', 'popular', 'rating', 'name']).default('newest'),
  page: pageInput, page_size: sizeInput,
});
export const appInput = z.strictObject({ slug: slugInput, aurora_version: versionInput });
export const versionsInput = appInput.extend({ page: pageInput, page_size: sizeInput });
export const categoriesInput = z.strictObject({ aurora_version: versionInput });
export const systemsInput = z.strictObject({});
export const authorInput = z.strictObject({
  author_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  page: pageInput, page_size: sizeInput,
});
