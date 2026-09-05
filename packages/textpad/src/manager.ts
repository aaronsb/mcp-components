/**
 * TextpadManager: line-addressed buffers an agent edits with small calls.
 *
 * A buffer holds lines, a format that picks its validator, an optional target
 * bound at creation or at send time, a side table for anything the text form
 * cannot express, and attachments by reference. Buffers expire by an
 * injectable clock so a server can count tool calls or wall time.
 */

import { randomUUID } from 'node:crypto';
import { builtinValidators, validate, type Validator } from './validate.js';
import { getByPath, setByPath, deleteByPath } from './json-path.js';

// ── Types ────────────────────────────────────────────────────────

export interface AttachmentRef {
  refId: string;
  /** Where the file lives: a server-defined source such as `workspace` or `drive`. */
  source: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Path or id the send adapter resolves. */
  location: string;
}

export interface Textpad<TTarget = unknown> {
  id: string;
  lines: string[];
  format: string;
  label?: string;
  /** Where a send delivers when the caller names no target. */
  target?: TTarget;
  /** Nodes the text form cannot express, keyed by the marker left in the buffer. */
  sideTable: Map<string, unknown>;
  attachments: Map<string, AttachmentRef>;
  /** Server-defined live binding, when the buffer mirrors a remote resource. */
  binding?: unknown;
  createdAt: Date;
  lastTouched: number;
}

export interface MutationResult {
  message: string;
  context: string;
  validation: string;
  /** True when the mutation was refused and the buffer is unchanged. */
  error?: boolean;
}

export interface TextpadSummary<TTarget = unknown> {
  id: string;
  format: string;
  label?: string;
  target?: TTarget;
  lineCount: number;
  attachmentCount: number;
  bound: boolean;
  validation: string;
  lastTouched: number;
}

export interface Expiry {
  /** Current tick: wall-clock ms, or a tool-call epoch. */
  now: () => number;
  /** Ticks since last touch after which a buffer is gone. */
  maxAge: number;
}

export interface TextpadManagerOptions {
  /** Default is 30 minutes of wall time. */
  expiry?: Expiry;
  /** Extra or overriding validators by format name. */
  validators?: Record<string, Validator>;
  /** Format for buffers created without one. Default `text`. */
  defaultFormat?: string;
}

export interface CreateOptions<TTarget = unknown> {
  label?: string;
  content?: string;
  lines?: string[];
  format?: string;
  target?: TTarget;
  sideTable?: Map<string, unknown>;
}

const DEFAULT_EXPIRY: Expiry = { now: () => Date.now(), maxAge: 30 * 60 * 1000 };

// ── Manager ──────────────────────────────────────────────────────

export class TextpadManager<TTarget = unknown> {
  private pads = new Map<string, Textpad<TTarget>>();
  private readonly expiry: Expiry;
  private readonly validators: Record<string, Validator>;
  private readonly defaultFormat: string;

  constructor(options: TextpadManagerOptions = {}) {
    this.expiry = options.expiry ?? DEFAULT_EXPIRY;
    this.validators = { ...builtinValidators, ...(options.validators ?? {}) };
    this.defaultFormat = options.defaultFormat ?? 'text';
  }

  create(opts: CreateOptions<TTarget> = {}): string {
    this.gc();
    const id = `sp-${randomUUID().slice(0, 12)}`;
    const lines = opts.lines ? [...opts.lines] : opts.content ? normalizeAndSplit(opts.content) : [];
    this.pads.set(id, {
      id,
      lines,
      format: opts.format ?? this.defaultFormat,
      label: opts.label,
      target: opts.target,
      sideTable: opts.sideTable ? new Map(opts.sideTable) : new Map(),
      attachments: new Map(),
      createdAt: new Date(),
      lastTouched: this.expiry.now(),
    });
    return id;
  }

  get(id: string): Textpad<TTarget> | null {
    const pad = this.pads.get(id);
    if (!pad) return null;
    if (this.isExpired(pad)) {
      this.pads.delete(id);
      return null;
    }
    return pad;
  }

  private touch(pad: Textpad<TTarget>): void {
    pad.lastTouched = this.expiry.now();
  }

  validation(pad: Textpad<TTarget>): string {
    return validate(pad.lines, pad.format, this.validators);
  }

  // ── Viewing ────────────────────────────────────────────────────

