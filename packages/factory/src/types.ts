/**
 * The three layers. A descriptor says what the API can do. A manifest curates
 * which operations exist, what the agent calls them, and which constants it
 * never sees. A patch overlays hooks, formatters, and hints per service.
 */

import type { StepResult } from '@aaronsb/mcp-component-core';

// ── Manifest ────────────────────────────────────────────────────

export interface ParamDef {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  default?: unknown;
  /** For numbers: clamp the value to this ceiling. */
  max?: number;
  /** Send under this name instead. */
  maps_to?: string;
  enum?: string[];
  /** Consumed by the formatter; never sent to the API. */
  client_only?: boolean;
}

export type OperationKind = 'list' | 'detail' | 'action';

export interface OperationDef {
  type: OperationKind;
  description: string;
  /** The descriptor method this operation calls, e.g. `users.messages.list`. */
  resource?: string;
  params?: Record<string, ParamDef>;
  /** Merged into the request before the caller's params. */
  defaults?: Record<string, unknown>;
  /** Free-form extras a descriptor or patch may read, such as batch methods. */
  [key: string]: unknown;
}

export interface ServiceDef {
  tool_name: string;
  description: string;
  /** The descriptor's name for this service, when it differs from the manifest key. */
  service?: string;
  /** Require an account parameter and pass it to the descriptor call. */
  requires_account?: boolean;
  operations: Record<string, OperationDef>;
}

export interface Manifest {
  services: Record<string, ServiceDef>;
}

// ── Descriptor ──────────────────────────────────────────────────

export interface CallContext {
  service: string;
  operation: string;
  account: string;
  manifestService: string;
}

/**
 * The API behind the factory. `has` answers the subset check at build time;
 * `call` runs a method at request time. OpenAPI, Google Discovery, and
 * GraphQL introspection each fit behind this.
 */
export interface Descriptor {
  has(service: string, resource: string): boolean;
  call(service: string, resource: string, params: Record<string, unknown>, ctx: CallContext): Promise<unknown>;
  /** Optional: the methods a service exposes, for error messages. */
  methods?(service: string): string[];
}

// ── Patches ─────────────────────────────────────────────────────

export interface PatchContext {
  operation: string;
  params: Record<string, unknown>;
  account: string;
}

export type BeforeExecuteHook = (params: Record<string, unknown>, ctx: PatchContext) => Promise<Record<string, unknown>> | Record<string, unknown>;
export type AfterExecuteHook = (result: unknown, ctx: PatchContext) => Promise<unknown> | unknown;
export type FormatHook = (data: unknown, ctx: PatchContext) => StepResult;
export type HintsHook = (operation: string, context: Record<string, string>) => string;
export type CustomHandler = (params: Record<string, unknown>, account: string) => Promise<StepResult>;

export interface ServicePatch {
  beforeExecute?: Record<string, BeforeExecuteHook>;
  afterExecute?: Record<string, AfterExecuteHook>;
  formatList?: FormatHook;
  formatDetail?: FormatHook;
  formatAction?: FormatHook;
  hints?: HintsHook;
  /** Replace the factory for an operation. The factory still frames the result. */
  customHandlers?: Record<string, CustomHandler>;
}

// ── Generated ───────────────────────────────────────────────────

export interface GeneratedToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type GeneratedHandler = (params: Record<string, unknown>) => Promise<StepResult>;

export interface GeneratedTool {
  service: string;
  schema: GeneratedToolSchema;
  handler: GeneratedHandler;
}
