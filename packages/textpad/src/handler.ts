/**
 * The textpad tool: operations over a TextpadManager, with send and import
 * adapters the server supplies. Returns StepResult so the queue can chain it.
 */

import type { StepResult } from '@aaronsb/mcp-component-core';
import type { AttachmentRef, MutationResult, TextpadManager } from './manager.js';

export type Params = Record<string, unknown>;

/** Delivers a buffer somewhere. Return `isError` to keep the buffer alive for a retry. */
export type SendAdapter<TTarget = unknown> = (
  manager: TextpadManager<TTarget>,
  id: string,
  targetParams: Params,
) => Promise<StepResult>;

/** Loads content into a buffer from somewhere, setting its format. */
export type ImportAdapter<TTarget = unknown> = (
  manager: TextpadManager<TTarget>,
  id: string,
  sourceParams: Params,
) => Promise<StepResult>;

export interface TextpadHandlerOptions<TTarget = unknown> {
  manager: TextpadManager<TTarget>;
  /** Send targets by name. A buffer with a stored target sends there when no name is given. */
  send?: Record<string, SendAdapter<TTarget>>;
  import?: Record<string, ImportAdapter<TTarget>>;
  /** Turn attach parameters into a file reference, or throw with a reason. */
  resolveAttachment?: (params: Params) => Promise<Omit<AttachmentRef, 'refId'>>;
  /** Refuse a send before it runs. Return a result to hand back, or null to proceed. */
  beforeSend?: (target: string, targetParams: Params, id: string) => Promise<StepResult | null>;
  /** Called after any mutation, for servers that mirror a live resource. */
  afterMutation?: (id: string, operation: string) => Promise<StepResult | null>;
  /** Name of the tool as registered, used in messages. Default `textpad`. */
  toolName?: string;
}

export type TextpadHandler = (params: Params) => Promise<StepResult>;

