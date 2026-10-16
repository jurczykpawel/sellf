/** Bounded JSON transport and offline stored-size calculation. @see spec/contracts/storefront-config.md */
export const CONFIG_BYTES = 102400;
export const ENVELOPE_BYTES = 131072;
export interface ValidationIssue {
  code: 'SCHEMA' | 'LIMIT' | 'UNKNOWN_TEMPLATE' | 'UNKNOWN_SECTION' | 'BINDING' | 'CONTENT_MISSING' | 'CONTENT_KIND' | 'URL' | 'CONTRAST' | 'ENTITLEMENT' | 'COMPATIBILITY' | 'TRANSLATION_FALLBACK' | 'UNAVAILABLE_PRODUCT';
  path: string;
  message: string;
  limit?: number;
}
export interface ValidationResult { validatorVersion: 1; valid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] }
export function result(errors: ValidationIssue[] = [], warnings: ValidationIssue[] = []): ValidationResult {
  return { validatorVersion: 1, valid: errors.length === 0, errors, warnings };
}
export const pointer = (parts: PropertyKey[]): string => parts.length ? '/' + parts.map(part => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : '';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const invalidString = /\u0000|\uFEFF|\uFFFD|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export function isPlainJson(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (typeof value === 'string') return !invalidString.test(value);
  if (typeof value === 'number') return Number.isFinite(value);
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value !== 'object' || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  return Object.entries(value).every(([key, child]) => !forbidden.has(key) && !invalidString.test(key) && isPlainJson(child, depth + 1));
}

/** Count the jsonb text representation for the declared bounded numeric grammar. */
export function storedJsonBytes(value: unknown): number | null {
  if (!isPlainJson(value)) return null;
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return bytes(JSON.stringify(value));
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) && value !== -0.01 && value !== -0.02) return null;
    return bytes(String(value));
  }
  if (Array.isArray(value)) {
    let total = 2 + Math.max(0, value.length - 1) * 2;
    for (const item of value) { const size = storedJsonBytes(item); if (size === null) return null; total += size; }
    return total;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    let total = 2 + Math.max(0, entries.length - 1) * 2;
    for (const [key, item] of entries) { const size = storedJsonBytes(item); if (size === null) return null; total += bytes(JSON.stringify(key)) + 2 + size; }
    return total;
  }
  return null;
}

/** Inspect object keys and nesting before JSON.parse can discard repeated keys. */
export function parseBoundedJson(input: Uint8Array, limit = CONFIG_BYTES, measureConfig = false): ValidationResult & { data?: unknown } {
  if (input.byteLength > limit) return result([{ code: 'LIMIT', path: '', message: 'JSON input exceeds byte limit', limit }]);
  let configTooLarge = false;
  try {
    const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
    let offset = 0;
    const whitespace = () => { while (/[\x20\t\r\n]/.test(source[offset] ?? '\0')) offset++; };
    const string = (): string => {
      const match = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(source.slice(offset));
      if (!match) throw new Error();
      offset += match[0].length;
      const value: string = JSON.parse(match[0]);
      if (invalidString.test(value)) throw new Error();
      return value;
    };
    const value = (depth: number, envelopeRoot = false): void => {
      if (depth > 12) throw new Error();
      whitespace();
      const start = source[offset];
      if (start === '"') { string(); return; }
      if (start === '{' || start === '[') {
        const close = start === '{' ? '}' : ']';
        const keys = new Set<string>();
        offset++; whitespace();
        if (source[offset] === close) { offset++; return; }
        while (true) {
          let configValue = false;
          if (start === '{') {
            const key = string();
            configValue = measureConfig && envelopeRoot && key === 'config';
            if (keys.has(key) || forbidden.has(key)) throw new Error();
            keys.add(key); whitespace();
            if (source[offset++] !== ':') throw new Error();
          }
          whitespace();
          const valueStart = offset;
          value(configValue ? 0 : depth + 1);
          if (configValue && new TextEncoder().encode(source.slice(valueStart, offset)).length > CONFIG_BYTES) { configTooLarge = true; throw new Error(); }
          whitespace();
          if (source[offset] === close) { offset++; return; }
          if (source[offset++] !== ',') throw new Error();
          whitespace();
        }
      }
      const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(offset));
      if (!primitive) throw new Error();
      if (/^-?\d/.test(primitive[0]) && /[eE.]/.test(primitive[0]) && !['-0.01', '-0.02'].includes(primitive[0])) throw new Error();
      offset += primitive[0].length;
    };
    value(0, true); whitespace();
    if (offset !== source.length) throw new Error();
    return { ...result(), data: JSON.parse(source) };
  } catch {
    if (configTooLarge) return result([{ code: 'LIMIT', path: '/config', message: 'Config input exceeds byte limit', limit: CONFIG_BYTES }]);
    return result([{ code: 'SCHEMA', path: '', message: 'Invalid JSON encoding or structure' }]);
  }
}
