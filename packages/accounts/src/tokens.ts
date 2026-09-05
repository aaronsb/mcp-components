/**
 * Access tokens from refresh tokens, cached for the session, with one
 * refresh in flight per account.
 */

import type { CredentialStore } from './store.js';
import type { OAuthProvider } from './provider.js';

export class TokenRefreshError extends Error {
  constructor(message: string, readonly account: string, readonly providerError?: string) {
    super(message);
    this.name = 'TokenRefreshError';
  }
}

export interface TokenServiceOptions {
  provider: OAuthProvider;
  store: CredentialStore;
  /** Refresh this many ms before expiry. Default 60 000. */
  expiryBufferMs?: number;
  now?: () => number;
  fetchFn?: typeof fetch;
}

export class TokenService {
  private cache = new Map<string, { token: string; expiresAt: number }>();
  private inflight = new Map<string, Promise<string>>();
  private readonly buffer: number;
  private readonly now: () => number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: TokenServiceOptions) {
    this.buffer = options.expiryBufferMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getAccessToken(account: string): Promise<string> {
    const cached = this.cache.get(account);
    if (cached && cached.expiresAt > this.now() + this.buffer) return cached.token;
    const pending = this.inflight.get(account);
    if (pending) return pending;
    const promise = this.refresh(account);
    this.inflight.set(account, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(account);
    }
  }

  private async refresh(account: string): Promise<string> {
    const cred = await this.options.store.readCredential(account);
    const body = new URLSearchParams({
      client_id: cred.client_id,
      refresh_token: cred.refresh_token,
      grant_type: 'refresh_token',
    });
    if (cred.client_secret && this.options.provider.sendClientSecret !== false) body.set('client_secret', cred.client_secret);
    const res = await this.fetchFn(this.options.provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const providerError = typeof detail.error === 'string' ? detail.error : undefined;
      this.cache.delete(account);
      if (res.status === 400 && providerError === 'invalid_grant') {
        throw new TokenRefreshError(`Refresh token revoked or expired for ${account}. Authenticate again.`, account, providerError);
      }
      throw new TokenRefreshError(`Token refresh failed for ${account} (${res.status}): ${JSON.stringify(detail)}`, account, providerError);
    }
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    this.cache.set(account, { token: data.access_token, expiresAt: this.now() + (data.expires_in ?? 3600) * 1000 });
    return data.access_token;
  }

  invalidate(account: string): void {
    this.cache.delete(account);
    this.inflight.delete(account);
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}