export function createTextpadHandler<TTarget = unknown>(options: TextpadHandlerOptions<TTarget>): TextpadHandler {
  const { manager } = options;
  const sends = options.send ?? {};
  const imports = options.import ?? {};

  const error = (text: string): StepResult => ({ text, isError: true });
  const notFound = (id: unknown): StepResult =>
    id ? error(`Textpad ${String(id)} not found or expired. Use create to start a new one.`)
       : error('textpadId is required. Use create to start a new textpad.');
  const requireId = (params: Params): string | null => {
    const id = params.textpadId;
    return typeof id === 'string' && manager.get(id) ? id : null;
  };
  const lineCount = (id: string) => manager.get(id)?.lines.length ?? 0;

  const mutation = async (id: string, operation: string, result: MutationResult | null): Promise<StepResult> => {
    if (!result) return notFound(id);
    if (result.error) return { text: formatMutation(result), isError: true, refs: { textpadId: id } };
    const after = await options.afterMutation?.(id, operation);
    if (after) return after;
    return { text: formatMutation(result), refs: { textpadId: id, lineCount: lineCount(id) } };
  };

  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

  return async function handleTextpad(params: Params): Promise<StepResult> {
    const operation = str(params.operation);
    switch (operation) {
      case 'create': {
        const id = manager.create({
          label: str(params.label),
          content: str(params.content),
          format: str(params.format),
          target: params.target as TTarget | undefined,
        });
        const pad = manager.get(id)!;
        const lines = pad.lines.length > 0 ? ` (${pad.lines.length} lines)` : '';
        return {
          text: `Textpad created: ${id}${lines}\nFormat: ${pad.format}`,
          refs: { textpadId: id, format: pad.format, lineCount: pad.lines.length },
        };
      }
      case 'view': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        return { text: manager.view(id, num(params.startLine), num(params.endLine))!, refs: { textpadId: id } };
      }
      case 'discard': {
        const id = str(params.textpadId);
        if (!id) return error('textpadId is required.');
        manager.discard(id);
        return { text: `Textpad ${id} discarded.`, refs: { textpadId: id, status: 'discarded' } };
      }
      case 'list': {
        const list = manager.list();
        if (list.length === 0) return { text: 'No active textpads.', refs: { count: 0 } };
        const lines = list.map(s => {
          const parts = [`- ${s.id}${s.label ? ` "${s.label}"` : ''}`, s.format, `${s.lineCount} lines`];
          if (s.attachmentCount > 0) parts.push(`${s.attachmentCount} att`);
          if (s.bound) parts.push('live');
          parts.push(s.validation);
          return parts.join(' | ');
        });
        return { text: `Active textpads (${list.length}):\n${lines.join('\n')}`, refs: { count: list.length, textpads: list.map(s => s.id) } };
      }

      case 'insert_lines': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        const afterLine = num(params.afterLine);
        const content = str(params.content);
        if (afterLine === undefined) return error('afterLine is required for insert_lines.');
        if (content === undefined) return error('content is required for insert_lines.');
        return mutation(id, operation, manager.insertLines(id, afterLine, content));
      }
      case 'append_lines': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        const content = str(params.content);
        if (content === undefined) return error('content is required for append_lines.');
        return mutation(id, operation, manager.appendLines(id, content));
      }
      case 'replace_lines': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        const startLine = num(params.startLine);
        const endLine = num(params.endLine);
        const content = str(params.content);
        if (startLine === undefined || endLine === undefined) return error('startLine and endLine are required for replace_lines.');
        if (content === undefined) return error('content is required for replace_lines.');
        return mutation(id, operation, manager.replaceLines(id, startLine, endLine, content));
      }
      case 'remove_lines': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        const startLine = num(params.startLine);
        if (startLine === undefined) return error('startLine is required for remove_lines.');
        return mutation(id, operation, manager.removeLines(id, startLine, num(params.endLine)));
      }
      case 'copy_lines': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        const from = str(params.fromTextpadId);
        const startLine = num(params.startLine);
        const endLine = num(params.endLine);
        const afterLine = num(params.afterLine);
        if (!from) return error('fromTextpadId is required for copy_lines.');
        if (startLine === undefined || endLine === undefined || afterLine === undefined) {
          return error('startLine, endLine, and afterLine are required for copy_lines.');
        }
        return mutation(id, operation, manager.copyLines(id, from, startLine, endLine, afterLine));
      }

      case 'json_get': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        const path = str(params.path);
        if (!path) return error('path is required for json_get.');
        const result = manager.jsonGet(id, path)!;
        if ('error' in result) return error(result.error);
        return { text: `${path} (${result.lineSpan}):\n${JSON.stringify(result.value, null, 2)}`, refs: { textpadId: id, path, value: result.value } };
      }
      case 'json_set':
      case 'json_insert': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        const path = str(params.path);
        if (!path) return error(`path is required for ${operation}.`);
        if (!('value' in params)) return error(`value is required for ${operation}.`);
        const result = operation === 'json_set' ? manager.jsonSet(id, path, params.value) : manager.jsonInsert(id, path, params.value);
        return mutation(id, operation, result);
      }
      case 'json_delete': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        const path = str(params.path);
        if (!path) return error('path is required for json_delete.');
        return mutation(id, operation, manager.jsonDelete(id, path));
      }

      case 'attach': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        if (!options.resolveAttachment) return error('attach is not available on this server.');
        let ref: Omit<AttachmentRef, 'refId'>;
        try {
          ref = await options.resolveAttachment(params);
        } catch (err) {
          return error(`Cannot attach: ${err instanceof Error ? err.message : String(err)}`);
        }
        const result = manager.attach(id, ref, num(params.afterLine))!;
        return { text: result.message, refs: { textpadId: id, refId: result.refId } };
      }
      case 'detach': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        const refId = str(params.refId);
        if (!refId) return error('refId is required for detach.');
        const text = manager.detach(id, refId)!;
        return text.startsWith('Error:') ? error(text) : { text, refs: { textpadId: id, refId } };
      }

      case 'import': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        const source = str(params.source);
        const names = Object.keys(imports);
        if (!source) return error(`source is required for import${names.length ? ` (${names.join(', ')})` : ''}.`);
        const adapter = imports[source];
        if (!adapter) return error(`Unknown import source: ${source}. Valid sources: ${names.join(', ') || 'none'}.`);
        return adapter(manager, id, (params.sourceParams ?? {}) as Params);
      }
      case 'send': {
        const id = requireId(params);
        if (!id) return notFound(params.textpadId);
        const pad = manager.get(id)!;
        const names = Object.keys(sends);
        let target = str(params.target);
        let targetParams = (params.targetParams ?? {}) as Params;
        // A buffer created against a target sends there by default; the stored
        // target supplies the parameters and its `type` names the adapter.
        if (!target && pad.target && typeof pad.target === 'object') {
          const stored = pad.target as Record<string, unknown>;
          target = str(stored.type);
          targetParams = { ...stored, ...targetParams };
        }
        if (!target) return error(`target is required for send${names.length ? ` (${names.join(', ')})` : ''}.`);
        const adapter = sends[target];
        if (!adapter) return error(`Unknown send target: ${target}. Valid targets: ${names.join(', ') || 'none'}.`);

        const refused = await options.beforeSend?.(target, targetParams, id);
        if (refused) return refused;

        const result = await adapter(manager, id, targetParams);
        const keep = params.keep !== false;
        if (!keep && !result.isError && !result.blocked) {
          manager.discard(id);
          result.text += `\nTextpad ${id} discarded.`;
        }
        return result;
      }

      default:
        return error(`Unknown operation: ${operation ?? '(none)'}.`);
    }
  };
}

