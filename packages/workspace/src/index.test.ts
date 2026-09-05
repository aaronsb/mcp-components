import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Workspace, createWorkspaceHandler, sanitizePath, sanitizeFilename, validateWorkspaceDir, isTextFile, formatFileOutput } from './index.js';

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('path safety', () => {
  it('sanitises segments and rejects traversal', () => {
    expect(sanitizeFilename('..\\evil:name?.txt.')).toBe('_evil_name_.txt');
    expect(sanitizeFilename('.hidden')).toBe('hidden');
    expect(sanitizeFilename('\x00')).toBe('unnamed');
    expect(sanitizePath('reports//q1/summary.csv')).toBe(path.join('reports', 'q1', 'summary.csv'));
    expect(() => sanitizePath('../etc/passwd')).toThrow(/traversal/);
  });

  it('refuses home, documents, cloud mounts, and the root as a workspace', () => {
    const home = os.homedir();
    const saved = process.env.HOME;
    process.env.HOME = home;
    expect(() => validateWorkspaceDir(home)).toThrow(/cannot be/);
    expect(() => validateWorkspaceDir(path.join(home, 'Documents'))).toThrow(/cannot be/);
    expect(() => validateWorkspaceDir(path.join(home, 'Documents', 'mcp'))).not.toThrow();
    expect(() => validateWorkspaceDir('/tmp/Dropbox/x')).toThrow(/cloud sync/);
    expect(() => validateWorkspaceDir('/')).toThrow(/filesystem root/);
    process.env.HOME = saved;
  });

  it('keeps every resolved path under the root, including through symlinks', async () => {
    const ws = new Workspace({ appName: 'test', dir: root });
    expect(ws.resolve('a/b.txt')).toBe(path.join(root, 'a', 'b.txt'));
    expect(() => ws.resolve('../x')).toThrow(/traversal/);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'out-'));
    await fs.symlink(outside, path.join(root, 'link'));
    await expect(ws.verify(path.join(root, 'link'))).rejects.toThrow(/Symlink escape/);
    await expect(ws.verify(path.join(root, 'missing.txt'))).resolves.toBeUndefined();
    await fs.rm(outside, { recursive: true });
  });

  it('prefers an explicit dir, then the env var, ignoring unresolved bundle templates', () => {
    process.env.WS_TEST = '${user_config.workspace_dir}';
    expect(new Workspace({ appName: 'app', envVar: 'WS_TEST' }).dir).toMatch(/app[\\/]workspace$/);
    process.env.WS_TEST = '/tmp/explicit';
    expect(new Workspace({ appName: 'app', envVar: 'WS_TEST' }).dir).toBe('/tmp/explicit');
    expect(new Workspace({ appName: 'app', envVar: 'WS_TEST', dir: '/tmp/other' }).dir).toBe('/tmp/other');
    delete process.env.WS_TEST;
  });
});

describe('inline reads', () => {
  it('returns text inline under the size cap and images as blocks', async () => {
    const ws = new Workspace({ appName: 'test', dir: root });
    const saved = await ws.save('notes/a.md', Buffer.from('# hi\n```\nx\n```'));
    expect(saved.content).toBe('# hi\n```\nx\n```');
    expect(formatFileOutput(saved)).toContain('` ` `');
    const png = await ws.save('p.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(png.image).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(png.content).toBeUndefined();
    const big = await ws.save('big.txt', Buffer.alloc(200_000, 'a'));
    expect(big.content).toBeUndefined();
    expect(isTextFile('x.bin', 'application/json')).toBe(true);
  });
});

describe('workspace handler', () => {
  it('lists, writes, reads, moves, and deletes through one tool', async () => {
    const ws = new Workspace({ appName: 'test', dir: root });
    const h = createWorkspaceHandler(ws);
    expect((await h({ operation: 'list' })).text).toContain('workspace root is empty.');
    const w = await h({ operation: 'write', path: 'r/a.txt', content: 'hello' });
    expect(w.refs).toMatchObject({ filename: 'r/a.txt', size: 5 });
    const l = await h({ operation: 'list', path: 'r' });
    expect(l.text).toContain('- a.txt (5 B');
    const r = await h({ operation: 'read', path: 'r/a.txt' });
    expect(r.text).toContain('```\nhello\n```');
    await h({ operation: 'mkdir', path: 'z' });
    const m = await h({ operation: 'move', path: 'r/a.txt', to: 'z/b.txt' });
    expect(m.refs?.filename).toBe('z/b.txt');
    expect((await h({ operation: 'read', path: 'z/b.txt' })).isError).toBeUndefined();
    await h({ operation: 'delete', path: 'z/b.txt' });
    expect((await h({ operation: 'read', path: 'z/b.txt' })).isError).toBe(true);
    expect((await h({ operation: 'read', path: '../x' })).text).toMatch(/traversal/);
    expect((await h({ operation: 'nope' })).text).toContain('Unknown operation');
  });
});
