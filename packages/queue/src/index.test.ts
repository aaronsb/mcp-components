import { describe, it, expect, vi } from 'vitest';
import { runQueue, nestedQueueHandler, queueInputSchema, QueueValidationError, type QueueOptions, type StepHandler } from './index.js';

const NS = '\n---\n**Next steps:**\n- next';

function handlers(overrides: Record<string, StepHandler> = {}): Record<string, StepHandler> {
  return {
    create: vi.fn(async (args) => ({ text: `## Created ${args.name}${NS}`, refs: { id: `id-${args.name}` } })),
    update: vi.fn(async (args) => ({ text: `Updated ${args.id}${NS}` })),
    fail: vi.fn(async () => ({ text: 'boom', isError: true })),
    throws: vi.fn(async () => { throw new Error('exploded'); }),
    blocked: vi.fn(async () => ({ text: 'policy declined', blocked: true })),
    ...overrides,
  };
}

describe('runQueue', () => {
  it('runs steps in order and threads $N.field references', async () => {
    const h = handlers();
    const report = await runQueue({ operations: [
      { tool: 'create', args: { name: 'a' } },
      { tool: 'update', args: { id: '$0.id', note: 'ref in $0.id text' } },
    ] }, { handlers: h });

    expect(report.succeeded).toBe(2);
    expect(h.update).toHaveBeenCalledWith({ id: 'id-a', note: 'ref in id-a text' }, { index: 1, depth: 1 });
    expect(report.text).toContain('Executed 2 of 2 operations. Success: 2, Errors: 0');
    expect(report.text).toContain('[1] create ok: Created a');
  });

  it('bail stops at the failure and marks the rest skipped', async () => {
    const h = handlers();
    const report = await runQueue({ operations: [
      { tool: 'create', args: { name: 'a' } },
      { tool: 'fail', args: {} },
      { tool: 'create', args: { name: 'b' } },
    ] }, { handlers: h });

    expect(report.bailedAt).toBe(1);
    expect(report.results.map(r => r.status)).toEqual(['success', 'error', 'skipped']);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(report.text).toContain('Executed 2 of 3 operations. Success: 1, Errors: 1, Skipped: 1');
    expect(report.text).toContain('Stopped at operation 2 due to error.');
    expect(report.isError).toBeFalsy();
  });

  it('continue records the failure and runs the rest', async () => {
    const h = handlers();
    const report = await runQueue({ operations: [
      { tool: 'throws', args: {}, onError: 'continue' },
      { tool: 'create', args: { name: 'b' } },
    ] }, { handlers: h });

    expect(report.bailedAt).toBe(-1);
    expect(report.results.map(r => r.status)).toEqual(['error', 'success']);
    expect(report.results[0].text).toBe('exploded');
    expect(report.text).toContain('[1] throws ERR: exploded');
  });

  it('a blocked result counts as a failure and honours bail', async () => {
    const h = handlers();
    const report = await runQueue({ operations: [
      { tool: 'blocked', args: {} },
      { tool: 'create', args: { name: 'b' } },
    ] }, { handlers: h });

    expect(report.succeeded).toBe(0);
    expect(report.results[0]).toMatchObject({ status: 'error', text: 'policy declined' });
    expect(report.results[1].status).toBe('skipped');
    expect(report.isError).toBe(true);
  });

  it('an unresolvable reference fails that step with the fields it does have', async () => {
    const report = await runQueue({ operations: [
      { tool: 'create', args: { name: 'a' } },
      { tool: 'update', args: { id: '$0.key' }, onError: 'continue' },
      { tool: 'update', args: { id: '$5.id' }, onError: 'continue' },
      { tool: 'update', args: { id: '$1.id' } },
    ] }, { handlers: handlers() });

    expect(report.results[1].text).toBe("$0.key: operation 0 exposes no 'key' (has: id).");
    expect(report.results[2].text).toBe('$5.id: operation 5 has not run yet.');
    expect(report.results[3].text).toBe('$1.id: operation 1 error.');
  });

  it('falls back to extractRefs when a handler returns no refs', async () => {
    const h = handlers();
    const extractRefs = vi.fn((text: string) => ({ id: text.match(/Updated (\S+)/)?.[1] }));
    const report = await runQueue({ operations: [
      { tool: 'update', args: { id: 'x' } },
      { tool: 'update', args: { id: '$0.id-again' } },
    ] }, { handlers: h, extractRefs });

    expect(extractRefs).toHaveBeenCalledWith('Updated x' + NS, { id: 'x' }, 'update');
    expect(h.update).toHaveBeenLastCalledWith({ id: 'x-again' }, expect.anything());
    expect(report.succeeded).toBe(2);
  });

  it('strips per-step next-steps and appends only the last success’s block', async () => {
    const report = await runQueue({ operations: [
      { tool: 'create', args: { name: 'a' } },
      { tool: 'update', args: { id: '1' } },
      { tool: 'fail', args: {}, onError: 'continue' },
    ], detail: 'full' }, { handlers: handlers() });

    expect(report.results[0].text).toBe('## Created a');
    expect(report.text.match(/\*\*Next steps:\*\*/g)).toHaveLength(1);
    expect(report.text.endsWith(NS)).toBe(true);
    expect(report.text).toContain('**[2] update ok**\nUpdated 1');
  });

  it('summary detail gives one line per step and points at full', async () => {
    const report = await runQueue({ operations: [{ tool: 'create', args: { name: 'a' } }] }, { handlers: handlers() });
    expect(report.text).toContain('  [1] create ok: Created a');
    expect(report.text).toContain('_Use `detail: "full"`');
  });

  it('validates before running anything', async () => {
    const h = handlers();
    await expect(runQueue({ operations: [] }, { handlers: h })).rejects.toThrow(QueueValidationError);
    await expect(runQueue({ operations: [{ tool: 'nope', args: {} }] }, { handlers: h })).rejects.toThrow(/unknown tool 'nope'. Valid: create/);
    await expect(runQueue({ operations: [{ tool: 'create', args: [] as unknown as Record<string, unknown> }] }, { handlers: h })).rejects.toThrow(/missing 'args'/);
    const many = Array.from({ length: 3 }, () => ({ tool: 'create', args: { name: 'x' } }));
    await expect(runQueue({ operations: many }, { handlers: h, maxOperations: 2 })).rejects.toThrow(/Maximum 2 operations/);
    expect(h.create).not.toHaveBeenCalled();
  });

  it('the guard can refuse the whole queue before any step runs, and records successes', async () => {
    const h = handlers();
    const guard = { prescan: vi.fn(() => 'too many deletes'), record: vi.fn() };
    const refused = await runQueue({ operations: [{ tool: 'create', args: { name: 'a' } }] }, { handlers: h, guard });
    expect(refused).toMatchObject({ text: 'too many deletes', blocked: true, isError: true, skipped: 1 });
    expect(h.create).not.toHaveBeenCalled();

    guard.prescan.mockReturnValue(null);
    await runQueue({ operations: [{ tool: 'create', args: { name: 'a' } }, { tool: 'fail', args: {} }] }, { handlers: h, guard });
    expect(guard.record).toHaveBeenCalledTimes(1);
    expect(guard.record).toHaveBeenCalledWith({ tool: 'create', args: { name: 'a' } }, { name: 'a' }, expect.objectContaining({ refs: { id: 'id-a' } }));
  });

  it('nests up to maxDepth, and an inner continue does not bail the outer queue', async () => {
    const options: QueueOptions = { handlers: handlers(), maxDepth: 2 };
    options.handlers.queue = nestedQueueHandler(options);
    const onStep = vi.fn();
    options.onStep = onStep;

    const report = await runQueue({ operations: [
      { tool: 'queue', args: { operations: [
        { tool: 'fail', args: {}, onError: 'continue' },
        { tool: 'create', args: { name: 'inner' } },
      ] } },
      { tool: 'create', args: { name: 'outer' } },
    ] }, options);

    expect(report.results.map(r => r.status)).toEqual(['success', 'success']);
    expect(onStep).toHaveBeenCalledWith(expect.anything(), { index: 0, depth: 2 });

    const tooDeep = await runQueue({ operations: [
      { tool: 'queue', args: { operations: [{ tool: 'queue', args: { operations: [{ tool: 'create', args: { name: 'x' } }] } }] } },
    ] }, options);
    expect(tooDeep.results[0].status).toBe('error');
    expect(tooDeep.results[0].text).toMatch(/nested more than 2 deep/);
  });
});

describe('queueInputSchema', () => {
  it('enumerates the dispatchable tools and carries the cap', () => {
    const schema = queueInputSchema(['a', 'b'], 4) as { properties: { operations: { maxItems: number; items: { properties: { tool: { enum: string[] } } } } }; required: string[] };
    expect(schema.properties.operations.items.properties.tool.enum).toEqual(['a', 'b']);
    expect(schema.properties.operations.maxItems).toBe(4);
    expect(schema.required).toEqual(['operations']);
  });
});
