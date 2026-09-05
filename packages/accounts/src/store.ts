/**
 * Where credentials and the account registry live: the XDG config and data
 * directories for the application, files at mode 0600, directories at 0700.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AccessLevel } from './provider.js';

export interface StoredCredential {
  type: 'oauth2';
  client_id: string;
  client_secret?: string;
  refresh_token: string;
  /** What the provider granted. */
  scopes?: string[];
  /** Absent means read/write. */
  access?: AccessLevel;
  stillAllowWrites?: string[];
  [key: string]: unknown;
}

export interface Account {
  id: string;
  category?: string;
  description?: string;
}

export interface StoreOptions {
  appName: string;
  /** Override both directories, for tests. */
  configDir?: string;
  dataDir?: string;
}

export function accountSlug(id: string): string {
  return id.replace(/[/\\]/g, '').replace(/@/g, '_at_').replace(/\./g, '_dot_');
}

export class CredentialStore {
  readonly configDir: string;
  readonly dataDir: string;

  constructor(options: StoreOptions) {
    this.configDir = options.configDir ?? path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), options.appName);
    this.dataDir = options.dataDir ?? path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), options.appName);
  }

  credentialPath(id: string): string {
    return path.join(this.dataDir, 'credentials', `${accountSlug(id)}.json`);
  }

  private get registryPath(): string {
    return path.join(this.configDir, 'accounts.json');
  }

  async hasCredential(id: string): Promise<boolean> {
    try {
      await fs.access(this.credentialPath(id));
      return true;
    } catch {
      return false;
    }
  }

  async saveCredential(id: string, credential: StoredCredential): Promise<string> {
    if (credential.type !== 'oauth2') throw new Error('Credential must have type "oauth2"');
    const file = this.credentialPath(id);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, JSON.stringify(credential, null, 2), { mode: 0o600 });
    return file;
  }

  async readCredential(id: string): Promise<StoredCredential> {
    const parsed = JSON.parse(await fs.readFile(this.credentialPath(id), 'utf-8')) as Record<string, unknown>;
    if (parsed.type !== 'oauth2') throw new Error(`Invalid credential for ${id}: expected type "oauth2"`);
    if (typeof parsed.refresh_token !== 'string' || !parsed.refresh_token) throw new Error(`Invalid credential for ${id}: missing refresh_token`);
    if (typeof parsed.client_id !== 'string' || !parsed.client_id) throw new Error(`Invalid credential for ${id}: missing client_id`);
    return parsed as unknown as StoredCredential;
  }

  async removeCredential(id: string): Promise<void> {
    try {
      await fs.unlink(this.credentialPath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async listAccounts(): Promise<Account[]> {
    try {
      const data = JSON.parse(await fs.readFile(this.registryPath, 'utf-8')) as { accounts?: Account[] };
      return data.accounts ?? [];
    } catch {
      return [];
    }
  }

  async getAccount(id: string): Promise<Account | undefined> {
    return (await this.listAccounts()).find(a => a.id === id);
  }

  async addAccount(account: Account): Promise<Account> {
    const accounts = await this.listAccounts();
    if (accounts.some(a => a.id === account.id)) throw new Error(`Account ${account.id} already exists`);
    accounts.push(account);
    await this.writeRegistry(accounts);
    return account;
  }

  async removeAccount(id: string): Promise<void> {
    const accounts = await this.listAccounts();
    const idx = accounts.findIndex(a => a.id === id);
    if (idx === -1) throw new Error(`Account ${id} not found`);
    accounts.splice(idx, 1);
    await this.writeRegistry(accounts);
    await this.removeCredential(id);
  }

  private async writeRegistry(accounts: Account[]): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.registryPath, JSON.stringify({ accounts }, null, 2), { mode: 0o600 });
  }
}
