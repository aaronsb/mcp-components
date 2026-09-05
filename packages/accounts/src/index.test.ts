import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CredentialStore, TokenService, TokenRefreshError, AccountManager, createAccountsHandler, scopesForServices, runLoopbackFlow, type OAuthProvider } from './index.js';

const provider: OAuthProvider = {
  name: 'test',
  authUrl: 'https://auth.example/authorize',
  tokenUrl: 'https://auth.example/token',
  authParams: { access_type: 'offline', prompt: 'consent' },
  baseScopes: ['openid', 'email'],
  scopeSets: { mail: ['scope:mail'], files: ['scope:files'], meet: ['scope:meet', 'scope:meet.readonly'] },
  readonlyScopeSets: { mail: ['scope:mail.readonly'], meet: ['scope:meet.readonly'] },
  identify: async tokens => (tokens as { who?: string }).who ?? 'user@example.com',
};

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acct-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const store = () => new CredentialStore({ appName: 't', configDir: path.join(dir, 'cfg'), dataDir: path.join(dir, 'data') });

describe('scopes', () => {
  it('resolves services to scopes and reports what read-only cannot cover', () => {
    expect(scopesForServices(provider, ['mail', 'files'])).toEqual({ scopes: ['openid', 'email', 'scope:mail', 'scope:files'], stillAllowWrites: [] });
    expect(scopesForServices(provider, ['mail', 'files', 'meet'], 'read')).toEqual({ scopes: ['openid', 'email', 'scope:mail.readonly', 'scope:files', 'scope:meet.readonly'], stillAllowWrites: ['files'] });
    expect(() => scopesForServices(provider, ['nope'])).toThrow(/Unknown service: 'nope'. Known: mail, files, meet/);
  });
});

describe('CredentialStore', () => {
  it('stores credentials at 0600 under the data dir and a registry under config', async () => {
    const s = store();
    const file = await s.saveCredential('a@b.c', { type: 'oauth2', client_id: 'id', refresh_token: 'rt', scopes: ['x'] });
    expect(file).toBe(path.join(dir, 'data', 'credentials', 'a_at_b_dot_c.json'));
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    await s.addAccount({ id: 'a@b.c', category: 'work' });
    expect(await s.listAccounts()).toEqual([{ id: 'a@b.c', category: 'work' }]);
    await expect(s.addAccount({ id: 'a@b.c' })).rejects.toThrow(/already exists/);
    await expect(s.readCredential('a@b.c')).resolves.toMatchObject({ refresh_token: 'rt' });
    await s.removeAccount('a@b.c');
    expect(await s.hasCredential('a@b.c')).toBe(false);
    await expect(s.removeAccount('a@b.c')).rejects.toThrow(/not found/);
  });

  it('rejects malformed credentials', async () => {
    const s = store();
    await fs.mkdir(path.dirname(s.credentialPath('x')), { recursive: true });
    await fs.writeFile(s.credentialPath('x'), JSON.stringify({ type: 'oauth2', client_id: 'id' }));
    await expect(s.readCredential('x')).rejects.toThrow(/missing refresh_token/);
  });
});

describe('TokenService', () => {
  it('caches, dedupes concurrent refreshes, and names a revoked grant', async () => {
    const s = store();
    await s.saveCredential('u', { type: 'oauth2', client_id: 'id', client_secret: 'sec', refresh_token: 'rt' });
    let now = 1_000_000;
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }));
    const t = new TokenService({ provider, store: s, now: () => now, fetchFn: fetchFn as unknown as typeof fetch });
    const [a, b] = await Promise.all([t.getAccessToken('u'), t.getAccessToken('u')]);
    expect(a).toBe('tok');
    expect(b).toBe('tok');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = new URLSearchParams(fetchFn.mock.calls[0][1].body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('client_secret')).toBe('sec');
    now += 3600_000;
    await t.getAccessToken('u');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    t.invalidate('u');
    const err = await t.getAccessToken('u').catch(e => e);
    expect(err).toBeInstanceOf(TokenRefreshError);
    expect(err.message).toMatch(/Authenticate again/);
    expect(err.providerError).toBe('invalid_grant');
  });
});