  view(id: string, startLine?: number, endLine?: number): string | null {
    const pad = this.get(id);
    if (!pad) return null;
    this.touch(pad);
    const start = startLine ? Math.max(1, startLine) : 1;
    const end = endLine ? Math.min(endLine, pad.lines.length) : pad.lines.length;
    return `${this.header(pad)}\n${formatNumberedLines(pad.lines, start, end)}\n${this.validation(pad)}`;
  }

  private header(pad: Textpad<TTarget>): string {
    const parts = [`Textpad: ${pad.id}${pad.label ? ` "${pad.label}"` : ''}`, pad.format, `${pad.lines.length} lines`];
    if (pad.attachments.size > 0) parts.push(`${pad.attachments.size} attachment(s)`);
    if (pad.target !== undefined) parts.push(`target: ${describeTarget(pad.target)}`);
    if (pad.binding !== undefined) parts.push('live');
    return parts.join(' | ');
  }

  // ── Line operations ────────────────────────────────────────────

  insertLines(id: string, afterLine: number, content: string): MutationResult | null {
    const pad = this.get(id);
    if (!pad) return null;
    this.touch(pad);
    if (afterLine < 0 || afterLine > pad.lines.length) {
      return this.refuse(pad, `afterLine ${afterLine} out of range (0-${pad.lines.length}).`);
    }
    const added = normalizeAndSplit(content);
    pad.lines.splice(afterLine, 0, ...added);
    return this.done(pad, `Inserted ${added.length} line(s) after line ${afterLine}.`, afterLine + 1, afterLine + added.length);
  }

  appendLines(id: string, content: string): MutationResult | null {
    const pad = this.get(id);
    if (!pad) return null;
    this.touch(pad);
    const added = normalizeAndSplit(content);
    const start = pad.lines.length + 1;
    pad.lines.push(...added);
    return this.done(pad, `Appended ${added.length} line(s).`, start, pad.lines.length);
  }

  replaceLines(id: string, startLine: number, endLine: number, content: string): MutationResult | null {
    const pad = this.get(id);
    if (!pad) return null;
    this.touch(pad);
    const bad = this.checkRange(pad, startLine, endLine);
    if (bad) return this.refuse(pad, bad);
    const added = normalizeAndSplit(content);
    pad.lines.splice(startLine - 1, endLine - startLine + 1, ...added);
    return this.done(pad, `Replaced lines ${startLine}-${endLine}.`, startLine, startLine + added.length - 1);
  }

  removeLines(id: string, startLine: number, endLine?: number): MutationResult | null {
    const pad = this.get(id);
    if (!pad) return null;
    this.touch(pad);
    const end = endLine ?? startLine;
    const bad = this.checkRange(pad, startLine, end);
    if (bad) return this.refuse(pad, bad);
    pad.lines.splice(startLine - 1, end - startLine + 1);
    const join = Math.min(startLine, pad.lines.length);
    return {
      message: `Removed ${end - startLine + 1} line(s). Buffer: ${pad.lines.length} lines.`,
      context: formatRemoveContext(pad.lines, startLine, join),
      validation: this.validation(pad),
    };
  }

  /** Copy a line range from another buffer. The source is unchanged. */
  copyLines(targetId: string, sourceId: string, startLine: number, endLine: number, afterLine: number): MutationResult | null {
    const target = this.get(targetId);
    if (!target) return null;
    const source = this.get(sourceId);
    if (!source) return this.refuse(target, `source textpad ${sourceId} not found.`);
    const bad = this.checkRange(source, startLine, endLine, 'source ');
    if (bad) return this.refuse(target, bad);
    if (afterLine < 0 || afterLine > target.lines.length) {
      return this.refuse(target, `afterLine ${afterLine} out of range (0-${target.lines.length}).`);
    }
    this.touch(target);
    this.touch(source);
    const copied = source.lines.slice(startLine - 1, endLine);
    target.lines.splice(afterLine, 0, ...copied);
    return this.done(target, `Copied ${copied.length} line(s) from ${sourceId}.`, afterLine + 1, afterLine + copied.length);
  }

  private checkRange(pad: Textpad<TTarget>, startLine: number, endLine: number, label = ''): string | null {
    if (startLine < 1 || startLine > pad.lines.length) {
      return `${label}startLine ${startLine} out of range (1-${pad.lines.length}).`;
    }
    if (endLine < startLine || endLine > pad.lines.length) {
      return `${label}endLine ${endLine} out of range (${startLine}-${pad.lines.length}).`;
    }
    return null;
  }

