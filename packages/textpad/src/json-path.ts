/**
 * JSON path helpers for path-addressed editing. Dot and bracket notation:
 * `$.foo.bar[0].baz`.
 */

export function parsePath(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  const normalized = path.startsWith('$.') ? path.slice(2) : path.startsWith('$') ? path.slice(1) : path;
  if (!normalized) return segments;
  for (const part of normalized.split(/\.|\[|\]/).filter(Boolean)) {
    const num = parseInt(part, 10);
    segments.push(!isNaN(num) && String(num) === part ? num : part);
  }
  return segments;
}

function descend(obj: unknown, path: string, segments: (string | number)[]): unknown {
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      throw new Error(`Path ${path}: cannot traverse into ${typeof current} at segment ${seg}`);
    }
    current = (current as Record<string, unknown>)[String(seg)];
  }
  return current;
}

export function getByPath(obj: unknown, path: string): unknown {
  return descend(obj, path, parsePath(path));
}

export function setByPath(obj: unknown, path: string, value: unknown): void {
  const segments = parsePath(path);
  if (segments.length === 0) throw new Error('Cannot set at root path');
  const parent = descend(obj, path, segments.slice(0, -1));
  if (parent === null || parent === undefined || typeof parent !== 'object') {
    throw new Error(`Path ${path}: parent is not an object`);
  }
  (parent as Record<string, unknown>)[String(segments[segments.length - 1])] = value;
}

export function deleteByPath(obj: unknown, path: string): void {
  const segments = parsePath(path);
  if (segments.length === 0) throw new Error('Cannot delete root');
  const parent = descend(obj, path, segments.slice(0, -1));
  if (parent === null || parent === undefined || typeof parent !== 'object') {
    throw new Error(`Path ${path}: parent is not an object`);
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(parent) && typeof last === 'number') {
    parent.splice(last, 1);
  } else {
    delete (parent as Record<string, unknown>)[String(last)];
  }
}