describe('runLoopbackFlow', () => {
  it('uses PKCE and state, exchanges the code, and identifies the account', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const body = new URLSearchParams(init?.body as string);
      expect(url).toBe(provider.tokenUrl);
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('the-code');
      expect(body.get('code_verifier')).toBeTruthy();
      return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', scope: 'openid scope:mail', who: 'me@x.y' }), { status: 200 });
    });
    let seen = '';
    const result = await runLoopbackFlow({
      provider, clientId: 'cid', clientSecret: 'sec', scopes: ['openid', 'scope:mail'], fetchFn: fetchFn as unknown as typeof fetch,
      openBrowser: url => {
        seen = url;
        const u = new URL(url);
        const redirect = new URL(u.searchParams.get('redirect_uri')!);
        redirect.searchParams.set('code', 'the-code');
        redirect.searchParams.set('state', u.searchParams.get('state')!);
        void fetch(redirect);
      },
    });
    const u = new URL(seen);
    expect(u.origin + u.pathname).toBe(provider.authUrl);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('scope')).toBe('openid scope:mail');
    expect(result).toEqual({ account: 'me@x.y', tokens: expect.objectContaining({ refresh_token: 'rt' }), scopes: ['openid', 'scope:mail'] });
  });

  it('rejects a callback with the wrong state', async () => {
    await expect(runLoopbackFlow({
      provider, clientId: 'cid', scopes: [], timeoutMs: 5000,
      openBrowser: url => {
        const redirect = new URL(new URL(url).searchParams.get('redirect_uri')!);
        redirect.searchParams.set('code', 'c');
        redirect.searchParams.set('state', 'wrong');
        void fetch(redirect);
      },
    })).rejects.toThrow(/state mismatch/);
  });
});

describe('AccountManager and handler', () => {
  function setup() {
    const s = store();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid scope:mail.readonly', who: 'me@x.y' }), { status: 200 }));
    const manager = new AccountManager({
      provider, store: s, clientId: 'cid', clientSecret: 'sec',
      tokens: new TokenService({ provider, store: s, fetchFn: fetchFn as unknown as typeof fetch }),
      flow: {
        fetchFn: fetchFn as unknown as typeof fetch,
        openBrowser: url => {
          const u = new URL(url);
          const redirect = new URL(u.searchParams.get('redirect_uri')!);
          redirect.searchParams.set('code', 'c');
          redirect.searchParams.set('state', u.searchParams.get('state')!);
          void fetch(redirect);
        },
      },
    });
    const hints = vi.fn((ctx: string) => `\n[hint:${ctx}]`);
    return { manager, handler: createAccountsHandler({ manager, hints }), s };
  }

  it('stops before the browser when read-only cannot be honoured, then proceeds on confirmation', async () => {
    const { handler, manager } = setup();
    const first = await handler({ operation: 'authenticate', access: 'read', services: ['mail', 'files'] });
    expect(first.refs).toMatchObject({ status: 'needs-confirmation', stillAllowWrites: ['files'] });
    expect(first.text).toContain('Leave files out of `services`');
    expect(await manager.list()).toEqual([]);
    const second = await handler({ operation: 'authenticate', access: 'read', services: ['mail', 'files'], confirmWriteAccess: true, category: 'work' });
    expect(second.refs).toMatchObject({ status: 'success', account: 'me@x.y', access: 'read', stillAllowWrites: ['files'] });
    expect(second.text).toContain('files had no read-only option');
    expect(second.text).toContain('[hint:authenticate]');
    const list = await handler({ operation: 'list' });
    expect(list.text).toContain('[x] me@x.y (work)');
  });

  it('reports status, refreshes, changes scopes, and removes', async () => {
    const { handler, manager } = setup();
    await manager.authenticate({ services: ['mail'] });
    const status = await handler({ operation: 'status', email: 'me@x.y' });
    expect(status.text).toContain('[x] Token valid');
    expect(status.text).toContain('[x] Full access');
    expect(status.text).toContain('- scope:mail.readonly');
    expect((await handler({ operation: 'refresh', email: 'me@x.y' })).refs).toMatchObject({ status: 'refreshed' });
    expect((await handler({ operation: 'scopes', email: 'me@x.y' })).text).toContain('services is required for scopes. Known: mail, files, meet');
    expect((await handler({ operation: 'scopes', email: 'me@x.y', services: 'mail,meet', access: 'read' })).refs).toMatchObject({ status: 'success', access: 'read' });
    expect((await handler({ operation: 'status' })).text).toBe('email is required for this operation.');
    expect((await handler({ operation: 'authenticate', access: 'read-only' })).text).toContain("access must be 'read' or 'readwrite'");
    await handler({ operation: 'remove', email: 'me@x.y' });
    expect((await handler({ operation: 'status', email: 'me@x.y' })).text).toContain('No credential stored');
    expect((await handler({ operation: 'list' })).text).toContain('No accounts configured.');
  });

  it('refuses to bind a scopes re-auth to the wrong account', async () => {
    const { manager } = setup();
    await manager.authenticate({ services: ['mail'] });
    const r = await manager.scopes('other@x.y', ['mail']);
    expect(r).toMatchObject({ status: 'error', error: expect.stringContaining('not other@x.y') });
  });
});
