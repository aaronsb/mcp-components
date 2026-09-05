/**
 * A reference server: every component wired into one MCP server over the
 * pinned SDK. The conformance test drives it; a new server can copy it.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toMcp, type StepResult } from '@aaronsb/mcp-component-core';
import { runQueue, queueInputSchema, nestedQueueHandler, type QueueOptions, type StepHandler } from '@aaronsb/mcp-component-queue';
import { TextpadManager, createTextpadHandler, textpadInputSchema } from '@aaronsb/mcp-component-textpad';
import { createHints } from '@aaronsb/mcp-component-hints';
import { Workspace, createWorkspaceHandler, workspaceInputSchema } from '@aaronsb/mcp-component-workspace';
import { SlidingWindowGuard, queueGuard } from '@aaronsb/mcp-component-guardrails';
import { AccountManager, CredentialStore, createAccountsHandler, accountsInputSchema, type OAuthProvider } from '@aaronsb/mcp-component-accounts';
import { generateTools, staticDescriptor, type Manifest } from '@aaronsb/mcp-component-factory';

export interface ReferenceServerOptions {
  workspaceDir: string;
  configDir: string;
  dataDir: string;
  /** A tool-call epoch for textpad expiry; the server advances it per call. */
  maxTextpadAge?: number;
}

export interface ReferenceServer {
  server: Server;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  handlers: Record<string, StepHandler>;
  workspace: Workspace;
}

const provider: OAuthProvider = {
  name: 'example',
  authUrl: 'https://auth.example/authorize',
  tokenUrl: 'https://auth.example/token',
  scopeSets: { notes: ['scope:notes'] },
  readonlyScopeSets: { notes: ['scope:notes.readonly'] },
  identify: async () => 'user@example.com',
};

const manifest: Manifest = {
  services: {
    notes: {
      tool_name: 'manage_notes',
      description: 'List, read, and create notes.',
      requires_account: true,
      operations: {
        list: { type: 'list', description: 'list notes', resource: 'notes.list', params: { max: { type: 'number', description: 'How many', default: 10, max: 50 } } },
        get: { type: 'detail', description: 'read one note', resource: 'notes.get', params: { noteId: { type: 'string', description: 'Note id', required: true, maps_to: 'id' } } },
        create: { type: 'action', description: 'create a note', resource: 'notes.insert', params: { title: { type: 'string', description: 'Title', required: true } } },
      },
    },
  },
};

export function createReferenceServer(options: ReferenceServerOptions): ReferenceServer {
  let epoch = 0;
  const hints = createHints({
    'notes.list': [{ description: 'Read a note', tool: 'manage_notes', example: { operation: 'get', email: '$email', noteId: '<id from results>' } }],
    'textpad.create': [{ description: 'Add content', tool: 'textpad', example: { operation: 'append_lines', textpadId: '$textpadId', content: '<text>' } }],
  });

  const workspace = new Workspace({ appName: 'reference', dir: options.workspaceDir });
  const textpads = new TextpadManager<{ type: string; filename?: string }>({ expiry: { now: () => epoch, maxAge: options.maxTextpadAge ?? 100 } });
  const guard = new SlidingWindowGuard({ limit: 2 });

  const notes = new Map<string, { id: string; title: string }>();
  const descriptor = staticDescriptor(
    { notes: ['notes.list', 'notes.get', 'notes.insert'] },
    async (_service, resource, params) => {
      if (resource === 'notes.list') return { items: [...notes.values()].slice(0, Number(params.max ?? 10)) };
      if (resource === 'notes.get') {
        const note = notes.get(String(params.id));
        if (!note) throw new Error(`No note ${String(params.id)}`);
        return note;
      }
      const id = `n${notes.size + 1}`;
      const note = { id, title: String(params.title) };
      notes.set(id, note);
      return note;
    },
  );
  const generated = generateTools(manifest, { descriptor, hints: (svc, op, ctx) => hints(`${svc}.${op}`, ctx) });

  const accounts = new AccountManager({ provider, store: new CredentialStore({ appName: 'reference', configDir: options.configDir, dataDir: options.dataDir }), clientId: 'cid' });

  const handlers: Record<string, StepHandler> = {};
  const tools: ReferenceServer['tools'] = [];
  const add = (name: string, description: string, inputSchema: Record<string, unknown>, handler: (params: Record<string, unknown>) => Promise<StepResult>) => {
    tools.push({ name, description, inputSchema });
    handlers[name] = async params => handler(params);
  };

  add('textpad', 'Compose and edit content in a line-addressed buffer, then send it to a target.', textpadInputSchema({ sendTargets: ['workspace'], operations: ['create', 'view', 'list', 'discard', 'insert_lines', 'append_lines', 'replace_lines', 'remove_lines', 'copy_lines', 'send'] }),
    createTextpadHandler({
      manager: textpads,
      send: {
        workspace: async (m, id, p) => {
          const out = await workspace.save(String(p.filename ?? 'untitled.md'), Buffer.from(m.getContent(id) ?? ''));
          return { text: `Saved ${out.filename} (${out.size} bytes).`, refs: { filename: out.filename, path: out.path } };
        },
      },
    }));
  add('manage_workspace', 'List, read, write, delete, mkdir, or move files in the workspace directory.', workspaceInputSchema(), createWorkspaceHandler(workspace));
  add('manage_accounts', 'List, authenticate, check, refresh, rescope, or remove accounts.', accountsInputSchema({ services: ['notes'] }), createAccountsHandler({ manager: accounts, hints }));
  for (const t of generated) add(t.schema.name, t.schema.description, t.schema.inputSchema, t.handler);

  const queueOptions: QueueOptions = {
    handlers,
    guard: queueGuard(guard, step => (step.tool === 'manage_workspace' && step.args.operation === 'delete' ? { operation: 'delete', key: String(step.args.path) } : null)),
    onStep: () => { epoch++; },
  };
  add('queue_operations', 'Run several operations in order in one call, with $N.field references between them.', queueInputSchema(Object.keys(handlers)), async params => runQueue(params as never, queueOptions));
  handlers.queue_operations = nestedQueueHandler(queueOptions);

  const server = new Server({ name: 'mcp-components-reference', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    epoch++;
    const handler = handlers[req.params.name];
    if (!handler) return toMcp({ text: `Unknown tool: ${req.params.name}`, isError: true }) as CallToolResult;
    try {
      return toMcp(await handler(req.params.arguments ?? {}, { index: 0, depth: 0 })) as CallToolResult;
    } catch (err) {
      return toMcp({ text: err instanceof Error ? err.message : String(err), isError: true }) as CallToolResult;
    }
  });

  return { server, tools, handlers, workspace };
}
