/**
 * The accounts tool over an AccountManager.
 */

import type { StepResult } from '@aaronsb/mcp-component-core';
import type { AccountManager, AccountStatus } from './manager.js';
import { allServices, type AccessLevel } from './provider.js';

export interface AccountsHandlerOptions {
  manager: AccountManager;
  /** Appended to results by context: list, list_empty, authenticate, status, refresh, scopes, remove. */
  hints?: (context: string, params?: Record<string, unknown>) => string;
  /** What the account id is called in this server. Default `email`. */
  idParam?: string;
  toolName?: string;
}

export type AccountsHandler = (params: Record<string, unknown>) => Promise<StepResult>;

export function createAccountsHandler(options: AccountsHandlerOptions): AccountsHandler {
  const { manager } = options;
  const idParam = options.idParam ?? 'email';
  const toolName = options.toolName ?? 'manage_accounts';
  const hints = options.hints ?? (() => '');
  const error = (text: string): StepResult => ({ text, isError: true });
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  const requireId = (params: Record<string, unknown>) => {
    const id = str(params[idParam]) ?? str(params.account);
    if (!id) throw new Error(`${idParam} is required for this operation.`);
    return id;
  };
  const requestedAccess = (params: Record<string, unknown>): AccessLevel => {
    const raw = params.access ?? 'readwrite';
    if (raw !== 'read' && raw !== 'readwrite') {
      throw new Error(`access must be 'read' or 'readwrite', got '${String(raw)}'.`);
    }
    return raw;
  };
  const serviceList = (params: Record<string, unknown>): string[] | undefined => {
    const raw = params.services;
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean);
    return undefined;
  };

  const confirmationText = (still: string[], retry: string, canNarrow: boolean): StepResult => ({
    text:
      `Read-only access was requested, but the provider has no read-only permission for: **${still.join(', ')}**.\n\n` +
      `Authorizing anyway would let this account change ${still.length === 1 ? 'that service' : 'those services'}. Nothing has been authorized yet.\n\n` +
      `Either:\n` +
      (canNarrow ? `- Leave ${still.join(', ')} out of \`services\` and re-run.\n` : `- Use \`operation: 'scopes'\` and list only the services you want read-only.\n`) +
      `- Or re-run with \`confirmWriteAccess: true\` to accept it: ${retry}\n`,
    refs: { status: 'needs-confirmation', stillAllowWrites: still },
  });

  const authText = (result: Awaited<ReturnType<AccountManager['authenticate']>>, context: string, params: Record<string, unknown>, canNarrow: boolean): StepResult => {
    if (result.status === 'needs-confirmation') {
      const retry = `${toolName} ${JSON.stringify({ ...params, confirmWriteAccess: true })}`;
      return confirmationText(result.stillAllowWrites, retry, canNarrow);
    }
    if (result.status === 'error') return error(`Authentication failed: ${result.error}`);
    const note = result.stillAllowWrites.length
      ? `\n\n> Read-only was requested. ${result.stillAllowWrites.join(', ')} had no read-only option and can still be changed by this account.`
      : '';
    return {
      text: `Account authenticated: **${result.account}** (${result.access === 'read' ? 'read-only' : 'full access'})${note}` + hints(context, { [idParam]: result.account }),
      refs: { status: 'success', account: result.account, [idParam]: result.account, access: result.access, stillAllowWrites: result.stillAllowWrites },
    };
  };

  return async params => {
    const operation = str(params.operation);
    try {
      switch (operation) {
        case 'list': {
          const accounts = await manager.list();
          if (accounts.length === 0) return { text: 'No accounts configured.' + hints('list_empty'), refs: { count: 0 } };
          const lines = accounts.map(a => `${a.hasCredential ? '[x]' : '[ ]'} ${a.id}${a.category ? ` (${a.category})` : ''}${a.description ? ` — ${a.description}` : ''}`);
          return {
            text: `## Accounts (${accounts.length})\n\n${lines.join('\n')}` + hints('list', { [idParam]: accounts[0].id }),
            refs: { count: accounts.length, accounts: accounts.map(a => a.id), [idParam]: accounts[0].id },
          };
        }
        case 'authenticate': {
          const result = await manager.authenticate({
            access: requestedAccess(params),
            services: serviceList(params),
            category: str(params.category),
            description: str(params.description),
            confirmWriteAccess: params.confirmWriteAccess === true,
          });
          return authText(result, 'authenticate', { operation, ...(params.access ? { access: params.access } : {}) }, serviceList(params) !== undefined);
        }
        case 'status': {
          const id = requireId(params);
          const s = await manager.status(id);
          return { text: formatStatus(s), refs: { [idParam]: id, ...s } };
        }
        case 'refresh': {
          const id = requireId(params);
          const r = await manager.refresh(id);
          return r.ok
            ? { text: `Token refreshed for ${id}.` + hints('refresh', { [idParam]: id }), refs: { [idParam]: id, status: 'refreshed' } }
            : error(`Refresh failed for ${id}: ${r.error}`);
        }
        case 'scopes': {
          const id = requireId(params);
          const services = serviceList(params);
          if (!services || services.length === 0) return error(`services is required for scopes. Known: ${allServices(manager.provider).join(', ')}.`);
          const result = await manager.scopes(id, services, { access: requestedAccess(params), confirmWriteAccess: params.confirmWriteAccess === true });
          return authText(result, 'scopes', { operation, [idParam]: id, services, ...(params.access ? { access: params.access } : {}) }, true);
        }
        case 'remove': {
          const id = requireId(params);
          await manager.remove(id);
          return { text: `Removed account ${id} and its credential.` + hints('remove'), refs: { [idParam]: id, status: 'removed' } };
        }
        default:
          return error(`Unknown operation: ${operation ?? '(none)'}. Valid: list, authenticate, status, refresh, scopes, remove.`);
      }
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err));
    }
  };
}

