import { z } from 'zod';
import { downloadsSchema, paginationSchema, pageInput, sizeInput } from '../aurora/schemas.js';

const integer = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const positive = integer.pipe(z.number().positive());
const text = z.string().max(200_000).nullish();
export const rawVersion = z.object({
  id: positive, application_id: positive, system: integer.pipe(z.number().min(1).max(3)),
  ver: text, release: text, status: integer, newcomment: text,
  created_at: text, updated_at: text, rpm32: text, rpm64: text, sha256_32: text, sha256_64: text,
  application: z.object({ id: positive, user_id: positive }).nullish(),
});
export const rawApp = z.object({
  id: positive, user_id: positive, name: z.string().min(1).max(1000), slug: text,
  category_id: integer.nullish(), description: text,
  system: integer.pipe(z.number().min(1).max(3)).optional(), ver: text, release: text,
  is_beta: z.boolean().nullish(), is_delayed: z.boolean().nullish(), publish_at: text,
  created_at: text, updated_at: text, validator: text, notoff: text,
  latest_app: rawVersion.nullish(), newcomment: text,
  screenshots: z.array(z.object({ src: z.string().max(2000), application_id: positive.optional() })).max(1000).optional(),
});
const paginator = <T extends z.ZodType>(row: T) => z.object({
  success: z.literal(true), data: z.object({
    current_page: positive, per_page: positive, last_page: positive, total: integer,
    data: z.array(row).max(100),
  }),
});
export const rawApps = paginator(rawApp);
export const rawVersions = paginator(rawVersion);

const nullableText = (max: number) => z.string().max(max).nullable();
export const statusSchema = z.strictObject({
  code: z.number().int().nonnegative().nullable(),
  state: z.enum(['draft', 'pending_review', 'rejected', 'published', 'unknown', 'no_release']),
});
export const versionSchema = z.strictObject({
  id: z.number().int().positive(), app_id: z.number().int().positive(),
  aurora_versions: z.array(z.union([z.literal(4), z.literal(5)])).max(2),
  version: nullableText(80), release: nullableText(80), status: statusSchema,
  notes: z.string().max(4000), created_at: nullableText(80), updated_at: nullableText(80), downloads: downloadsSchema,
});
export const appSchema = z.strictObject({
  id: z.number().int().positive(), name: z.string().max(200), slug: nullableText(160),
  category_id: z.number().int().positive().nullable(), description: z.string().max(8000),
  is_beta: z.boolean().nullable(), is_delayed: z.boolean().nullable(), publish_at: nullableText(80),
  created_at: nullableText(80), updated_at: nullableText(80),
  validator_checked: z.boolean().nullable(), unofficial: z.boolean().nullable(),
  status: statusSchema, latest_release: versionSchema.nullable(),
});
export const appsOutput = z.strictObject({ apps: z.array(appSchema).max(20), pagination: paginationSchema });
export const appOutput = z.strictObject({ app: appSchema });
export const versionsOutput = z.strictObject({ app_id: z.number().int().positive(), versions: z.array(versionSchema).max(20), pagination: paginationSchema });
export const versionOutput = z.strictObject({
  version: versionSchema, shared_app_description: z.string().max(8000), screenshots: z.array(z.url()).max(10),
});
const idInput = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const appsInput = z.strictObject({ page: pageInput, page_size: sizeInput });
export const appInput = z.strictObject({ app_id: idInput.describe('Owned app ID from list_my_apps; not a public slug or release ID.') });
export const versionsInput = appInput.extend({ page: pageInput, page_size: sizeInput });
export const versionInput = appInput.extend({ version_id: idInput.describe('Release ID from list_my_app_versions; not app_id.') });
