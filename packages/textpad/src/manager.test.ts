import { describe, it, expect } from 'vitest';
import { TextpadManager } from './manager.js';

const lines = (m: TextpadManager, ...ls: string[]) => m.create({ lines: ls });

describe('TextpadManager lines', () => {
  it('creates from content or lines, copying inputs', () => {
    const m = new TextpadManager();
    const src = ['a'];
    const table = new Map<string, unknown>([['k', { v: 1 }]]);
    const id = m.create({ lines: src, sideTable: table, format: 'markdown', label: 'x' });
    src.push('b');
    table.set('k2', 2);
    expect(m.getContent(id)).toBe('a');
    expect(m.getSideTable(id)?.has('k2')).toBe(false);
    expect(m.getContent(m.create({ content: 'one\r\ntwo\rthree' }))).toBe('one\ntwo\nthree');
    expect(m.get(id)?.format).toBe('markdown');
  });

  it('views with numbers, a window, and a status line', () => {
    const m = new TextpadManager();
    const id = lines(m, 'a', 'b', 'c', 'd', 'e');
    const full = m.view(id)!;
    expect(full).toContain('Textpad: ' + id);
    expect(full).toContain('1 | a');
    expect(full).toContain('Status: valid (5 lines)');
    const win = m.view(id, 2, 4)!;
    expect(win).toContain('2 | b');
    expect(win).not.toContain('1 | a');
    expect(win).not.toContain('5 | e');
    expect(m.view(m.create())).toContain('(empty buffer)');
    expect(m.view('sp-nope')).toBeNull();
  });

  it('inserts, appends, replaces, removes with context and 1-based ranges', () => {
    const m = new TextpadManager();
    const id = lines(m, 'first', 'third');
    const ins = m.insertLines(id, 1, 'second')!;
    expect(ins.message).toBe('Inserted 1 line(s) after line 1. Buffer: 3 lines.');
    expect(ins.context).toBe('1 | first\n2 | second\n3 | third');
    m.insertLines(id, 0, 'zero');
    expect(m.getContent(id)).toBe('zero\nfirst\nsecond\nthird');
    m.appendLines(id, 'x\ny');
    expect(m.getContent(id)).toBe('zero\nfirst\nsecond\nthird\nx\ny');
    const rep = m.replaceLines(id, 2, 4, 'mid')!;
    expect(rep.message).toContain('Replaced lines 2-4');
    expect(m.getContent(id)).toBe('zero\nmid\nx\ny');
    const rm = m.removeLines(id, 1)!;
    expect(rm.message).toContain('Removed 1 line(s)');
    expect(rm.context).toBe('1 | mid');
    expect(m.getContent(id)).toBe('mid\nx\ny');
    m.removeLines(id, 1, 3);
    expect(m.getContent(id)).toBe('');
    expect(m.removeLines(id, 1)!.context).toBe('');
  });

  it('refuses out-of-range edits without changing the buffer', () => {
    const m = new TextpadManager();
    const id = lines(m, 'a', 'b');
    expect(m.insertLines(id, 3, 'x')).toMatchObject({ error: true, message: 'Error: afterLine 3 out of range (0-2).' });
    expect(m.replaceLines(id, 2, 1, 'x')).toMatchObject({ error: true, message: 'Error: endLine 1 out of range (2-2).' });
    expect(m.removeLines(id, 0)).toMatchObject({ error: true });
    expect(m.getContent(id)).toBe('a\nb');
  });

  it('elides the middle of a long context', () => {
    const m = new TextpadManager();
    const id = lines(m, 'top');
    const r = m.appendLines(id, 'a\nb\nc\nd')!;
    expect(r.context).toBe('1 | top\n2 | a\n  | ...\n5 | d');
  });

  it('copies lines between buffers without touching the source', () => {
    const m = new TextpadManager();
    const a = lines(m, 'a1', 'a2', 'a3');
    const b = lines(m, 'b1');
    const r = m.copyLines(b, a, 2, 3, 1)!;
    expect(r.message).toContain('Copied 2 line(s)');
    expect(m.getContent(b)).toBe('b1\na2\na3');
    expect(m.getContent(a)).toBe('a1\na2\na3');
    expect(m.copyLines(b, 'sp-none', 1, 1, 0)).toMatchObject({ error: true });
  });
});

