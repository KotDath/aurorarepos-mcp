import { z } from 'zod';
import type { ClientOptions } from '../aurora/client.js';
import { AuroraError } from '../aurora/errors.js';
import { AuthClient } from './client.js';
import { SessionStore } from './store.js';

export const authStatusInput = z.strictObject({ verify: z.boolean().default(false) });
export const authStatusOutput = z.strictObject({
  state: z.enum(['not_authenticated', 'stored', 'authenticated', 'expired', 'access_denied']),
  saved_at: z.iso.datetime().nullable(), verified: z.boolean(),
});
export class AuthService {
  constructor(readonly store = new SessionStore(), private readonly options: Omit<ClientOptions, 'jar'> = {}) {}
  async createLogin(): Promise<AuthClient> {
    await this.store.load(); // Preflight vault + existing ciphertext before asking for secrets.
    return new AuthClient(undefined, this.options);
  }
  async finishLogin(client: AuthClient, signal?: AbortSignal): Promise<void> {
    await client.check(signal);
    if (signal?.aborted) throw new AuroraError('CANCELLED');
    await this.store.save(client.snapshot());
  }
  async status(raw: unknown = {}, signal?: AbortSignal): Promise<z.infer<typeof authStatusOutput>> {
    const { verify } = authStatusInput.parse(raw);
    const session = await this.store.load();
    if (!session) return { state: 'not_authenticated', saved_at: null, verified: false };
    if (!verify) return { state: 'stored', saved_at: session.saved_at, verified: false };
    try {
      await new AuthClient(session, this.options).check(signal);
      return { state: 'authenticated', saved_at: session.saved_at, verified: true };
    } catch (error) {
      if (error instanceof AuroraError && error.code === 'AUTH_REQUIRED') return { state: 'expired', saved_at: session.saved_at, verified: true };
      if (error instanceof AuroraError && error.code === 'ACCESS_DENIED') return { state: 'access_denied', saved_at: session.saved_at, verified: false };
      throw error;
    }
  }
}
