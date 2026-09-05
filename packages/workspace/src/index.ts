/**
 * Workspace: the one directory a server reads and writes files in.
 *
 * Agents in sandboxed hosts cannot see the server's filesystem, so a read
 * returns text inline and images as content blocks. Every path is sanitised
 * per segment, resolved inside the root, and checked after symlink
 * resolution. The root itself may not be a home or documents directory or a
 * cloud sync mount.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ContentBlock, StepResult } from '@aaronsb/mcp-component-core';

// ── XDG ─────────────────────────────────────────────────────────

export function xdgDataDir(appName: string): string {
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), appName);
}

export function xdgConfigDir(appName: string): string {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName);
}

// ── Safety ──────────────────────────────────────────────────────

const HOME_RELATIVE_FORBIDDEN = ['', 'Documents', 'Desktop', 'Downloads'];

const CLOUD_SYNC_PATTERNS = [
  'google-drive', 'Google Drive', 'GoogleDrive', 'gdrive', 'My Drive',
  'OneDrive', 'onedrive', 'Dropbox', 'dropbox', 'iCloud Drive', 'iCloudDrive',
];

export function forbiddenRoots(): string[] {
  const homes = [process.env.HOME, process.env.USERPROFILE].filter((h): h is string => !!h);
  return homes.flatMap(h => HOME_RELATIVE_FORBIDDEN.map(rel => path.resolve(h, rel)));
}

/** Throws when `dir` is a protected directory itself, a cloud sync mount, or the root. Subdirectories are fine. */
export function validateWorkspaceDir(dir: string, suggestion?: string): void {
  const resolved = path.resolve(dir);
  if (forbiddenRoots().includes(resolved)) {
    throw new Error(`Workspace directory cannot be ${resolved} itself. Use a subdirectory${suggestion ? ` such as ${suggestion}` : ''}.`);
  }
  const lower = resolved.toLowerCase();
  for (const pattern of CLOUD_SYNC_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      throw new Error(`Workspace directory cannot be inside a cloud sync mount (${resolved}). Sync conflicts can lose data.`);
    }
  }
  if (resolved === path.parse(resolved).root) {
    throw new Error('Workspace directory cannot be the filesystem root.');
  }
}

/** One path segment: strips control characters and separators, never hidden, never empty. */
export function sanitizeFilename(filename: string): string {
  return filename
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    || 'unnamed';
}

/** A relative path: each segment sanitised, traversal segments rejected. */
export function sanitizePath(input: string): string {
  const segments = input.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.length === 0) return 'unnamed';
  return segments.map(seg => {
    if (seg === '..' || seg === '.') throw new Error(`Path traversal segment rejected: "${seg}"`);
    return sanitizeFilename(seg);
  }).join(path.sep);
}

// ── Inline content ──────────────────────────────────────────────

const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/x-yaml', 'application/toml', 'application/csv'];
const TEXT_EXTENSIONS = ['.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm', '.eml', '.log', '.ini', '.toml', '.js', '.ts', '.py', '.sh', '.bash', '.zsh', '.css', '.svg'];
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };

export const MAX_INLINE_TEXT = 100_000;
export const MAX_INLINE_IMAGE = 5_000_000;

export function isTextFile(filename: string, mimeType?: string): boolean {
  if (mimeType && TEXT_MIME_PREFIXES.some(p => mimeType.startsWith(p))) return true;
  return TEXT_EXTENSIONS.includes(path.extname(filename).toLowerCase());
}

export function isImageFile(filename: string, mimeType?: string): boolean {
  if (mimeType && mimeType.startsWith('image/')) return true;
  return path.extname(filename).toLowerCase() in IMAGE_MIME;
}

export function imageMimeType(filename: string, mimeType?: string): string {
  if (mimeType && mimeType.startsWith('image/')) return mimeType;
  return IMAGE_MIME[path.extname(filename).toLowerCase()] ?? 'image/png';
}

export function imageBlock(buffer: Buffer, filename: string, mimeType?: string): ContentBlock | undefined {
  if (buffer.length > MAX_INLINE_IMAGE) return undefined;
  return { type: 'image', data: buffer.toString('base64'), mimeType: imageMimeType(filename, mimeType) };
}