  private refuse(pad: Textpad<TTarget>, reason: string): MutationResult {
    return { message: `Error: ${reason}`, context: '', validation: this.validation(pad), error: true };
  }

  private done(pad: Textpad<TTarget>, message: string, affectedStart: number, affectedEnd: number): MutationResult {
    return {
      message: `${message} Buffer: ${pad.lines.length} lines.`,
      context: formatContext(pad.lines, affectedStart, affectedEnd),
      validation: this.validation(pad),
    };
  }

  // ── JSON path operations ───────────────────────────────────────

  jsonGet(id: string, path: string): { value: unknown; lineSpan: string } | { error: string } | null {
    const pad = this.get(id);
    if (!pad) return null;
    if (pad.format !== 'json') return { error: 'json_get requires format: json' };
    this.touch(pad);
    const parsed = this.parseJson(pad);
    if ('error' in parsed) return parsed;
    try {
      const value = getByPath(parsed.obj, path);
      return { value, lineSpan: `${JSON.stringify(value, null, 2).split('\n').length} line(s)` };
    } catch (err) {
      return { error: errorMessage(err) };
    }
  }

  jsonSet(id: string, path: string, value: unknown): MutationResult | null {
    return this.jsonMutate(id, 'json_set', obj => setByPath(obj, path, value), `Set ${path}.`);
  }

  jsonDelete(id: string, path: string): MutationResult | null {
    return this.jsonMutate(id, 'json_delete', obj => deleteByPath(obj, path), `Deleted ${path}.`);
  }

  jsonInsert(id: string, path: string, value: unknown): MutationResult | null {
    return this.jsonMutate(id, 'json_insert', obj => {
      const target = getByPath(obj, path);
      if (!Array.isArray(target)) throw new Error(`${path} is not an array.`);
      target.push(value);
    }, `Inserted into ${path}.`);
  }

  private jsonMutate(id: string, op: string, mutate: (obj: unknown) => void, message: string): MutationResult | null {
    const pad = this.get(id);
    if (!pad) return null;
    if (pad.format !== 'json') return { message: `Error: ${op} requires format: json`, context: '', validation: '', error: true };
    this.touch(pad);
    const parsed = this.parseJson(pad);
    if ('error' in parsed) return this.refuse(pad, parsed.error);
    try {
      mutate(parsed.obj);
    } catch (err) {
      return this.refuse(pad, errorMessage(err));
    }
    pad.lines = JSON.stringify(parsed.obj, null, 2).split('\n');
    return { message: `${message} Buffer: ${pad.lines.length} lines.`, context: '', validation: this.validation(pad) };
  }

  private parseJson(pad: Textpad<TTarget>): { obj: unknown } | { error: string } {
    try {
      return { obj: JSON.parse(pad.lines.join('\n')) };
    } catch {
      return { error: 'buffer is not valid JSON. Fix syntax errors first.' };
    }
  }

  // ── Attachments ────────────────────────────────────────────────

  /** Record a file by reference and drop a marker line the agent can move or delete. */
  attach(id: string, ref: Omit<AttachmentRef, 'refId'>, afterLine?: number): { refId: string; message: string } | null {
    const pad = this.get(id);
    if (!pad) return null;
    this.touch(pad);
    const refId = `att-${pad.attachments.size + 1}`;
    pad.attachments.set(refId, { ...ref, refId });
    const marker = `![${ref.filename}](att:${refId} "${ref.filename}, ${formatSize(ref.size)}, from ${ref.source}")`;
    pad.lines.splice(afterLine ?? pad.lines.length, 0, marker);
    return { refId, message: `Attached ${ref.filename} as ${refId}. Buffer: ${pad.lines.length} lines.` };
  }

  /** Forget an attachment. The marker line stays for the agent to remove. */
  detach(id: string, refId: string): string | null {
    const pad = this.get(id);
    if (!pad) return null;
    this.touch(pad);
    const ref = pad.attachments.get(refId);
    if (!ref) return `Error: attachment ${refId} not found.`;
    pad.attachments.delete(refId);
    return `Detached ${ref.filename} (${refId}). Marker line remains in buffer; remove it with remove_lines if needed.`;
  }

  getAttachments(id: string): Map<string, AttachmentRef> | null {
    return this.get(id)?.attachments ?? null;
  }

  // ── Target, side table, binding ────────────────────────────────

  setTarget(id: string, target: TTarget | undefined): boolean {
    const pad = this.get(id);
    if (!pad) return false;
    pad.target = target;
    return true;
  }

