/**
 * Guardrails for writes an agent should not make in bulk or at all.
 *
 * Two mechanisms. A sliding-window guard counts destructive operations and,
 * past a limit, refuses with a message that hands the agent a review URL. A
 * policy chain evaluates a write against composable rules that allow, block,
 * or downgrade it, such as turning a send into a draft.
 */

// ── Sliding window ──────────────────────────────────────────────

export interface TrackedOperation {
  operation: string;
  key: string;
  at: number;
}

export interface SlidingWindowOptions {
  /** Destructive operations allowed inside one window. Default 3. */
  limit?: number;
  /** Window length in ticks of `now`. Default 60 000 ms. */
  windowMs?: number;
  now?: () => number;
  /**
   * Build the refusal. Receives the operation and every key in the window
   * plus the one being refused, so the message can offer them for review.
   */
  deflect?: (operation: string, keys: string[]) => string;
}

export class SlidingWindowGuard {
  private ops: TrackedOperation[] = [];
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly deflect: (operation: string, keys: string[]) => string;

  constructor(options: SlidingWindowOptions = {}) {
    this.limit = options.limit !== undefined && options.limit >= 1 ? options.limit : 3;
    this.windowMs = options.windowMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
    this.deflect = options.deflect ?? defaultDeflection;
  }

  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    this.ops = this.ops.filter(op => op.at >= cutoff);
  }

  /** Null when allowed, otherwise the refusal to hand back. */
  check(operation: string, key: string): string | null {
    this.prune();
    if (this.ops.length < this.limit) return null;
    return this.refusal(operation, [key]);
  }

  /** The deflection for these keys on top of everything already in the window. */
  refusal(operation: string, keys: string[]): string {
    this.prune();
    return this.deflect(operation, [...this.ops.map(o => o.key), ...keys]);
  }

  record(operation: string, key: string): void {
    this.ops.push({ operation, key, at: this.now() });
  }

  remaining(): number {
    this.prune();
    return Math.max(0, this.limit - this.ops.length);
  }

  getLimit(): number {
    return this.limit;
  }

  reset(): void {
    this.ops = [];
  }
}

export function defaultDeflection(operation: string, keys: string[]): string {
  return [
    `Bulk ${operation} is not supported through this tool. ${keys.length} items in quick succession is best done with manual review.`,
    '',
    `Items: ${keys.join(', ')}`,
    '',
    `To ${operation} a single item, wait a moment and try again with one at a time.`,
  ].join('\n');
}

/**
 * A deflection that links to a review page for the keys, for services with
 * a query language. `reviewUrl` turns the keys into a URL, e.g. a JQL search.
 */
export function reviewDeflection(reviewUrl: (keys: string[]) => string, unit = 'items'): (operation: string, keys: string[]) => string {
  return (operation, keys) => [
    `Bulk ${operation} is not supported through this tool. ${keys.length} ${unit} in quick succession is best done with manual review.`,
    '',
    `**Review:** ${reviewUrl(keys)}`,
    '',
    `Select the ${unit} there and use the bulk operations menu. To ${operation} a single item, wait a moment and try again.`,
  ].join('\n');
}

// ── Queue integration ───────────────────────────────────────────

export interface DestructiveStep {
  operation: string;
  key: string;
}

/**
 * A guard object for the queue component. `classify` says whether a step is
 * destructive and what key it touches. The whole queue is refused before any
 * step runs when its destructive count exceeds the window's remaining room.
 */
export function queueGuard<TStep extends { tool: string; args: Record<string, unknown> }>(
  guard: SlidingWindowGuard,
  classify: (step: TStep) => DestructiveStep | null,
): { prescan(steps: TStep[]): string | null; record(step: TStep): void } {
  return {
    prescan(steps) {
      const destructive = steps.map(classify).filter((d): d is DestructiveStep => d !== null);
      if (destructive.length === 0) return null;
      const remaining = guard.remaining();
      if (destructive.length <= remaining) return null;
      const refusal = guard.refusal(destructive[0].operation, destructive.map(d => d.key));
      return `**Queue refused**: ${destructive.length} destructive operation(s) queued, ${remaining} allowed in the current window.\n\n${refusal}`;
    },
    record(step) {
      const d = classify(step);
      if (d) guard.record(d.operation, d.key);
    },
  };
}

// ── Policy chain ────────────────────────────────────────────────

export type PolicyAction = 'allow' | 'block' | 'downgrade';

export interface PolicyResult<TArgs = Record<string, unknown>> {
  action: PolicyAction;
  reason?: string;
  /** For `downgrade`: the arguments to run instead. */
  replacement?: TArgs;
}

export interface Policy<TContext, TArgs = Record<string, unknown>> {
  name: string;
  evaluate(context: TContext): PolicyResult<TArgs> | Promise<PolicyResult<TArgs>>;
}

/**
 * Run policies in order. The first block wins. A downgrade is remembered and
 * returned if nothing later blocks. Everything else is allow.
 */
export async function evaluatePolicies<TContext, TArgs = Record<string, unknown>>(
  policies: Array<Policy<TContext, TArgs>>,
  context: TContext,
): Promise<PolicyResult<TArgs> & { policy?: string }> {
  let downgrade: (PolicyResult<TArgs> & { policy?: string }) | null = null;
  for (const policy of policies) {
    const result = await policy.evaluate(context);
    if (result.action === 'block') return { ...result, policy: policy.name };
    if (result.action === 'downgrade' && !downgrade) downgrade = { ...result, policy: policy.name };
  }
  return downgrade ?? { action: 'allow' };
}
