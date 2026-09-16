import type { z } from 'zod';
import { plain, safeUrl, versionsFromIds } from '../aurora/normalize.js';
import type { rawApp, rawVersion, statusSchema } from './schemas.js';

const nullable = (value: string | null | undefined, max = 80) => value ? plain(value, max) || null : null;
export function status(code: number | null): z.infer<typeof statusSchema> {
  const states = ['draft', 'pending_review', 'rejected', 'published'] as const;
  return { code, state: code === null ? 'no_release' : states[code] ?? 'unknown' };
}
export function version(value: z.infer<typeof rawVersion>, noteLimit = 4000) {
  const build = (path: string | null | undefined, hash: string | null | undefined) => {
    const url = safeUrl(path, '/rpm/') ?? safeUrl(path, '/download/');
    return url ? { url, sha256: hash && /^[a-f0-9]{64}$/i.test(hash) ? hash.toLowerCase() : null } : null;
  };
  return {
    id: value.id, app_id: value.application_id, aurora_versions: versionsFromIds([value.system]),
    version: nullable(value.ver), release: nullable(value.release), status: status(value.status),
    notes: plain(value.newcomment, noteLimit), created_at: nullable(value.created_at), updated_at: nullable(value.updated_at),
    downloads: { armv7hl: build(value.rpm32, value.sha256_32), aarch64: build(value.rpm64, value.sha256_64) },
  };
}
const checked = (value: string | null | undefined) => value == null || value === '' ? false : value === 'checked' ? true : null;
export function app(value: z.infer<typeof rawApp>, detailed = true) {
  return {
    id: value.id, name: plain(value.name, 200), slug: value.slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) && value.slug.length <= 160 ? value.slug : null,
    category_id: value.category_id && value.category_id > 0 ? value.category_id : null,
    description: plain(value.description, detailed ? 8000 : 1000),
    is_beta: value.is_beta ?? null, is_delayed: value.is_delayed ?? null, publish_at: nullable(value.publish_at),
    created_at: nullable(value.created_at), updated_at: nullable(value.updated_at),
    validator_checked: checked(value.validator), unofficial: checked(value.notoff),
    status: status(value.latest_app?.status ?? null), latest_release: value.latest_app ? version(value.latest_app, detailed ? 4000 : 500) : null,
  };
}
