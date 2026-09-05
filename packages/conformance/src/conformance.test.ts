import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { createReferenceServer } from './server.js';

const specPath = path.join(import.meta.dirname, '..', 'spec', `${LATEST_PROTOCOL_VERSION}.schema.json`);

let root: string;
let client: Client;
let validateTool: (x: unknown) => boolean;
let validateResult: (x: unknown) => boolean;
let errorsOf: (v: unknown) => string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'conf-'));
  const spec = JSON.parse(await fs.readFile(specPath, 'utf-8'));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addSchema(spec, 'mcp');
  validateTool = ajv.getSchema('mcp#/$defs/Tool') as unknown as (x: unknown) => boolean;
  validateResult = ajv.getSchema('mcp#/$defs/CallToolResult') as unknown as (x: unknown) => boolean;
  errorsOf = v => JSON.stringify((v as { errors?: unknown }).errors ?? null);

  const { server } = createReferenceServer({ workspaceDir: path.join(root, 'ws'), configDir: path.join(root, 'cfg'), dataDir: path.join(root, 'data') });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'conformance', version: '0.1.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await fs.rm(root, { recursive: true, force: true });
});

const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');

describe(`conformance against MCP ${LATEST_PROTOCOL_VERSION}`, () => {
  it('the spec schema is vendored for the SDK\'s protocol version', async () => {
    await expect(fs.access(specPath)).resolves.toBeUndefined();
  });

  it('every tool schema the components emit is a valid spec Tool', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['manage_accounts', 'manage_notes', 'manage_workspace', 'queue_operations', 'textpad']);
    for (const tool of tools) {
      expect(validateTool(tool), `${tool.name}: ${errorsOf(validateTool)}`).toBe(true);
    }
    await expect(JSON.stringify(tools, null, 2)).toMatchFileSnapshot(path.join(import.meta.dirname, '..', 'fixtures', 'tools.snap.json'));
  });

  it('a pipeline across components runs in one queue call and every result is a valid CallToolResult', async () => {
    const result = await client.callTool({ name: 'queue_operations', arguments: { detail: 'full', operations: [
      { tool: 'textpad', args: { operation: 'create', content: '# Plan', format: 'markdown', target: { type: 'workspace', filename: 'plan.md' } } },
      { tool: 'textpad', args: { operation: 'append_lines', textpadId: '$0.textpadId', content: '- step one' } },
      { tool: 'textpad', args: { operation: 'send', textpadId: '$0.textpadId' } },
      { tool: 'manage_workspace', args: { operation: 'read', path: '$2.filename' } },
      { tool: 'manage_notes', args: { operation: 'create', email: 'user@example.com', title: 'From $2.filename' } },
      { tool: 'manage_notes', args: { operation: 'list', email: 'user@example.com' } },
    ] } });
    expect(validateResult(result), errorsOf(validateResult)).toBe(true);
    const out = text(result as never);
    expect(out).toContain('Executed 6 of 6 operations. Success: 6, Errors: 0');
    expect(out).toContain('# Plan\n- step one');
    expect(out).toContain('**Title:** From plan.md');
    expect(out).toContain('n1 | From plan.md');
    expect(out.match(/\*\*Next steps:\*\*/g)).toHaveLength(1);
    expect(out).toContain('"operation":"get","email":"user@example.com"');
  });

  it('errors, refusals, and inline images come back as valid results', async () => {
    const unknown = await client.callTool({ name: 'manage_notes', arguments: { operation: 'zap', email: 'user@example.com' } });
    expect(validateResult(unknown), errorsOf(validateResult)).toBe(true);
    expect(unknown.isError).toBe(true);

    await client.callTool({ name: 'manage_workspace', arguments: { operation: 'write', path: 'a.txt', content: 'x' } });
    await client.callTool({ name: 'manage_workspace', arguments: { operation: 'write', path: 'b.txt', content: 'x' } });
    await client.callTool({ name: 'manage_workspace', arguments: { operation: 'write', path: 'c.txt', content: 'x' } });
    const refused = await client.callTool({ name: 'queue_operations', arguments: { operations: [
      { tool: 'manage_workspace', args: { operation: 'delete', path: 'a.txt' } },
      { tool: 'manage_workspace', args: { operation: 'delete', path: 'b.txt' } },
      { tool: 'manage_workspace', args: { operation: 'delete', path: 'c.txt' } },
    ] } });
    expect(validateResult(refused), errorsOf(validateResult)).toBe(true);
    expect(refused.isError).toBe(true);
    expect(text(refused as never)).toContain('**Queue refused**');
    expect(text(await client.callTool({ name: 'manage_workspace', arguments: { operation: 'list' } }))).toContain('- a.txt');

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await fs.writeFile(path.join(root, 'ws', 'dot.png'), png);
    const image = await client.callTool({ name: 'manage_workspace', arguments: { operation: 'read', path: 'dot.png' } });
    expect(validateResult(image), errorsOf(validateResult)).toBe(true);
    expect((image.content as Array<{ type: string }>).map(c => c.type)).toEqual(['text', 'image']);
  });

  it('the accounts tool answers without a browser', async () => {
    const list = await client.callTool({ name: 'manage_accounts', arguments: { operation: 'list' } });
    expect(validateResult(list), errorsOf(validateResult)).toBe(true);
    expect(text(list as never)).toContain('No accounts configured.');
    const status = await client.callTool({ name: 'manage_accounts', arguments: { operation: 'status', email: 'nobody@example.com' } });
    expect(text(status as never)).toContain('No credential stored');
  });
});
