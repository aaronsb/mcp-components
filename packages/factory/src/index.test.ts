import { describe, it, expect, vi } from 'vitest';
import { generateTools, validateManifest, buildResourceParams, staticDescriptor, formatDefaultAction, type Manifest } from './index.js';

const manifest: Manifest = {
  services: {
    tasks: {
      tool_name: 'manage_tasks',
      description: 'Tasks',
      requires_account: true,
      operations: {
        list: { type: 'list', description: 'list tasks', resource: 'tasks.list', params: { taskListId: { type: 'string', description: 'list', required: true, maps_to: 'tasklist' }, max: { type: 'number', description: 'n', default: 10, max: 50 } } },
        get: { type: 'detail', description: 'get a task', resource: 'tasks.get', params: { taskId: { type: 'string', description: 'id', required: true, maps_to: 'task' }, bodyFormat: { type: 'string', description: 'render', client_only: true, enum: ['md', 'text'] } } },
        create: { type: 'action', description: 'create', resource: 'tasks.insert', defaults: { status: 'needsAction' }, params: { title: { type: 'string', description: 't', required: true } } },
        digest: { type: 'detail', description: 'composed', params: {} },
      },
    },
    contacts: { tool_name: 'manage_contacts', description: 'C', service: 'people', operations: { list: { type: 'list', description: 'l', resource: 'people.list' } } },
  },
};

const calls: unknown[] = [];
const descriptor = staticDescriptor(
  { tasks: ['tasks.list', 'tasks.get', 'tasks.insert'], people: ['people.list'] },
  async (service, resource, params, ctx) => {
    calls.push({ service, resource, params, account: ctx.account });
    if (resource === 'tasks.list') return { items: [{ id: 't1', title: 'A' }, { id: 't2', title: 'B' }] };
    if (resource === 'tasks.get') return { id: 't1', title: 'A', notes: 'n', nested: { x: 1 } };
    if (resource === 'tasks.insert') return { id: 'new', title: params.title };
    return { people: [] };
  },
);

describe('validateManifest', () => {
  it('reports resources missing from the descriptor and operations with neither resource nor handler', () => {
    const errors = validateManifest(manifest, descriptor);
    expect(errors).toEqual([{ service: 'tasks', operation: 'digest', message: 'declares no resource and has no custom handler' }]);
    const bad = { services: { tasks: { ...manifest.services.tasks, operations: { x: { type: 'list' as const, description: '', resource: 'tasks.nope' } } } } };
    expect(validateManifest(bad, descriptor)[0].message).toContain("resource 'tasks.nope' is not in the descriptor for 'tasks' (has: tasks.list, tasks.get, tasks.insert)");
    expect(validateManifest(manifest, descriptor, { tasks: { customHandlers: { digest: async () => ({ text: '' }) } } })).toEqual([]);
    expect(() => generateTools(manifest, { descriptor })).toThrow(/not a subset/);
  });
});