export function formatMutation(result: MutationResult): string {
  const parts = [result.message];
  if (result.context) parts.push(result.context);
  if (result.validation) parts.push(result.validation);
  return parts.join('\n');
}

// ── Tool schema ──────────────────────────────────────────────────

export interface TextpadSchemaOptions {
  formats?: string[];
  sendTargets?: string[];
  importSources?: string[];
  attachSources?: string[];
  /** Leave out operations the server does not wire, such as json_* or attach. */
  operations?: string[];
}

export const TEXTPAD_OPERATIONS = [
  'create', 'view', 'list', 'discard',
  'insert_lines', 'append_lines', 'replace_lines', 'remove_lines', 'copy_lines',
  'json_get', 'json_set', 'json_delete', 'json_insert',
  'attach', 'detach', 'import', 'send',
] as const;

export function textpadInputSchema(opts: TextpadSchemaOptions = {}): Record<string, unknown> {
  const operations = opts.operations ?? [...TEXTPAD_OPERATIONS];
  const withEnum = (list: string[] | undefined) => (list && list.length ? { enum: list } : {});
  return {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: operations, description: 'The textpad operation to perform.' },
      textpadId: { type: 'string', description: 'Textpad ID from create (required for every operation except create and list).' },
      label: { type: 'string', description: 'Human-readable label (create).' },
      content: { type: 'string', description: 'Text to add. Multi-line content is split on newlines (create, insert_lines, append_lines, replace_lines).' },
      format: { type: 'string', ...withEnum(opts.formats ?? ['text', 'markdown', 'json', 'csv']), description: 'Buffer format; picks the validator (create).' },
      target: { description: 'create: an object describing where the buffer goes, whose `type` names the send target. send: the send target name' + (opts.sendTargets?.length ? ` (${opts.sendTargets.join(', ')})` : '') + '.' },
      startLine: { type: 'number', description: '1-based first line (view, replace_lines, remove_lines, copy_lines).' },
      endLine: { type: 'number', description: '1-based last line, inclusive (view, replace_lines, remove_lines, copy_lines).' },
      afterLine: { type: 'number', description: 'Insert after this line; 0 prepends (insert_lines, copy_lines, attach).' },
      fromTextpadId: { type: 'string', description: 'Source buffer (copy_lines).' },
      path: { type: 'string', description: 'JSON path such as $.items[0].name (json_get, json_set, json_delete, json_insert).' },
      value: { description: 'Value to set or insert (json_set, json_insert).' },
      source: { type: 'string', ...withEnum(opts.attachSources ?? opts.importSources), description: 'Where to attach or import from (attach, import).' },
      sourceParams: { type: 'object', description: 'Parameters for the import source (import).' },
      filename: { type: 'string', description: 'File to attach (attach).' },
      refId: { type: 'string', description: 'Attachment reference to remove (detach).' },
      targetParams: { type: 'object', description: 'Parameters for the send target (send).' },
      keep: { type: 'boolean', default: true, description: 'Keep the buffer after a successful send (send).' },
    },
    required: ['operation'],
  };
}
