/**
 * The authorization-code flow for a local server: bind a loopback port, open
 * the browser to the consent screen, receive the redirect, exchange the code.
 * PKCE and a state nonce are always on.
 */

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { exec, execFile } from 'node:child_process';
import { platform } from 'node:os';
import type { OAuthProvider, TokenResponse } from './provider.js';

export interface LoopbackOptions {
  provider: OAuthProvider;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  /** Default opens the system browser. Tests pass a function that hits the URL. */
  openBrowser?: (url: string) => void;
  /** Default 5 minutes. */
  timeoutMs?: number;
  /** Bind address. Default 127.0.0.1. */
  host?: string;
  fetchFn?: typeof fetch;
  log?: (line: string) => void;
}

export interface LoopbackResult {
  account: string;
  tokens: TokenResponse;
  /** Scopes the provider granted, which can be fewer than asked. */
  scopes: string[];
}

export async function runLoopbackFlow(options: LoopbackOptions): Promise<LoopbackResult> {
  const { provider } = options;
  const fetchFn = options.fetchFn ?? fetch;
  const log = options.log ?? (() => {});
  const state = randomBytes(16).toString('hex');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const { code, redirectUri } = await listen({
    host: options.host ?? '127.0.0.1',
    timeoutMs: options.timeoutMs ?? 5 * 60_000,
    state,
    buildUrl: redirect => {
      const params = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: options.scopes.join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...(provider.authParams ?? {}),
      });
      return `${provider.authUrl}?${params.toString()}`;
    },
    open: options.openBrowser ?? openBrowser(log),
    log,
  });

  const body = new URLSearchParams({
    code,
    client_id: options.clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  if (options.clientSecret && provider.sendClientSecret !== false) body.set('client_secret', options.clientSecret);

  const res = await fetchFn(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  const tokens = (await res.json()) as TokenResponse;
  if (!tokens.refresh_token) {
    throw new Error('No refresh_token returned. The provider did not grant offline access; revoke the app at the provider and authenticate again.');
  }
  const account = await provider.identify(tokens, fetchFn);
  return { account, tokens, scopes: (tokens.scope ?? '').split(' ').filter(Boolean) };
}

interface ListenOptions {
  host: string;
  timeoutMs: number;
  state: string;
  buildUrl: (redirectUri: string) => string;
  open: (url: string) => void;
  log: (line: string) => void;
}

function listen(opts: ListenOptions): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let redirectUri = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`OAuth flow timed out: no callback within ${Math.round(opts.timeoutMs / 1000)}s`));
    }, opts.timeoutMs);
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.includes('callback') && url.pathname !== '/') {
        res.writeHead(404);
        res.end();
        return;
      }
      const page = (title: string, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h2>${title}</h2><p>You can close this tab.</p></body></html>`);
      };
      const error = url.searchParams.get('error');
      if (error) {
        page('Authentication failed');
        cleanup();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) return;
      if (url.searchParams.get('state') !== opts.state) {
        page('Invalid state parameter', 400);
        cleanup();
        reject(new Error('OAuth state mismatch'));
        return;
      }
      page('Authentication successful');
      cleanup();
      resolve({ code, redirectUri });
    });
    const cleanup = () => {
      clearTimeout(timer);
      server.close();
    };
    server.listen(0, opts.host, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind the callback server'));
        return;
      }
      redirectUri = `http://${opts.host}:${addr.port}/callback`;
      const authUrl = opts.buildUrl(redirectUri);
      opts.log('opening browser for consent');
      opts.open(authUrl);
    });
  });
}

export function openBrowser(log: (line: string) => void = () => {}): (url: string) => void {
  return url => {
    const onError = (err: Error | null) => {
      if (!err) return;
      log(`failed to open browser: ${err.message}`);
      log(`open this URL manually:\n${url}`);
    };
    if (platform() === 'win32') exec(`cmd /c start "" "${url}"`, onError);
    else execFile(platform() === 'darwin' ? 'open' : 'xdg-open', [url], onError);
  };
}