export interface FileOutput {
  filename: string;
  path: string;
  size: number;
  /** Text content inline, for hosts that cannot read the server's disk. */
  content?: string;
  image?: ContentBlock;
}

export function formatFileOutput(result: FileOutput): string {
  const parts = [`**${result.filename}** saved to workspace`, '', `**Path:** ${result.path}`, `**Size:** ${result.size} bytes`];
  if (result.content !== undefined) {
    parts.push('', '---', '', '```', result.content.replace(/```/g, '` ` `'), '```');
  } else if (result.image) {
    parts.push('', '_Image included inline below._');
  }
  return parts.join('\n');
}

// ── Workspace ───────────────────────────────────────────────────

export interface WorkspaceOptions {
  /** Names the XDG data directory the default root lives under. */
  appName: string;
  /** Environment variable that overrides the root. Default `WORKSPACE_DIR`. */
  envVar?: string;
  /** Explicit root, taking precedence over the environment. */
  dir?: string;
}

export interface WorkspaceStatus {
  path: string;
  valid: boolean;
  warning?: string;
}

export interface WorkspaceEntry {
  name: string;
  kind: 'file' | 'dir';
  size: number;
  modified: Date;
}

export class Workspace {
  readonly dir: string;
  private readonly defaultDir: string;

  constructor(options: WorkspaceOptions) {
    this.defaultDir = path.join(xdgDataDir(options.appName), 'workspace');
    const fromEnv = process.env[options.envVar ?? 'WORKSPACE_DIR'];
    // An unresolved bundle template such as "${user_config.workspace_dir}" is not a path.
    const configured = options.dir ?? (fromEnv && !fromEnv.includes('${') ? fromEnv : undefined);
    this.dir = configured ?? this.defaultDir;
  }

  status(): WorkspaceStatus {
    try {
      validateWorkspaceDir(this.dir, path.join(this.dir, 'mcp-workspace'));
      return { path: this.dir, valid: true };
    } catch (err) {
      return { path: this.dir, valid: false, warning: (err as Error).message };
    }
  }

  /** Validate and create the root. Returns status rather than throwing. */
  async ensure(): Promise<WorkspaceStatus> {
    const status = this.status();
    if (status.valid) await fs.mkdir(status.path, { recursive: true, mode: 0o755 });
    return status;
  }

  /** A workspace-relative name to an absolute path inside the root. */
  resolve(name: string): string {
    const root = path.resolve(this.dir);
    const resolved = path.resolve(root, sanitizePath(name));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Path traversal detected: "${name}" resolves outside the workspace.`);
    }
    return resolved;
  }

  /** After symlink resolution the path must still be inside the root. Missing files pass. */
  async verify(filePath: string): Promise<void> {
    const root = path.resolve(this.dir);
    try {
      const real = await fs.realpath(filePath);
      if (real !== root && !real.startsWith(root + path.sep)) {
        throw new Error(`Symlink escape detected: "${filePath}" resolves to "${real}" outside the workspace.`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  /** Resolve, verify, and return the absolute path for a name. */
  async safePath(name: string): Promise<string> {
    const p = this.resolve(name);
    await this.verify(p);
    return p;
  }

  async save(name: string, buffer: Buffer, mimeType?: string): Promise<FileOutput> {
    const status = await this.ensure();
    if (!status.valid) throw new Error(`Workspace directory invalid: ${status.warning}`);
    const target = await this.safePath(name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
    return this.describe(name, target, buffer, mimeType);
  }

  async read(name: string, mimeType?: string): Promise<FileOutput> {
    const target = await this.safePath(name);
    const buffer = await fs.readFile(target);
    return this.describe(name, target, buffer, mimeType);
  }

  private describe(name: string, target: string, buffer: Buffer, mimeType?: string): FileOutput {
    const out: FileOutput = { filename: name, path: target, size: buffer.length };
    if (isTextFile(name, mimeType) && buffer.length < MAX_INLINE_TEXT) out.content = buffer.toString('utf-8');
    else if (isImageFile(name, mimeType)) out.image = imageBlock(buffer, name, mimeType);
    return out;
  }

  async list(subdir = ''): Promise<WorkspaceEntry[]> {
    const target = subdir ? await this.safePath(subdir) : path.resolve(this.dir);
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(target, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: WorkspaceEntry[] = [];
    for (const e of entries) {
      const stat = await fs.stat(path.join(target, e.name));
      out.push({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file', size: stat.size, modified: stat.mtime });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async delete(name: string): Promise<void> {
    await fs.rm(await this.safePath(name), { recursive: true, force: false });
  }

  async mkdir(name: string): Promise<string> {
    const target = await this.safePath(name);
    await fs.mkdir(target, { recursive: true });
    return target;
  }

  async move(from: string, to: string): Promise<string> {
    const src = await this.safePath(from);
    const dst = await this.safePath(to);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.rename(src, dst);
    return dst;
  }
}

// ── Tool handler ────────────────────────────────────────────────

export type WorkspaceHandler = (params: Record<string, unknown>) => Promise<StepResult>;

export function createWorkspaceHandler(workspace: Workspace): WorkspaceHandler {
  const error = (text: string): StepResult => ({ text, isError: true });
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

  return async params => {
    const operation = str(params.operation);
    const name = str(params.path) ?? str(params.filename);
    try {
      switch (operation) {
        case 'list': {
          const entries = await workspace.list(name ?? '');
          const where = name ? `${name}/` : 'workspace root';
          if (entries.length === 0) return { text: `${where} is empty.\n\n**Path:** ${workspace.dir}`, refs: { count: 0 } };
          const lines = entries.map(e => e.kind === 'dir' ? `- ${e.name}/` : `- ${e.name} (${formatSize(e.size)}, ${e.modified.toISOString().slice(0, 10)})`);
          return { text: `${where} (${entries.length}):\n${lines.join('\n')}\n\n**Path:** ${workspace.dir}`, refs: { count: entries.length, names: entries.map(e => e.name) } };
        }
        case 'read': {
          if (!name) return error('path is required for read.');
          const out = await workspace.read(name);
          const text = out.content !== undefined
            ? `**${out.filename}** (${formatSize(out.size)})\n\n\`\`\`\n${out.content.replace(/```/g, '` ` `')}\n\`\`\``
            : out.image ? `**${out.filename}** (${formatSize(out.size)})\n\n_Image included inline below._`
            : `**${out.filename}** (${formatSize(out.size)}) is binary.\n\n**Path:** ${out.path}`;
          return { text, refs: { path: out.path, size: out.size }, blocks: out.image ? [out.image] : undefined };
        }
        case 'write': {
          if (!name) return error('path is required for write.');
          const content = str(params.content);
          if (content === undefined) return error('content is required for write.');
          const out = await workspace.save(name, Buffer.from(content, 'utf-8'));
          return { text: `Wrote **${name}** (${formatSize(out.size)}).\n\n**Path:** ${out.path}`, refs: { path: out.path, size: out.size, filename: name } };
        }
        case 'delete': {
          if (!name) return error('path is required for delete.');
          await workspace.delete(name);
          return { text: `Deleted ${name}.`, refs: { filename: name } };
        }
        case 'mkdir': {
          if (!name) return error('path is required for mkdir.');
          const p = await workspace.mkdir(name);
          return { text: `Created directory ${name}/.\n\n**Path:** ${p}`, refs: { path: p } };
        }
        case 'move': {
          const to = str(params.to) ?? str(params.newPath);
          if (!name || !to) return error('path and to are required for move.');
          const p = await workspace.move(name, to);
          return { text: `Moved ${name} to ${to}.\n\n**Path:** ${p}`, refs: { path: p, filename: to } };
        }
        default:
          return error(`Unknown operation: ${operation ?? '(none)'}. Valid: list, read, write, delete, mkdir, move.`);
      }
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err));
    }
  };
}

export function workspaceInputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['list', 'read', 'write', 'delete', 'mkdir', 'move'], description: 'The workspace operation to perform.' },
      path: { type: 'string', description: 'Workspace-relative path (read, write, delete, mkdir, move; optional subdirectory for list).' },
      content: { type: 'string', description: 'Text to write (write).' },
      to: { type: 'string', description: 'Destination workspace-relative path (move).' },
    },
    required: ['operation'],
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