describe('generateTools', () => {
  const patches = {
    tasks: {
      customHandlers: { digest: async (_p: Record<string, unknown>, account: string) => ({ text: `digest for ${account}`, refs: { n: 1 } }) },
      beforeExecute: { list: (p: Record<string, unknown>) => ({ ...p, showCompleted: false }) },
      afterExecute: { list: (d: unknown) => ({ items: (d as { items: { id: string }[] }).items.slice(0, 1) }) },
    },
  };
  const tools = generateTools(manifest, { descriptor, patches, hints: (s, op, ctx) => `\n[hint ${s}.${op} ${ctx.email}]` });
  const tasks = tools.find(t => t.service === 'tasks')!;

  it('builds one operation-dispatch schema per service with the union of params', () => {
    const props = tasks.schema.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(tasks.schema.name).toBe('manage_tasks');
    expect(props.operation.enum).toEqual(['list', 'get', 'create', 'digest']);
    expect(Object.keys(props)).toEqual(['operation', 'email', 'taskListId', 'max', 'taskId', 'bodyFormat', 'title']);
    expect(tasks.schema.inputSchema.required).toEqual(['operation', 'email']);
    expect(tools.find(t => t.service === 'contacts')!.schema.inputSchema.required).toEqual(['operation']);
  });

  it('maps params, applies hooks in order, formats by kind, and frames with hints', async () => {
    calls.length = 0;
    const list = await tasks.handler({ operation: 'list', email: 'a@b.c', taskListId: 'L', max: 500 });
    expect(calls[0]).toEqual({ service: 'tasks', resource: 'tasks.list', params: { tasklist: 'L', max: 50, showCompleted: false }, account: 'a@b.c' });
    expect(list.text).toContain('## Results (1)');
    expect(list.text).toContain('t1 | A');
    expect(list.text.endsWith('[hint tasks.list a@b.c]')).toBe(true);
    expect(list.refs).toMatchObject({ count: 1, id: 't1' });

    const get = await tasks.handler({ operation: 'get', email: 'a@b.c', taskId: 't1', bodyFormat: 'md' });
    expect(calls[1]).toMatchObject({ params: { task: 't1' } });
    expect(get.text).toContain('## A');
    expect(get.text).toContain('**notes:** n');
    expect(get.text).not.toContain('nested');

    const create = await tasks.handler({ operation: 'create', email: 'a@b.c', title: 'New' });
    expect(calls[2]).toMatchObject({ params: { status: 'needsAction', title: 'New' } });
    expect(create.text).toContain('Operation completed.');
    expect(create.text).toContain('**Title:** New');
    expect(create.refs).toMatchObject({ id: 'new' });
  });

  it('routes to custom handlers with framing, rejects bad accounts and unknown operations', async () => {
    const digest = await tasks.handler({ operation: 'digest', email: 'a@b.c' });
    expect(digest.text).toBe('digest for a@b.c\n[hint tasks.digest a@b.c]');
    await expect(tasks.handler({ operation: 'list', email: 'nope' })).rejects.toThrow(/valid email/);
    expect((await tasks.handler({ operation: 'zap', email: 'a@b.c' })).text).toContain("Unknown manage_tasks operation: 'zap'. Valid: list, get, create, digest");
  });

  it('lets a policy refuse before the descriptor is called', async () => {
    calls.length = 0;
    const policy = vi.fn(async (info: { operation: string }) => (info.operation === 'create' ? { text: 'Blocked', blocked: true, isError: true } : null));
    const [t] = generateTools({ services: { tasks: manifest.services.tasks } }, { descriptor, patches, policy });
    expect(await t.handler({ operation: 'create', email: 'a@b.c', title: 'x' })).toMatchObject({ blocked: true });
    expect(calls).toHaveLength(0);
    expect(policy).toHaveBeenCalledWith(expect.objectContaining({ service: 'tasks', manifestService: 'tasks', operation: 'create', account: 'a@b.c' }));
  });

  it('calls the descriptor with the API service name when it differs from the manifest key', async () => {
    calls.length = 0;
    await tools.find(t => t.service === 'contacts')!.handler({ operation: 'list' });
    expect(calls[0]).toMatchObject({ service: 'people', resource: 'people.list' });
  });
});

describe('helpers', () => {
  it('buildResourceParams drops undefined and client-only values', () => {
    expect(buildResourceParams({ type: 'list', description: '', params: { a: { type: 'string', description: '', client_only: true }, b: { type: 'string', description: '', default: 'd' }, c: { type: 'string', description: '' } } }, { a: 1, c: undefined })).toEqual({ b: 'd' });
  });
  it('the action formatter names the id whatever the API called it', () => {
    expect(formatDefaultAction({ documentId: 'D1', title: 'Doc' }).text).toBe('Operation completed.\n\n**Title:** Doc\n**Document ID:** D1');
    expect(formatDefaultAction({}).refs).toMatchObject({ id: 'unknown' });
  });
});
