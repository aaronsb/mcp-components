/**
 * Queue: one tool call carrying an ordered list of steps.
 *
 * The agent hands over `[{tool, args, onError}]`. Steps run in order. A step's
 * arguments may reference an earlier step's result as `$N.field`. A failing
 * step either stops the queue (`bail`, the default) or is recorded and
 * skipped over (`continue`). A guardrail can refuse the whole queue before
 * anything runs. The report is one line per step, or the full output of each
 * step on request, with a single next-steps block taken from the last success.
 */

import { extractNextSteps, firstLine, stripNextSteps, type StepResult } from '@aaronsb/practice-core';

// ── Public types ─────────────────────────────────────────────────

export interface QueueStep {
  tool: string;
  args: Record<string, unknown>;
  /** `bail` stops the queue at this step's failure; `continue` records it and moves on. */
  onError?: 'bail' | 'continue';
}

export interface QueueRequest {
  operations: QueueStep[];
  /** `summary` is one line per step; `full` includes each step's output. */
  detail?: 'summary' | 'full';
}

export interface StepContext {
  index: number;
  depth: number;
}

export type StepHandler = (args: Record<string, unknown>, ctx: StepContext) => Promise<StepResult>;

export interface QueueGuard {
  /**
   * Inspect every step before any runs. Return a refusal message to reject
   * the whole queue, or null to proceed.
   */
  prescan?(steps: QueueStep[]): string | null;
  /** Called after a step succeeds, so a sliding-window guard can count it. */
  record?(step: QueueStep, args: Record<string, unknown>, result: StepResult): void;
}

export interface QueueOptions {
  handlers: Record<string, StepHandler>;
  /** Upper bound on steps per queue. Default 16. */
  maxOperations?: number;
  /** How deep a queue may nest inside a queue. Default 3. */
  maxDepth?: number;
  /**
   * When a handler returns no `refs`, derive them from its text and arguments
   * so `$N.field` still resolves. Used by servers whose handlers predate refs.
   */
  extractRefs?: (text: string, args: Record<string, unknown>, tool: string) => Record<string, unknown>;
  guard?: QueueGuard;
  /** Runs before each step. Servers use it to advance a tool-call epoch. */
  onStep?: (step: QueueStep, ctx: StepContext) => void;
}

export interface QueueStepReport {
  index: number;
  tool: string;
  status: 'success' | 'error' | 'skipped';
  text: string;
  refs?: Record<string, unknown>;
}

export interface QueueReport extends StepResult {
  results: QueueStepReport[];
  succeeded: number;
  failed: number;
  skipped: number;
  /** Index of the step that stopped the queue, or -1. */
  bailedAt: number;
}

export class QueueValidationError extends Error {}

// ── Execution ────────────────────────────────────────────────────

export async function runQueue(request: QueueRequest, options: QueueOptions, depth = 1): Promise<QueueReport> {
  const maxOperations = options.maxOperations ?? 16;
  const maxDepth = options.maxDepth ?? 3;

  if (depth > maxDepth) {
    throw new QueueValidationError(
      `Queue nested more than ${maxDepth} deep. Each level multiplies the work; flatten the inner queues into their parent.`,
    );
  }
  const operations = request.operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new QueueValidationError('operations must be a non-empty array.');
  }
  if (operations.length > maxOperations) {
    throw new QueueValidationError(`Maximum ${maxOperations} operations per queue. Got ${operations.length}.`);
  }
  operations.forEach((op, i) => {
    if (!op || typeof op.tool !== 'string' || !op.tool) {
      throw new QueueValidationError(`Operation ${i}: missing 'tool'.`);
    }
    if (!options.handlers[op.tool]) {
      throw new QueueValidationError(
        `Operation ${i}: unknown tool '${op.tool}'. Valid: ${Object.keys(options.handlers).join(', ')}`,
      );
    }
    if (!op.args || typeof op.args !== 'object' || Array.isArray(op.args)) {
      throw new QueueValidationError(`Operation ${i}: missing 'args' object.`);
    }
  });

  const refusal = options.guard?.prescan?.(operations);
  if (refusal) {
    return {
      text: refusal,
      isError: true,
      blocked: true,
      results: [],
      succeeded: 0,
      failed: 0,
      skipped: operations.length,
      bailedAt: -1,
    };
  }

  const results: QueueStepReport[] = [];
  let bailedAt = -1;
  let lastSuccessText = '';

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const strategy = op.onError ?? 'bail';
    const fail = (text: string) => {
      results.push({ index: i, tool: op.tool, status: 'error', text });
      if (strategy === 'bail') bailedAt = i;
    };

    if (bailedAt >= 0) {
      results.push({ index: i, tool: op.tool, status: 'skipped', text: `Skipped: queue stopped at operation ${bailedAt + 1}.` });
      continue;
    }

    let args: Record<string, unknown>;
    try {
      args = resolveReferences(op.args, results);
    } catch (err) {
      fail(errorMessage(err));
      continue;
    }

    const ctx: StepContext = { index: i, depth };
    try {
      options.onStep?.(op, ctx);
      const result = await options.handlers[op.tool](args, ctx);
      if (result.blocked || result.isError) {
        fail(stripNextSteps(result.text));
        continue;
      }
      const refs = result.refs ?? options.extractRefs?.(result.text, args, op.tool);
      results.push({ index: i, tool: op.tool, status: 'success', text: stripNextSteps(result.text), refs });
      lastSuccessText = result.text;
      options.guard?.record?.(op, args, result);
    } catch (err) {
      fail(errorMessage(err));
    }
  }

  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  return {
    text: formatReport(results, bailedAt, request.detail ?? 'summary', lastSuccessText),
    refs: {
      total: results.length,
      succeeded,
      failed,
      skipped,
      results: results.map(r => ({ tool: r.tool, status: r.status, ...(r.refs ?? {}) })),
    },
    isError: failed > 0 && succeeded === 0,
    results,
    succeeded,
    failed,
    skipped,
    bailedAt,
  };
}

