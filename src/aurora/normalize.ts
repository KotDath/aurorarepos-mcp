import { compile } from 'html-to-text';
import type * as z from 'zod/v4';
import { ORIGIN, type AuroraVersion } from './client.js';
import type { rawApp, rawRelease } from './schemas.js';

const convert = compile({
  wordwrap: false,
  limits: { maxInputLength: 200_000, maxDepth: 30, maxChildNodes: 2000 },
  selectors: [
    { selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' },
    { selector: 'img', format: 'skip' }, { selector: 'input', format: 'skip' },
    { selector: 'a', options: { ignoreHref: true } },
  ],
});
export function plain(value: string | null | undefined, max = 1000): string {
  // Intentionally remove non-printable controls from untrusted upstream text.
  return convert((value ?? '').slice(0, 200_000))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}
const nullable = (value: string | null | undefined, max = 80) => value ? plain(value, max) || null : null;
const positive = (value: number | null | undefined) => value && value > 0 ? value : null;
const nonnegative = (value: number | null | undefined) => value != null && value >= 0 ? value : null;

export function versionsFromIds(ids: number[]): AuroraVersion[] {
  const result = new Set<AuroraVersion>();
  for (const id of ids) {
    if (id === 1 || id === 3) result.add(5);
    if (id === 2 || id === 3) result.add(4);
  }
  return [...result].sort();
}
export function safeUrl(value: string | null | undefined, prefix: '/download/' | '/image/' | '/rpm/'): string | null {
  if (!value || value.length > 2000) return null;
  try {
    const url = new URL(value, ORIGIN);
    if (url.origin !== ORIGIN || url.username || url.password || !url.pathname.startsWith(prefix)) return null;
    url.hash = '';
    url.search = '';
    return url.href;
  } catch { return null; }
}
export function downloads(value: z.infer<typeof rawRelease>) {
  const build = (path: string | null | undefined, hash: string | null | undefined) => {
    const url = safeUrl(path, '/download/');
    return url ? { url, sha256: hash && /^[a-f0-9]{64}$/i.test(hash) ? hash.toLowerCase() : null } : null;
  };
  return { armv7hl: build(value.rpm32, value.sha256_32), aarch64: build(value.rpm64, value.sha256_64) };
}
export function summary(value: z.infer<typeof rawApp>, preferred: AuroraVersion = 5) {
  const ids = value.available_systems ?? value.all_systems?.split(',').map(Number) ?? [value.system ?? 0];
  const versions = versionsFromIds(ids);
  const rating = value.stars ?? value.star;
  return {
    id: value.id, name: plain(value.name, 200), slug: value.slug, description: plain(value.description),
    author_id: positive(value.user_id), category_id: positive(value.category_id), aurora_versions: versions,
    version: nullable(value.ver), release: nullable(value.release),
    download_count: nonnegative(value.download_count ?? value.count),
    rating: rating != null && rating >= 0 && rating <= 5 ? rating : null,
    webpage: `${ORIGIN}/aurora-${versions.includes(preferred) ? preferred : versions[0] ?? preferred}/${value.slug}`,
  };
}
export function release(value: z.infer<typeof rawRelease>) {
  return {
    id: positive(value.id), aurora_versions: versionsFromIds([value.system ?? 0]),
    version: nullable(value.ver), release: nullable(value.release), notes: plain(value.newcomment, 4000),
    created_at: nullable(value.created_at), downloads: downloads(value),
  };
}
