/**
 * What an OAuth provider looks like to this component. Google, Atlassian and
 * Microsoft differ in endpoints, in how the account is identified after the
 * exchange, and in the extra parameters that make a refresh token appear.
 */

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  [key: string]: unknown;
}

export interface OAuthProvider {
  name: string;
  authUrl: string;
  tokenUrl: string;
  /** Extra query parameters on the authorization URL, e.g. Google's `access_type=offline`. */
  authParams?: Record<string, string>;
  /** Scopes every authorization asks for, e.g. `openid email`. */
  baseScopes?: string[];
  /** Service name to the scopes that grant it read/write. */
  scopeSets?: Record<string, string[]>;
  /** Service name to read-only scopes. A service missing here has no read-only form. */
  readonlyScopeSets?: Record<string, string[]>;
  /** Resolve the account identifier, usually an email, after the exchange. */
  identify: (tokens: TokenResponse, fetchFn: typeof fetch) => Promise<string>;
  /** Whether the token endpoint wants the client secret. Default true when one is configured. */
  sendClientSecret?: boolean;
}

/** An identify function for providers with an OpenID userinfo endpoint returning `email`. */
export function identifyByUserinfo(userinfoUrl: string, field = 'email'): OAuthProvider['identify'] {
  return async (tokens, fetchFn) => {
    const res = await fetchFn(userinfoUrl, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!res.ok) throw new Error(`Userinfo request failed (${res.status})`);
    const info = (await res.json()) as Record<string, unknown>;
    const id = info[field];
    if (typeof id !== 'string' || !id) throw new Error(`Userinfo response has no ${field}`);
    return id;
  };
}

export type AccessLevel = 'read' | 'readwrite';

export interface ResolvedScopes {
  scopes: string[];
  /** Services asked for as read-only that will still be able to write. */
  stillAllowWrites: string[];
}

/** Turn service names into scopes for an access level, reporting what read-only cannot cover. */
export function scopesForServices(provider: OAuthProvider, services: string[], access: AccessLevel = 'readwrite'): ResolvedScopes {
  const sets = provider.scopeSets ?? {};
  const readonly = provider.readonlyScopeSets ?? {};
  const scopes = new Set<string>(provider.baseScopes ?? []);
  const stillAllowWrites: string[] = [];
  for (const raw of services) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    const rw = sets[name];
    if (!rw) throw new Error(`Unknown service: '${name}'. Known: ${Object.keys(sets).join(', ')}`);
    const ro = access === 'read' ? readonly[name] : undefined;
    if (access === 'read' && !ro) stillAllowWrites.push(name);
    for (const s of ro ?? rw) scopes.add(s);
  }
  return { scopes: [...scopes], stillAllowWrites };
}

/** Scopes that grant write on a service: its read/write set minus its read-only set. */
export function writeScopesFor(provider: OAuthProvider, service: string): string[] {
  const ro = new Set(provider.readonlyScopeSets?.[service] ?? []);
  return (provider.scopeSets?.[service] ?? []).filter(s => !ro.has(s));
}

export function allServices(provider: OAuthProvider): string[] {
  return Object.keys(provider.scopeSets ?? {});
}
