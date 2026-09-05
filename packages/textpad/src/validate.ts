/**
 * Format validators. Each returns a one-line status the agent reads after
 * every mutation, so a broken fence or an unbalanced brace is reported at
 * the edit that caused it, with a line number.
 */

export type Validator = (lines: string[]) => string;

export function validateText(lines: string[]): string {
  return `Status: valid (${lines.length} lines)`;
}

export function validateMarkdown(lines: string[]): string {
  const open = unclosedFence(lines);
  return open === -1 ? `Status: valid (${lines.length} lines)` : `Status: invalid at line ${open} — unclosed code fence`;
}

/** 1-based line of an unclosed ``` fence, or -1. */
export function unclosedFence(lines: string[]): number {
  let open = -1;
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('```')) open = open === -1 ? i + 1 : -1;
  });
  return open;
}

export function validateJson(lines: string[]): string {
  const text = lines.join('\n');
  try {
    JSON.parse(text);
    return `Status: valid (${lines.length} lines)`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const pos = /position (\d+)/.exec(msg);
    if (pos) {
      const at = parseInt(pos[1], 10);
      let line = 1;
      let col = 1;
      for (let i = 0; i < at && i < text.length; i++) {
        if (text[i] === '\n') { line++; col = 1; } else { col++; }
      }
      return `Status: invalid at line ${line}:${col} — ${msg.replace(/^.*?position \d+/, '').trim() || 'JSON syntax error'}`;
    }
    return `Status: invalid — ${msg}`;
  }
}

export function validateCsv(lines: string[]): string {
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return `Status: valid (${lines.length} lines)`;
  const expected = countCsvColumns(nonEmpty[0]);
  for (let i = 1; i < nonEmpty.length; i++) {
    const cols = countCsvColumns(nonEmpty[i]);
    if (cols !== expected) {
      return `Status: invalid at line ${lines.indexOf(nonEmpty[i]) + 1} — expected ${expected} columns, got ${cols}`;
    }
  }
  return `Status: valid (${lines.length} lines, ${expected} columns)`;
}

function countCsvColumns(line: string): number {
  let cols = 1;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) cols++;
  }
  return cols;
}

export const builtinValidators: Record<string, Validator> = {
  text: validateText,
  markdown: validateMarkdown,
  json: validateJson,
  csv: validateCsv,
};

/** Run the validator for a format, falling back to plain text. */
export function validate(lines: string[], format: string, validators: Record<string, Validator> = builtinValidators): string {
  if (lines.length === 0) return 'Status: empty';
  return (validators[format] ?? validateText)(lines);
}