describe('TextpadManager validation', () => {
  it('reports the line of an unclosed fence, JSON position, and CSV column drift', () => {
    const m = new TextpadManager();
    const md = m.create({ format: 'markdown', content: '# T\n```js\nx' });
    expect(m.view(md)).toContain('Status: invalid at line 2 — unclosed code fence');
    const js = m.create({ format: 'json', content: '{\n  "a": 1,\n}' });
    expect(m.view(js)).toMatch(/Status: invalid at line 3:1/);
    const csv = m.create({ format: 'csv', content: 'a,b\n1,2\n3' });
    expect(m.view(csv)).toContain('Status: invalid at line 3 — expected 2 columns, got 1');
    const q = m.create({ format: 'csv', content: 'a,b\n"x,y",2' });
    expect(m.view(q)).toContain('Status: valid (2 lines, 2 columns)');
  });

  it('accepts server validators for new or overridden formats', () => {
    const m = new TextpadManager({ validators: { adf: ls => (ls.some(l => l === ':::') ? 'Status: valid' : 'Status: invalid at line 1 — no close') } });
    const id = m.create({ format: 'adf', content: ':::panel\nhi' });
    expect(m.view(id)).toContain('no close');
    m.appendLines(id, ':::');
    expect(m.view(id)).toContain('Status: valid');
  });
});

describe('TextpadManager json', () => {
  it('reads, sets, inserts, and deletes by path, re-serialising the buffer', () => {
    const m = new TextpadManager();
    const id = m.create({ format: 'json', content: '{"a":{"b":[1,2]},"c":"x"}' });
    expect(m.jsonGet(id, '$.a.b[1]')).toEqual({ value: 2, lineSpan: '1 line(s)' });
    expect(m.jsonSet(id, '$.c', 'y')!.message).toContain('Set $.c');
    m.jsonInsert(id, '$.a.b', 3);
    m.jsonDelete(id, '$.a.b[0]');
    expect(JSON.parse(m.getContent(id)!)).toEqual({ a: { b: [2, 3] }, c: 'y' });
    expect(m.jsonInsert(id, '$.c', 1)).toMatchObject({ error: true, message: 'Error: $.c is not an array.' });
    const t = m.create({ content: 'plain' });
    expect(m.jsonSet(t, '$.x', 1)).toMatchObject({ error: true });
    expect(m.jsonGet(t, '$.x')).toEqual({ error: 'json_get requires format: json' });
  });
});

describe('TextpadManager attachments, targets, expiry', () => {
  it('attaches by reference with a marker line, and detaches leaving the marker', () => {
    const m = new TextpadManager();
    const id = lines(m, 'body');
    const r = m.attach(id, { source: 'workspace', filename: 'chart.png', mimeType: 'image/png', size: 46080, location: '/ws/chart.png' })!;
    expect(r.refId).toBe('att-1');
    expect(m.getContent(id)).toBe('body\n![chart.png](att:att-1 "chart.png, 45.0 KB, from workspace")');
    expect(m.detach(id, 'att-1')).toContain('Marker line remains');
    expect(m.getAttachments(id)?.size).toBe(0);
    expect(m.detach(id, 'att-9')).toBe('Error: attachment att-9 not found.');
  });

  it('carries a target and describes it in the header', () => {
    const m = new TextpadManager<{ type: string; title: string }>();
    const id = m.create({ target: { type: 'new_page', title: 'Plan' } });
    expect(m.view(id)).toContain('target: new_page "Plan"');
    m.setTarget(id, undefined);
    expect(m.view(id)).not.toContain('target:');
  });

  it('expires by the injected clock and lists only live buffers', () => {
    let tick = 0;
    const m = new TextpadManager({ expiry: { now: () => tick, maxAge: 5 } });
    const a = lines(m, 'a');
    tick = 3;
    const b = lines(m, 'b');
    tick = 6;
    expect(m.get(a)).toBeNull();
    expect(m.get(b)).not.toBeNull();
    expect(m.list().map(s => s.id)).toEqual([b]);
    m.appendLines(b, 'x');
    tick = 11;
    expect(m.get(b)).not.toBeNull();
    tick = 12;
    expect(m.list()).toEqual([]);
  });
});
