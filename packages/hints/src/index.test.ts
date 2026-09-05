import { describe, it, expect } from 'vitest';
import { createHints, mergeCatalogs } from './index.js';

const catalog = {
  'issue.get': [
    { description: 'Comment', tool: 'manage_issue', example: { operation: 'comment', issueKey: '$issueKey', body: '<text>' } },
    { description: 'Add to sprint', tool: 'manage_sprint', example: { operation: 'manage_issues', sprintId: '$sprintId', add: ['$issueKey'] } },
  ],
  'email.read': [
    { description: 'Reply', tool: 'manage_email', example: { operation: 'reply', email: '<email>', query: 'thread:<threadId>' } },
  ],
};

describe('hints', () => {
  it('renders a block with ids filled in from the result', () => {
    const hints = createHints(catalog);
    const block = hints('issue.get', { issueKey: 'PROJ-1', sprintId: 7 });
    expect(block).toContain('**Next steps:**');
    expect(block).toContain('`manage_issue` — `{"operation":"comment","issueKey":"PROJ-1","body":"<text>"}`');
    expect(block).toContain('"sprintId":7,"add":["PROJ-1"]');
  });

  it('leaves unresolved placeholders visible, in both styles', () => {
    const hints = createHints(catalog);
    expect(hints.resolve('issue.get')[0].example.issueKey).toBe('$issueKey');
    expect(hints.resolve('email.read', { email: 'a@b.c' })[0].example).toEqual({ operation: 'reply', email: 'a@b.c', query: 'thread:<threadId>' });
  });

  it('returns nothing for an unknown context and reports what it has', () => {
    const hints = createHints(catalog);
    expect(hints('nope')).toBe('');
    expect(hints.has('nope')).toBe(false);
    expect(hints.contexts()).toEqual(['issue.get', 'email.read']);
  });

  it('merges catalogs with later contexts winning', () => {
    const merged = mergeCatalogs(catalog, { 'issue.get': [{ description: 'Only', tool: 't', example: {} }] });
    expect(createHints(merged).resolve('issue.get')).toHaveLength(1);
  });
});
