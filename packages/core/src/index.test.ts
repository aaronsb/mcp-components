import { describe, it, expect } from 'vitest';
import { fromMcp, toMcp, stripNextSteps, extractNextSteps, renderNextSteps, firstLine } from './index.js';

describe('next-steps block', () => {
  const body = '## PROJ-1\nStatus: Open';
  const hints = [{ description: 'Comment', tool: 'manage_issue', example: { operation: 'comment', issueKey: 'PROJ-1' } }];

  it('renders a block that strip and extract recognise', () => {
    const block = renderNextSteps(hints);
    const text = body + block;
    expect(stripNextSteps(text)).toBe(body);
    expect(extractNextSteps(text)).toBe(block);
    expect(block).toContain('`manage_issue` — `{"operation":"comment","issueKey":"PROJ-1"}`');
  });

  it('accepts the two-newline spelling older servers used', () => {
    const text = body + '\n\n---\n**Next steps:**\n- x';
    expect(stripNextSteps(text)).toBe(body);
    expect(extractNextSteps(text).startsWith('\n\n---')).toBe(true);
  });

  it('leaves text without a block alone', () => {
    expect(stripNextSteps(body)).toBe(body);
    expect(extractNextSteps(body)).toBe('');
    expect(renderNextSteps([])).toBe('');
  });
});

describe('firstLine', () => {
  it('skips blanks and rules, drops the heading prefix, and truncates', () => {
    expect(firstLine('\n---\n## Created PROJ-9\nmore')).toBe('Created PROJ-9');
    expect(firstLine('x'.repeat(100), 10)).toBe('x'.repeat(9) + '…');
  });
  it('ignores the next-steps block', () => {
    expect(firstLine('\n---\n**Next steps:**\n- a')).toBe('');
  });
});

describe('mcp conversion', () => {
  it('joins text blocks and carries the error flag', () => {
    const r = fromMcp({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }], isError: true });
    expect(r).toEqual({ text: 'a\nb', refs: undefined, isError: true });
  });
  it('marks blocked results as errors on the way out', () => {
    expect(toMcp({ text: 'no', blocked: true })).toEqual({ content: [{ type: 'text', text: 'no' }], isError: true });
    expect(toMcp({ text: 'ok' })).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });
});
