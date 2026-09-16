import { Cookie, CookieJar } from 'tough-cookie';
import { z } from 'zod';
import { ORIGIN } from '../aurora/client.js';
import { AuthError } from './errors.js';

const payloadSchema = z.strictObject({
  schema_version: z.literal(1), saved_at: z.iso.datetime(),
  cookies: z.array(z.record(z.string(), z.unknown())).min(1).max(30),
});
export type Session = z.infer<typeof payloadSchema>;

export function parseSession(raw: unknown): Session {
  try {
    const parsed = payloadSchema.parse(raw);
    const cookies = parsed.cookies.map((rawCookie) => {
      const cookie = Cookie.fromJSON(rawCookie);
      if (!cookie || !cookie.validate() || cookie.domain !== new URL(ORIGIN).hostname || !cookie.key || !cookie.value ||
        cookie.key.length > 256 || cookie.value.length > 16_384 || !cookie.path?.startsWith('/') || cookie.path.length > 1024) throw new AuthError('SESSION_INVALID');
      return cookie.toJSON();
    });
    return { ...parsed, cookies };
  } catch { throw new AuthError('SESSION_INVALID'); }
}
export function snapshot(jar: CookieJar): Session {
  return parseSession({ schema_version: 1, saved_at: new Date().toISOString(), cookies: jar.serializeSync()?.cookies });
}
export function restore(session: Session): CookieJar {
  const validated = parseSession(session);
  try { return CookieJar.deserializeSync({ version: 'tough-cookie@6.0.2', storeType: 'MemoryCookieStore', rejectPublicSuffixes: true, cookies: validated.cookies }); }
  catch { throw new AuthError('SESSION_INVALID'); }
}
