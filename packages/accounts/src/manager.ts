/**
 * The account lifecycle: authenticate, list, status, refresh, change scopes,
 * remove. Every operation is agent-callable through the handler, so the
 * user never touches a vendor CLI.
 */

import { runLoopbackFlow, type LoopbackOptions } from './loopback.js';
import { allServices, scopesForServices, type AccessLevel, type OAuthProvider } from './provider.js';
import { CredentialStore, type Account, type StoredCredential } from './store.js';
import { TokenService } from './tokens.js';

export interface AccountManagerOptions {
  provider: OAuthProvider;
  store: CredentialStore;
  tokens?: TokenService;
  clientId?: string;
  clientSecret?: string;
  /** Overrides for the loopback flow, mainly for tests. */
  flow?: Partial<Omit<LoopbackOptions, 'provider' | 'clientId' | 'clientSecret' | 'scopes'>>;
}

export interface AuthenticateOptions {
  services?: string[];
  access?: AccessLevel;
  category?: string;
  description?: string;
  /** Accept that read-only was asked for and some services stay writable. */
  confirmWriteAccess?: boolean;
}

export type AuthenticateResult =
  | { status: 'success'; account: string; credentialPath: string; access: AccessLevel; stillAllowWrites: string[]; scopes: string[] }
  | { status: 'needs-confirmation'; stillAllowWrites: string[] }
  | { status: 'error'; error: string };

export interface AccountStatus {
  id: string;
  hasCredential: boolean;
  tokenValid: boolean;
  scopes: string[];
  access: AccessLevel;
  stillAllowWrites: string[];
  error?: string;
}

export interface ListedAccount extends Account {
  hasCredential: boolean;
}

export class AccountManager {
  readonly provider: OAuthProvider;
  readonly store: CredentialStore;
  readonly tokens: TokenService;

  constructor(private readonly options: AccountManagerOptions) {
    this.provider = options.provider;
    this.store = options.store;
    this.tokens = options.tokens ?? new TokenService({ provider: options.provider, store: options.store });
  }

  async list(): Promise<ListedAccount[]> {
    const accounts = await this.store.listAccounts();
    return Promise.all(accounts.map(async a => ({ ...a, hasCredential: await this.store.hasCredential(a.id) })));
  }

  /** Run the browser flow and store the result. Registers a new account. */
  async authenticate(opts: AuthenticateOptions = {}): Promise<AuthenticateResult> {
    const clientId = this.options.clientId;
    if (!clientId) return { status: 'error', error: 'No OAuth client id is configured for this server.' };
    const access = opts.access ?? 'readwrite';
    const services = opts.services ?? allServices(this.provider);
    let resolved;
    try {
      resolved = scopesForServices(this.provider, services, access);
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
    // Stop before the browser opens: a token that is broader than asked for cannot be
    // narrowed afterwards without a trip to the provider's permissions page.
    if (resolved.stillAllowWrites.length > 0 && !opts.confirmWriteAccess) {
      return { status: 'needs-confirmation', stillAllowWrites: resolved.stillAllowWrites };
    }
    try {
      const result = await runLoopbackFlow({
        ...this.options.flow,
        provider: this.provider,
        clientId,
        clientSecret: this.options.clientSecret,
        scopes: resolved.scopes,
      });
      const credential: StoredCredential = {
        type: 'oauth2',
        client_id: clientId,
        ...(this.options.clientSecret ? { client_secret: this.options.clientSecret } : {}),
        refresh_token: result.tokens.refresh_token!,
        scopes: result.scopes,
        access,
        ...(resolved.stillAllowWrites.length ? { stillAllowWrites: resolved.stillAllowWrites } : {}),
      };
      const credentialPath = await this.store.saveCredential(result.account, credential);
      this.tokens.invalidate(result.account);
      if (!(await this.store.getAccount(result.account))) {
        await this.store.addAccount({ id: result.account, category: opts.category, description: opts.description });
      }
      return { status: 'success', account: result.account, credentialPath, access, stillAllowWrites: resolved.stillAllowWrites, scopes: result.scopes };
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  async status(id: string): Promise<AccountStatus> {
    if (!(await this.store.hasCredential(id))) {
      return { id, hasCredential: false, tokenValid: false, scopes: [], access: 'readwrite', stillAllowWrites: [] };
    }
    const cred = await this.store.readCredential(id);
    let tokenValid = false;
    let error: string | undefined;
    try {
      await this.tokens.getAccessToken(id);
      tokenValid = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return {
      id,
      hasCredential: true,
      tokenValid,
      scopes: cred.scopes ?? [],
      access: cred.access ?? 'readwrite',
      stillAllowWrites: cred.stillAllowWrites ?? [],
      ...(error ? { error } : {}),
    };
  }

  /** Drop the cached token and fetch a fresh one. */
  async refresh(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    this.tokens.invalidate(id);
    try {
      await this.tokens.getAccessToken(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Re-authorise an existing account with a different service list. */
  async scopes(id: string, services: string[], opts: Omit<AuthenticateOptions, 'services'> = {}): Promise<AuthenticateResult> {
    const result = await this.authenticate({ ...opts, services });
    if (result.status === 'success' && result.account !== id) {
      return { status: 'error', error: `Authenticated ${result.account}, which is not ${id}. The credential for ${result.account} was saved; ${id} is unchanged.` };
    }
    return result;
  }

  async remove(id: string): Promise<void> {
    await this.store.removeAccount(id);
    this.tokens.invalidate(id);
  }
}