/**
 * A handler that runs a nested queue, for registering the queue as one of
 * its own tools. Depth is carried through the step context.
 */
export function nestedQueueHandler(options: QueueOptions): StepHandler {
  return async (args, ctx) => runQueue(args as unknown as QueueRequest, options, ctx.depth + 1);
}

// ── References ───────────────────────────────────────────────────

const REF_RE = /\$(\d+)\.(\w+)/g;

/** Replace every `$N.field` inside string arguments with the named ref from step N. */
export function resolveReferences(
  args: Record<string, unknown>,
  results: QueueStepReport[],
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    resolved[key] = typeof value === 'string' && /\$\d+\./.test(value) ? resolveRef(value, results) : value;
  }
  return resolved;
}

function resolveRef(value: string, results: QueueStepReport[]): string {
  return value.replace(REF_RE, (_m, indexStr: string, field: string) => {
    const index = parseInt(indexStr, 10);
    if (index >= results.length) {
      throw new Error(`$${index}.${field}: operation ${index} has not run yet.`);
    }
    const r = results[index];
    if (r.status !== 'success') {
      throw new Error(`$${index}.${field}: operation ${index} ${r.status}.`);
    }
    const found = r.refs?.[field];
    if (found === undefined || found === null) {
      const known = Object.keys(r.refs ?? {});
      throw new Error(
        `$${index}.${field}: operation ${index} exposes no '${field}'` + (known.length ? ` (has: ${known.join(', ')}).` : '.'),
      );
    }
    return String(found);
  });
}

// ── Report ───────────────────────────────────────────────────────

function formatReport(
  results: QueueStepReport[],
  bailedAt: number,
  detail: 'summary' | 'full',
  lastSuccessText: string,
): string {
  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const ran = results.length - skipped;

  const lines: string[] = [
    `Executed ${ran} of ${results.length} operations. Success: ${succeeded}, Errors: ${failed}${skipped ? `, Skipped: ${skipped}` : ''}`,
  ];
  if (bailedAt >= 0) {
    lines.push(`Stopped at operation ${bailedAt + 1} due to error.`);
  }
  lines.push('');

  for (const r of results) {
    const mark = r.status === 'success' ? 'ok' : r.status === 'error' ? 'ERR' : 'SKIP';
    if (detail === 'full' && r.status !== 'skipped') {
      lines.push(`---`, `**[${r.index + 1}] ${r.tool} ${mark}**`, r.text, '');
    } else {
      lines.push(`  [${r.index + 1}] ${r.tool} ${mark}: ${r.status === 'skipped' ? r.text : firstLine(r.text)}`);
    }
  }
  if (detail === 'summary') {
    lines.push('', '_Use `detail: "full"` for complete output from each operation._');
  }
  return lines.join('\n') + extractNextSteps(lastSuccessText);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Tool schema ──────────────────────────────────────────────────

/**
 * The JSON schema for a queue tool's input, given the tool names it may
 * dispatch to. Servers spread this into their tool definition.
 */
export function queueInputSchema(tools: string[], maxOperations = 16): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        maxItems: maxOperations,
        description: `Ordered list of operations to execute (max ${maxOperations}).`,
        items: {
          type: 'object',
          required: ['tool', 'args'],
          properties: {
            tool: { type: 'string', enum: tools, description: 'Which tool to call.' },
            args: {
              type: 'object',
              description: 'Arguments for the tool call. Use $N.field to reference a value from operation N (e.g. $0.id).',
            },
            onError: {
              type: 'string',
              enum: ['bail', 'continue'],
              default: 'bail',
              description: 'bail (default): stop the queue at this failure. continue: record the error and proceed.',
            },
          },
        },
      },
      detail: {
        type: 'string',
        enum: ['summary', 'full'],
        default: 'summary',
        description: 'summary (default): one line per operation. full: complete output of each operation.',
      },
    },
    required: ['operations'],
  };
}