export function formatStatus(s: AccountStatus): string {
  const lines = [`## Account Status: ${s.id}`, ''];
  if (!s.hasCredential) {
    lines.push('[ ] No credential stored. Authenticate to add one.');
    return lines.join('\n');
  }
  lines.push(s.tokenValid ? '[x] Token valid' : `[ ] Token invalid${s.error ? `: ${s.error}` : ''}`);
  lines.push(
    s.access === 'read'
      ? s.stillAllowWrites.length
        ? `[~] Read-only, except: **${s.stillAllowWrites.join(', ')}**, which have no read-only option and can still be changed`
        : '[x] Read-only. This account cannot create, edit, or delete'
      : '[x] Full access. This account can create, edit, and delete',
  );
  lines.push(`**Scopes (${s.scopes.length}):**`, s.scopes.length ? s.scopes.map(x => `- ${x}`).join('\n') : '(none recorded)');
  return lines.join('\n');
}

export function accountsInputSchema(opts: { idParam?: string; services?: string[]; categories?: string[] } = {}): Record<string, unknown> {
  const idParam = opts.idParam ?? 'email';
  return {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['list', 'authenticate', 'status', 'refresh', 'scopes', 'remove'], description: 'list: show accounts. authenticate: add an account through the browser. status: token and scopes. refresh: fetch a fresh token. scopes: re-authorize with a different service list. remove: delete the account and its credential.' },
      [idParam]: { type: 'string', description: `Account identifier (required for status, refresh, scopes, remove).` },
      access: { type: 'string', enum: ['read', 'readwrite'], default: 'readwrite', description: "'read' asks for read-only scopes where the provider offers them (authenticate, scopes)." },
      services: { type: 'array', items: { type: 'string', ...(opts.services?.length ? { enum: opts.services } : {}) }, description: 'Services to authorize (scopes; optional for authenticate, default all).' },
      confirmWriteAccess: { type: 'boolean', description: 'Accept that some services stay writable when read-only was requested (authenticate, scopes).' },
      category: { type: 'string', ...(opts.categories?.length ? { enum: opts.categories } : {}), description: 'Label for the account, e.g. personal or work (authenticate).' },
      description: { type: 'string', description: 'Free-text note for the account (authenticate).' },
    },
    required: ['operation'],
  };
}
