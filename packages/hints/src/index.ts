/**
 * Next-step hints. A server declares, per context, the two or three calls an
 * agent most often makes next. Each result ends with those calls rendered as
 * runnable examples, with ids from the current result filled in.
 */

import { renderNextSteps, type NextStepHint } from '@aaronsb/mcp-component-core';

export type { NextStepHint };

/** Hints keyed by context, e.g. `issue.get` or `page_comments`. */
export type HintCatalog = Record<string, NextStepHint[]>;

export interface HintsOptions {
  /** Placeholder styles to resolve. Default both `$name` and `<name>`. */
  placeholders?: Array<'dollar' | 'angle'>;
}

export interface Hints {
  /** Render the block for a context, or an empty string when it has none. */
  (context: string, params?: Record<string, unknown>): string;
  /** The resolved hints, for callers that render differently. */
  resolve(context: string, params?: Record<string, unknown>): NextStepHint[];
  has(context: string): boolean;
  contexts(): string[];
}

export function createHints(catalog: HintCatalog, options: HintsOptions = {}): Hints {
  const styles = options.placeholders ?? ['dollar', 'angle'];

  const resolve = (context: string, params: Record<string, unknown> = {}): NextStepHint[] =>
    (catalog[context] ?? []).map(hint => ({ ...hint, example: resolveValue(hint.example, params, styles) as Record<string, unknown> }));

  const hints = ((context: string, params?: Record<string, unknown>) => renderNextSteps(resolve(context, params))) as Hints;
  hints.resolve = resolve;
  hints.has = context => (catalog[context]?.length ?? 0) > 0;
  hints.contexts = () => Object.keys(catalog);
  return hints;
}

/** Combine catalogs; later entries replace earlier ones for the same context. */
export function mergeCatalogs(...catalogs: HintCatalog[]): HintCatalog {
  return Object.assign({}, ...catalogs);
}

/**
 * Fill placeholders inside an example. `$name` is replaced when it is the
 * whole string; `<name>` is replaced wherever it appears. Unresolved
 * placeholders stay as written, so the agent sees what it must supply.
 */
function resolveValue(value: unknown, params: Record<string, unknown>, styles: Array<'dollar' | 'angle'>): unknown {
  if (typeof value === 'string') {
    if (styles.includes('dollar') && /^\$[A-Za-z_][\w]*$/.test(value)) {
      const found = params[value.slice(1)];
      return found === undefined ? value : found;
    }
    if (styles.includes('angle')) {
      return value.replace(/<([A-Za-z_][\w]*)>/g, (m, name: string) => {
        const found = params[name];
        return found === undefined || found === null ? m : String(found);
      });
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(v => resolveValue(v, params, styles));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, params, styles)]));
  }
  return value;
}
