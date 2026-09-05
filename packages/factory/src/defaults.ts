/**
 * Default formatters for list, detail, and action results, used when a
 * service patch supplies none. They say what was returned and name the id
 * whatever the API called it, so hints and queue references keep resolving.
 */

import type { StepResult } from '@aaronsb/mcp-component-core';
import type { OperationDef } from './types.js';

export function formatDefault(data: unknown, opDef: OperationDef): StepResult {
  switch (opDef.type) {
    case 'list': return formatDefaultList(data);
    case 'action': return formatDefaultAction(data);
    default: return formatDefaultDetail(data);
  }
}

const ID_KEYS = ['id', 'key', 'documentId', 'spreadsheetId', 'fileId', 'eventId', 'threadId', 'pageId', 'issueId'];
const NAME_KEYS = ['title', 'name', 'summary', 'subject'];

export function formatDefaultList(data: unknown): StepResult {
  const items = findArray(data);
  if (items.length === 0) return { text: 'No results found.', refs: { count: 0 } };
  const lines = items.map(item => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const parts = [String(idOf(obj) ?? '')];
    for (const [key, val] of Object.entries(obj)) {
      if (ID_KEYS.includes(key)) continue;
      if (typeof val === 'string' && val.length < 100) parts.push(val);
      if (parts.length >= 5) break;
    }
    return parts.join(' | ');
  });
  const ids = items.map(i => String(idOf((i ?? {}) as Record<string, unknown>) ?? ''));
  return { text: `## Results (${items.length})\n\n${lines.join('\n')}`, refs: { count: items.length, id: ids[0], ids } };
}

export function formatDefaultDetail(data: unknown): StepResult {
  const obj = (data ?? {}) as Record<string, unknown>;
  const nameKey = NAME_KEYS.find(k => typeof obj[k] === 'string' && obj[k] !== '');
  const parts = [`## ${nameKey ? String(obj[nameKey]) : 'Details'}`, ''];
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined || typeof val === 'object') continue;
    parts.push(`**${key}:** ${String(val)}`);
  }
  return { text: parts.join('\n'), refs: { id: String(idOf(obj) ?? ''), ...scalarRefs(obj) } };
}

export function formatDefaultAction(data: unknown): StepResult {
  const obj = (data ?? {}) as Record<string, unknown>;
  const idKey = ID_KEYS.find(k => obj[k] !== undefined && obj[k] !== null);
  const nameKey = NAME_KEYS.find(k => typeof obj[k] === 'string' && obj[k] !== '');
  const parts = ['Operation completed.'];
  if (nameKey) parts.push(`\n\n**${titleCase(nameKey)}:** ${String(obj[nameKey])}`);
  if (idKey) parts.push(`\n**${titleCase(idKey)}:** ${String(obj[idKey])}`);
  return { text: parts.join(''), refs: { id: idKey ? String(obj[idKey]) : 'unknown', ...scalarRefs(obj) } };
}

function idOf(obj: Record<string, unknown>): unknown {
  const key = ID_KEYS.find(k => obj[k] !== undefined && obj[k] !== null);
  return key ? obj[key] : undefined;
}

function titleCase(key: string): string {
  return key.replace(/Id$/, ' ID').replace(/^./, c => c.toUpperCase());
}

function findArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const val of Object.values(data as Record<string, unknown>)) if (Array.isArray(val)) return val;
  }
  return [];
}

function scalarRefs(obj: Record<string, unknown>): Record<string, unknown> {
  const refs: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') refs[key] = val;
  }
  return refs;
}
