import { describe, it, expect } from 'vitest';
import { SlidingWindowGuard, queueGuard, reviewDeflection, evaluatePolicies, type Policy } from './index.js';

describe('SlidingWindowGuard', () => {
  it('allows up to the limit inside the window, then deflects with every key', () => {
    let t = 0;
    const g = new SlidingWindowGuard({ limit: 2, windowMs: 100, now: () => t });
    expect(g.check('delete', 'A-1')).toBeNull();
    g.record('delete', 'A-1');
    g.record('delete', 'A-2');
    const refusal = g.check('delete', 'A-3')!;
    expect(refusal).toContain('Items: A-1, A-2, A-3');
    expect(g.remaining()).toBe(0);
    t = 101;
    expect(g.check('delete', 'A-3')).toBeNull();
    expect(g.remaining()).toBe(2);
  });

  it('falls back to the default limit on bad input and can link to a review page', () => {
    expect(new SlidingWindowGuard({ limit: 0 }).getLimit()).toBe(3);
    const g = new SlidingWindowGuard({ limit: 1, deflect: reviewDeflection(keys => `https://x/issues/?jql=key in (${keys.join(',')})`, 'issues') });
    g.record('move', 'K-1');
    expect(g.check('move', 'K-2')).toContain('**Review:** https://x/issues/?jql=key in (K-1,K-2)');
  });
});

describe('queueGuard', () => {
  type Step = { tool: string; args: Record<string, unknown> };
  const classify = (s: Step) => (s.tool === 'issue' && s.args.operation === 'delete' ? { operation: 'delete', key: String(s.args.key) } : null);

  it('refuses a queue whose destructive count exceeds the room left, before anything runs', () => {
    const guard = new SlidingWindowGuard({ limit: 2 });
    const qg = queueGuard(guard, classify);
    const del = (key: string): Step => ({ tool: 'issue', args: { operation: 'delete', key } });
    expect(qg.prescan([del('1'), { tool: 'issue', args: { operation: 'get' } }])).toBeNull();
    expect(qg.prescan([del('1'), del('2'), del('3')])).toContain('**Queue refused**: 3 destructive operation(s) queued, 2 allowed');
    qg.record(del('1'));
    qg.record({ tool: 'issue', args: { operation: 'get' } });
    expect(guard.remaining()).toBe(1);
    expect(qg.prescan([del('2'), del('3')])).toContain('Items: 1, 2, 3');
  });
});

describe('evaluatePolicies', () => {
  type Ctx = { operation: string };
  const noDelete: Policy<Ctx> = { name: 'no-delete', evaluate: c => ({ action: c.operation === 'delete' ? 'block' : 'allow', reason: 'deletes are off' }) };
  const draftOnly: Policy<Ctx> = { name: 'draft-only', evaluate: async c => (c.operation === 'send' ? { action: 'downgrade', replacement: { operation: 'draft' } } : { action: 'allow' }) };

  it('returns the first block, else a remembered downgrade, else allow', async () => {
    expect(await evaluatePolicies([draftOnly, noDelete], { operation: 'delete' })).toMatchObject({ action: 'block', policy: 'no-delete', reason: 'deletes are off' });
    expect(await evaluatePolicies([draftOnly, noDelete], { operation: 'send' })).toMatchObject({ action: 'downgrade', policy: 'draft-only', replacement: { operation: 'draft' } });
    expect(await evaluatePolicies([draftOnly, noDelete], { operation: 'read' })).toEqual({ action: 'allow' });
  });
});
