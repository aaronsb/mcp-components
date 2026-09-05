import { describe, it, expect, vi } from 'vitest';
import { TextpadManager } from './manager.js';
import { createTextpadHandler, textpadInputSchema } from './handler.js';

function setup() {
  const manager = new TextpadManager<{ type: string; pageId?: string }>();
  const page = vi.fn(async (m: TextpadManager<{ type: string; pageId?: string }>, id: string, p: Record<string, unknown>) => ({
    text: `published ${m.getContent(id)} to ${p.pageId}`,
    refs: { pageId: p.pageId },
  }));
  const failing = vi.fn(async () => ({ text: 'Send failed: 409', isError: true }));
  const doc = vi.fn(async (m: TextpadManager, id: string) => { m.setLines(id, ['imported'], 'markdown'); return { text: 'ok' }; });
  const handler = createTextpadHandler({
    manager,
    send: { page, email: failing },
    import: { doc },
    resolveAttachment: async p => {
      if (p.filename !== 'ok.png') throw new Error('no such file');
      return { source: 'workspace', filename: 'ok.png', mimeType: 'image/png', size: 10, location: '/ws/ok.png' };
    },
  });
  return { manager, handler, page, failing, doc };
}

describe('textpad handler', () => {
  it('creates, edits, views, and chains through refs', async () => {
    const { handler } = setup();
    const created = await handler({ operation: 'create', content: 'a\nb', format: 'markdown' });
    const id = created.refs!.textpadId as string;
    expect(created.text).toBe(`Textpad created: ${id} (2 lines)\nFormat: markdown`);
    const ins = await handler({ operation: 'insert_lines', textpadId: id, afterLine: 1, content: 'mid' });
    expect(ins.refs).toEqual({ textpadId: id, lineCount: 3 });
    expect(ins.text).toContain('Inserted 1 line(s) after line 1');
    const view = await handler({ operation: 'view', textpadId: id });
    expect(view.text).toContain('2 | mid');
    const bad = await handler({ operation: 'remove_lines', textpadId: id, startLine: 9 });
    expect(bad.isError).toBe(true);
  });

  it('rejects missing ids and parameters with a usable message', async () => {
    const { handler } = setup();
    expect((await handler({ operation: 'view' })).text).toContain('textpadId is required');
    expect((await handler({ operation: 'view', textpadId: 'sp-gone' })).text).toContain('not found or expired');
    const id = (await handler({ operation: 'create' })).refs!.textpadId as string;
    expect((await handler({ operation: 'insert_lines', textpadId: id, content: 'x' })).text).toBe('afterLine is required for insert_lines.');
    expect((await handler({ operation: 'nope' })).text).toBe('Unknown operation: nope.');
  });

  it('sends to a named target, keeps the buffer on failure, and discards on keep:false', async () => {
    const { handler, manager, page } = setup();
    const id = (await handler({ operation: 'create', content: 'hello' })).refs!.textpadId as string;
    const failed = await handler({ operation: 'send', textpadId: id, target: 'email', keep: false });
    expect(failed.isError).toBe(true);
    expect(manager.get(id)).not.toBeNull();
    const sent = await handler({ operation: 'send', textpadId: id, target: 'page', targetParams: { pageId: '7' }, keep: false });
    expect(page).toHaveBeenCalledWith(manager, id, { pageId: '7' });
    expect(sent.text).toBe('published hello to 7\nTextpad ' + id + ' discarded.');
    expect(manager.get(id)).toBeNull();
    const unknown = await handler({ operation: 'send', textpadId: (await handler({ operation: 'create' })).refs!.textpadId, target: 'fax' });
    expect(unknown.text).toBe('Unknown send target: fax. Valid targets: page, email.');
  });

  it('sends to the stored target when none is named, merging its fields into the params', async () => {
    const { handler, page } = setup();
    const id = (await handler({ operation: 'create', content: 'body', target: { type: 'page', pageId: '42' } })).refs!.textpadId as string;
    const sent = await handler({ operation: 'send', textpadId: id });
    expect(sent.text).toBe('published body to 42');
    expect(page.mock.calls[0][2]).toEqual({ type: 'page', pageId: '42' });
  });

  it('lets beforeSend refuse and afterMutation replace the response', async () => {
    const manager = new TextpadManager();
    const handler = createTextpadHandler({
      manager,
      send: { page: async () => ({ text: 'never' }) },
      beforeSend: async target => (target === 'page' ? { text: 'Blocked by policy', blocked: true, isError: true } : null),
      afterMutation: async (id, op) => (op === 'append_lines' ? { text: `synced ${id}`, refs: { synced: true } } : null),
    });
    const id = (await handler({ operation: 'create' })).refs!.textpadId as string;
    expect(await handler({ operation: 'send', textpadId: id, target: 'page' })).toMatchObject({ blocked: true });
    expect((await handler({ operation: 'append_lines', textpadId: id, content: 'x' })).text).toBe(`synced ${id}`);
    expect((await handler({ operation: 'insert_lines', textpadId: id, afterLine: 0, content: 'y' })).text).toContain('Inserted');
  });

  it('imports through an adapter and attaches through the resolver', async () => {
    const { handler, doc } = setup();
    const id = (await handler({ operation: 'create' })).refs!.textpadId as string;
    await handler({ operation: 'import', textpadId: id, source: 'doc', sourceParams: { docId: 'd1' } });
    expect(doc).toHaveBeenCalled();
    expect((await handler({ operation: 'view', textpadId: id })).text).toContain('1 | imported');
    expect((await handler({ operation: 'import', textpadId: id, source: 'x' })).text).toBe('Unknown import source: x. Valid sources: doc.');
    const att = await handler({ operation: 'attach', textpadId: id, filename: 'ok.png' });
    expect(att.refs).toEqual({ textpadId: id, refId: 'att-1' });
    expect((await handler({ operation: 'attach', textpadId: id, filename: 'no.png' })).text).toBe('Cannot attach: no such file');
    expect((await handler({ operation: 'detach', textpadId: id, refId: 'att-1' })).text).toContain('Detached ok.png');
  });

  it('lists live buffers', async () => {
    const { handler } = setup();
    expect((await handler({ operation: 'list' })).text).toBe('No active textpads.');
    const id = (await handler({ operation: 'create', label: 'draft', content: 'x' })).refs!.textpadId as string;
    const list = await handler({ operation: 'list' });
    expect(list.text).toContain(`- ${id} "draft" | text | 1 lines | Status: valid (1 lines)`);
  });
});

describe('textpadInputSchema', () => {
  it('narrows operations and formats to what the server wires', () => {
    const s = textpadInputSchema({ operations: ['create', 'view', 'send'], formats: ['markdown'], sendTargets: ['page'] }) as { properties: Record<string, { enum?: string[]; description?: string }> };
    expect(s.properties.operation.enum).toEqual(['create', 'view', 'send']);
    expect(s.properties.format.enum).toEqual(['markdown']);
    expect(s.properties.target.description).toContain('(page)');
  });
});