  getSideTable(id: string): Map<string, unknown> | null {
    return this.get(id)?.sideTable ?? null;
  }

  setBinding(id: string, binding: unknown): boolean {
    const pad = this.get(id);
    if (!pad) return false;
    pad.binding = binding;
    return true;
  }

  getBinding(id: string): unknown {
    return this.get(id)?.binding;
  }

  // ── Whole-buffer access ────────────────────────────────────────

  getContent(id: string): string | null {
    const pad = this.get(id);
    return pad ? pad.lines.join('\n') : null;
  }

  /** Replace the whole buffer, as an import or a reload from a live resource does. */
  setLines(id: string, lines: string[], format?: string): boolean {
    const pad = this.get(id);
    if (!pad) return false;
    this.touch(pad);
    pad.lines = [...lines];
    if (format) pad.format = format;
    return true;
  }

  appendRawLines(id: string, lines: string[]): boolean {
    const pad = this.get(id);
    if (!pad) return false;
    this.touch(pad);
    pad.lines.push(...lines);
    return true;
  }

  setFormat(id: string, format: string): boolean {
    const pad = this.get(id);
    if (!pad) return false;
    pad.format = format;
    return true;
  }

  discard(id: string): boolean {
    return this.pads.delete(id);
  }

  list(): TextpadSummary<TTarget>[] {
    this.gc();
    return [...this.pads.values()].map(pad => ({
      id: pad.id,
      format: pad.format,
      label: pad.label,
      target: pad.target,
      lineCount: pad.lines.length,
      attachmentCount: pad.attachments.size,
      bound: pad.binding !== undefined,
      validation: this.validation(pad),
      lastTouched: pad.lastTouched,
    }));
  }

  // ── Expiry ─────────────────────────────────────────────────────

  private isExpired(pad: Textpad<TTarget>): boolean {
    return this.expiry.now() - pad.lastTouched > this.expiry.maxAge;
  }

  private gc(): void {
    for (const pad of [...this.pads.values()]) {
      if (this.isExpired(pad)) this.pads.delete(pad.id);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/** Lines are LF-delimited. CRLF and bare CR are normalised on the way in. */
export function normalizeAndSplit(content: string): string[] {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

export function describeTarget(target: unknown): string {
  if (target === null || target === undefined) return 'none';
  if (typeof target === 'string') return target;
  if (typeof target === 'object') {
    const t = target as Record<string, unknown>;
    const kind = typeof t.type === 'string' ? t.type : 'target';
    const name = ['title', 'name', 'id', 'pageId', 'to'].map(k => t[k]).find(v => typeof v === 'string');
    return name ? `${kind} "${name}"` : kind;
  }
  return String(target);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNumberedLines(lines: string[], start: number, end: number): string {
  if (lines.length === 0) return '  (empty buffer)';
  const width = String(end).length;
  const out: string[] = [];
  for (let i = start; i <= end; i++) out.push(`${String(i).padStart(width)} | ${lines[i - 1]}`);
  return out.join('\n');
}

/** The edit site with one line of context either side; long ranges are elided. */
function formatContext(lines: string[], affectedStart: number, affectedEnd: number): string {
  if (lines.length === 0) return '';
  const width = String(Math.min(affectedEnd + 1, lines.length)).length;
  const row = (n: number) => `${String(n).padStart(width)} | ${lines[n - 1]}`;
  const parts: string[] = [];
  if (affectedStart > 1) parts.push(row(affectedStart - 1));
  parts.push(row(affectedStart));
  if (affectedEnd - affectedStart > 1) parts.push(`${' '.repeat(width)} | ...`);
  if (affectedEnd > affectedStart) parts.push(row(affectedEnd));
  if (affectedEnd < lines.length) parts.push(row(affectedEnd + 1));
  return parts.join('\n');
}

function formatRemoveContext(lines: string[], removedAt: number, joinLine: number): string {
  if (lines.length === 0) return '  (buffer now empty)';
  const width = String(Math.min(joinLine + 1, lines.length)).length;
  const row = (n: number) => `${String(n).padStart(width)} | ${lines[n - 1]}`;
  const parts: string[] = [];
  if (removedAt > 1 && removedAt - 1 <= lines.length) parts.push(row(removedAt - 1));
  if (joinLine >= 1 && joinLine <= lines.length) parts.push(row(joinLine));
  return parts.join('\n');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
