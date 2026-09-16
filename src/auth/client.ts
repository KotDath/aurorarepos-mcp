import { CookieJar } from 'tough-cookie';
import { z } from 'zod';
import { AuroraClient, type ClientOptions } from '../aurora/client.js';
import { AuroraError } from '../aurora/errors.js';
import { AuthError } from './errors.js';
import { restore, snapshot, type Session } from './session.js';

const credentials = z.strictObject({ email: z.email().max(254), password: z.string().min(1).max(1024) });
const responseSchema = z.object({
  success: z.boolean().optional(), '2fa_required': z.boolean().optional(),
  token: z.string().min(1).max(2048).optional(), method: z.string().max(32).optional(),
});
export type LoginStep = { kind: 'ready' } | { kind: 'two_factor'; method: 'email' | 'totp' | 'other' };

export class AuthClient {
  private readonly jar: CookieJar;
  private readonly http: AuroraClient;
  private token: string | undefined;
  constructor(session?: Session, options: Omit<ClientOptions, 'jar'> = {}) {
    this.jar = session ? restore(session) : new CookieJar();
    this.http = new AuroraClient({ ...options, jar: this.jar });
  }
  async begin(email: string, password: string, signal?: AbortSignal): Promise<LoginStep> {
    this.token = undefined;
    if (!credentials.safeParse({ email, password }).success) throw new AuthError('AUTH_FAILED');
    let raw: unknown;
    try { raw = await this.http.accountLogin(email, password, signal); }
    catch (error) {
      if (error instanceof AuroraError && ['AUTH_REQUIRED', 'UPSTREAM_ERROR'].includes(error.code)) throw new AuthError('AUTH_FAILED');
      throw error;
    }
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success || parsed.data.success === false) throw new AuthError('AUTH_FAILED');
    if (!parsed.data['2fa_required']) return { kind: 'ready' };
    if (!parsed.data.token) throw new AuthError('AUTH_FAILED');
    this.token = parsed.data.token;
    const method = parsed.data.method;
    return { kind: 'two_factor', method: method === 'email' || method === 'totp' ? method : 'other' };
  }
  async verify(code: string, signal?: AbortSignal): Promise<void> {
    if (!this.token || !/^\d{6}$/.test(code)) throw new AuthError('TWO_FACTOR_FAILED');
    try {
      const raw = await this.http.accountVerify(this.token, code, signal);
      if (raw && typeof raw === 'object' && 'success' in raw && raw.success === false) throw new AuthError('TWO_FACTOR_FAILED');
      this.token = undefined;
    } catch (error) {
      this.token = undefined;
      if (error instanceof AuroraError && ['AUTH_REQUIRED', 'UPSTREAM_ERROR'].includes(error.code)) throw new AuthError('TWO_FACTOR_FAILED');
      throw error;
    }
  }
  async resend(signal?: AbortSignal): Promise<void> {
    if (!this.token) throw new AuthError('TWO_FACTOR_FAILED');
    await this.http.accountResend(this.token, signal);
  }
  cancel(): void { this.token = undefined; }
  async check(signal?: AbortSignal): Promise<void> {
    const role = await this.http.accountRole(signal);
    if (!z.string().min(1).max(80).safeParse(role).success || ['guest', 'anonymous'].includes(String(role).toLowerCase())) throw new AuthError('AUTH_FAILED');
  }
  snapshot(): Session { return snapshot(this.jar); }
}
