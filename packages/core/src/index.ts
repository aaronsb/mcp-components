/**
 * Shared shapes for agent-facing tool results.
 *
 * Every component in this repo speaks in `StepResult`: the text an agent reads,
 * structured `refs` a later step can address by name, and flags for the two
 * ways a step can fail to do its work.
 */

/** A non-text content block, such as an image, returned beside the text. */
export interface ContentBlock {
  type: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

/** What one tool invocation hands back. */
export interface StepResult {
  /** Markdown for the agent. May end with a next-steps block. */
  text: string;
  /** Extra content blocks, such as an inline image. */
  blocks?: ContentBlock[];
  /** Structured values a later step can reference by field name, e.g. `{ id: '123' }`. */
  refs?: Record<string, unknown>;
  /** The step ran and reported failure. */
  isError?: boolean;
  /**
   * A policy declined the step and returned instead of throwing. Callers that
   * count successes must treat this as a failure.
   */
  blocked?: boolean;
}

/** The MCP content shape most servers return; `fromMcp` converts it. */
export interface McpToolResponse {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

/** Collapse an MCP response to a `StepResult`, joining its text blocks. */
export function fromMcp(response: McpToolResponse, refs?: Record<string, unknown>): StepResult {
  const text = response.content
    .filter(c => c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text as string)
    .join('\n');
  const blocks = response.content.filter(c => c.type !== 'text') as ContentBlock[];
  return { text, refs, isError: response.isError === true, ...(blocks.length ? { blocks } : {}) };
}

/** Wrap a `StepResult` back into MCP content. */
export function toMcp(result: StepResult): McpToolResponse {
  return {
    content: [{ type: 'text', text: result.text }, ...(result.blocks ?? [])],
    ...(result.isError || result.blocked ? { isError: true } : {}),
  };
}

// ── Next-steps block ──────────────────────────────────────────────

/**
 * The marker that opens a next-steps block. Servers have written it with one
 * or two leading newlines, so matching is tolerant of both.
 */
export const NEXT_STEPS_HEADING = '**Next steps:**';
const NEXT_STEPS_RE = /\n+---\n\*\*Next steps:\*\*/;

/** Return the text with any trailing next-steps block removed. */
export function stripNextSteps(text: string): string {
  const m = NEXT_STEPS_RE.exec(text);
  return m ? text.slice(0, m.index) : text;
}

/** Return the next-steps block, including its separator, or an empty string. */
export function extractNextSteps(text: string): string {
  const m = NEXT_STEPS_RE.exec(text);
  return m ? text.slice(m.index) : '';
}

/**
 * Render a next-steps block from hints. Each hint is a description, a tool
 * name, and an example argument object.
 */
export interface NextStepHint {
  description: string;
  tool: string;
  example: Record<string, unknown>;
}

export function renderNextSteps(hints: NextStepHint[]): string {
  if (hints.length === 0) return '';
  const lines = hints.map(h => `- ${h.description}: \`${h.tool}\` — \`${JSON.stringify(h.example)}\``);
  return `\n---\n${NEXT_STEPS_HEADING}\n${lines.join('\n')}`;
}

// ── Compact summaries ─────────────────────────────────────────────

/**
 * The first content line of a result, for one-line-per-step reports. Skips
 * blank lines and horizontal rules, drops a heading prefix, and truncates.
 */
export function firstLine(text: string, max = 80): string {
  const body = stripNextSteps(text);
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line === '---') continue;
    const clean = line.replace(/^#+\s*/, '');
    return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
  }
  return body.slice(0, max);
}
