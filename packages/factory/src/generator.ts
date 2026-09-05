/**
 * The generator: manifest plus descriptor plus patches in, tools out.
 */

import type { StepResult } from '@aaronsb/mcp-component-core';
import { formatDefault } from './defaults.js';
import type {
  Descriptor, GeneratedHandler, GeneratedTool, GeneratedToolSchema, Manifest, OperationDef, PatchContext, ServiceDef, ServicePatch,
} from './types.js';

export interface GenerateOptions {
  descriptor: Descriptor;
  patches?: Record<string, ServicePatch>;
  /** Hints for a service and operation when the patch supplies none. */
  hints?: (service: string, operation: string, context: Record<string, string>) => string;
  /** Runs before anything else. Return a result to refuse, or null to proceed. */
  policy?: (info: { service: string; manifestService: string; operation: string; opDef: OperationDef; params: Record<string, unknown>; account: string }) => Promise<StepResult | null> | StepResult | null;
  /** Name and description of the account parameter. Default `email`. */
  accountParam?: { name: string; description: string; validate?: (value: unknown) => string };
}

// ── Subset check ────────────────────────────────────────────────

export interface ManifestError {
  service: string;
  operation: string;
  message: string;
}

/**
 * Every manifest operation must name a resource the descriptor has, or a
 * custom handler must take it. Run at build time so a typo in the manifest
 * fails the build rather than the call.
 */
export function validateManifest(manifest: Manifest, descriptor: Descriptor, patches: Record<string, ServicePatch> = {}): ManifestError[] {
  const errors: ManifestError[] = [];
  for (const [name, service] of Object.entries(manifest.services)) {
    const apiService = service.service ?? name;
    for (const [op, def] of Object.entries(service.operations)) {
      if (patches[name]?.customHandlers?.[op]) continue;
      if (!def.resource) {
        errors.push({ service: name, operation: op, message: `declares no resource and has no custom handler` });
        continue;
      }
      if (!descriptor.has(apiService, def.resource)) {
        const known = descriptor.methods?.(apiService);
        errors.push({ service: name, operation: op, message: `resource '${def.resource}' is not in the descriptor for '${apiService}'${known?.length ? ` (has: ${known.slice(0, 8).join(', ')}${known.length > 8 ? ', …' : ''})` : ''}` });
      }
    }
  }
  return errors;
}

// ── Generation ──────────────────────────────────────────────────

export function generateTools(manifest: Manifest, options: GenerateOptions): GeneratedTool[] {
  const errors = validateManifest(manifest, options.descriptor, options.patches);
  if (errors.length > 0) {
    throw new Error('Manifest is not a subset of the descriptor:\n' + errors.map(e => `- ${e.service}.${e.operation}: ${e.message}`).join('\n'));
  }
  return Object.entries(manifest.services).map(([name, service]) => ({
    service: name,
    schema: generateSchema(service, options.accountParam),
    handler: generateHandler(name, service, options),
  }));
}

export function generateSchema(service: ServiceDef, accountParam: GenerateOptions['accountParam'] = DEFAULT_ACCOUNT): GeneratedToolSchema {
  const names = Object.keys(service.operations);
  const properties: Record<string, unknown> = {
    operation: { type: 'string', enum: names, description: names.map(n => `${n}: ${service.operations[n].description}`).join(' | ') },
  };
  if (service.requires_account) properties[accountParam.name] = { type: 'string', description: accountParam.description };
  for (const op of Object.values(service.operations)) {
    for (const [pname, def] of Object.entries(op.params ?? {})) {
      if (properties[pname]) continue;
      properties[pname] = { type: def.type, description: def.description, ...(def.enum ? { enum: def.enum } : {}) };
    }
  }
  return {
    name: service.tool_name,
    description: service.description,
    inputSchema: {
      type: 'object',
      properties,
      required: service.requires_account ? ['operation', accountParam.name] : ['operation'],
      additionalProperties: false,
    },
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_ACCOUNT: NonNullable<GenerateOptions['accountParam']> = {
  name: 'email',
  description: 'Account email address',
  validate: v => {
    if (typeof v !== 'string' || !EMAIL_RE.test(v)) throw new Error('A valid email address is required for this operation');
    return v;
  },
};

export function generateHandler(manifestService: string, service: ServiceDef, options: GenerateOptions): GeneratedHandler {
  const patch = options.patches?.[manifestService];
  const apiService = service.service ?? manifestService;
  const accountParam = options.accountParam ?? DEFAULT_ACCOUNT;

  return async params => {
    const operation = String(params.operation ?? '');
    const opDef = service.operations[operation];
    if (!opDef) {
      return { text: `Unknown ${service.tool_name} operation: '${operation}'. Valid: ${Object.keys(service.operations).join(', ')}.`, isError: true };
    }

    let account = '';
    if (service.requires_account) {
      const raw = params[accountParam.name];
      account = accountParam.validate ? accountParam.validate(raw) : String(raw ?? '');
    }
    const ctx: PatchContext = { operation, params, account };

    const refused = await options.policy?.({ service: apiService, manifestService, operation, opDef, params, account });
    if (refused) return refused;

    const contextMap: Record<string, string> = { [accountParam.name]: account };
    for (const [k, v] of Object.entries(params)) if (typeof v === 'string') contextMap[k] = v;
    const footer = () => (patch?.hints ? patch.hints(operation, contextMap) : options.hints?.(manifestService, operation, contextMap) ?? '');

    if (patch?.customHandlers?.[operation]) {
      const response = await patch.customHandlers[operation](params, account);
      return { ...response, text: response.text + footer() };
    }

    if (!opDef.resource) {
      return { text: `${service.tool_name}.${operation} declares no resource and has no custom handler.`, isError: true };
    }

    let callParams = buildResourceParams(opDef, params);
    if (patch?.beforeExecute?.[operation]) callParams = await patch.beforeExecute[operation](callParams, ctx);

    let data = await options.descriptor.call(apiService, opDef.resource, callParams, { service: apiService, operation, account, manifestService });
    if (patch?.afterExecute?.[operation]) data = await patch.afterExecute[operation](data, ctx);

    const formatter = opDef.type === 'list' ? patch?.formatList : opDef.type === 'detail' ? patch?.formatDetail : patch?.formatAction;
    const formatted = formatter ? formatter(data, ctx) : formatDefault(data, opDef);
    return { ...formatted, text: formatted.text + footer() };
  };
}

/** The manifest's mapping: declared params, renames, defaults, clamps. Client-only params never leave. */
export function buildResourceParams(opDef: OperationDef, params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(opDef.defaults ?? {}) };
  for (const [name, def] of Object.entries(opDef.params ?? {})) {
    if (def.client_only) continue;
    const value = params[name];
    const key = def.maps_to ?? name;
    if (value !== undefined && value !== null) {
      out[key] = def.max !== undefined ? clamp(value, typeof def.default === 'number' ? def.default : 10, def.max) : value;
    } else if (def.default !== undefined) {
      out[key] = def.default;
    }
  }
  for (const [k, v] of Object.entries(out)) if (v === undefined) delete out[k];
  return out;
}

export function clamp(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) return Math.min(fallback, max);
  return Math.min(n, max);
}
