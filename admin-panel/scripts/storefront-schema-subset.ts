/** D-057: the complete SQL validator wire vocabulary and reviewed regex translations.
 * @see supabase/migrations/20261110235900_release_2026_11_0_storefront.sql
 */
import { z } from 'zod';
import type { ZodType } from 'zod';

const uuid = '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$';
const prose = String.raw`^(?![\s\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\/\/|[wW][wW][wW]\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\u20AC\u00A3]\s*\d|\d\s*(?:USD|EUR|PLN|GBP|z\u0142)|[\u0000\uFEFF\uFFFD]))[\s\S]*$`;
// pg_jsonschema 0.3.3 (jsonschema 0.17.1) converts ECMA escapes before
// compiling Rust regexes: \d is ASCII, and its exact \s set is pinned below.
// Do not substitute PostgreSQL locale classes or JavaScript's broader \s.
const whitespace = String.raw`[\u0009-\u000d\u0020\u00a0\u2003\u2029\ufeff]`;

export const SQL_PATTERNS: Readonly<Record<string, string>> = Object.freeze({
  [uuid]: uuid,
  '^[^<>]*$': '^[^<>]*$',
  [String.raw`^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::443)?(?:\/[a-zA-Z0-9/_-]*)?$`]: String.raw`^https://(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::443)?(?:/[a-zA-Z0-9/_-]*)?$`,
  '^[a-z][a-z0-9-]{0,63}$': '^[a-z][a-z0-9-]{0,63}$',
  '^#[0-9A-Fa-f]{6}$': '^#[0-9A-Fa-f]{6}$',
  [String.raw`^(?![\s\S]*<[^>]*>)[\s\S]*$`]: '^(?!.*<[^>]*>).*$',
  [prose]: prose.replaceAll(String.raw`[\s\S]`, '.').replaceAll(String.raw`\s`, whitespace)
    .replaceAll(String.raw`\d`, '[0-9]').replaceAll(String.raw`\/`, '/')
    // PostgreSQL jsonb cannot represent U+0000; removing it preserves its domain.
    .replaceAll(String.raw`\u0000`, '').replaceAll(String.raw`\u20AC`, '€')
    .replaceAll(String.raw`\u00A3`, '£').replaceAll(String.raw`\u0142`, 'ł')
    .replaceAll(String.raw`\uFEFF`, '\uFEFF').replaceAll(String.raw`\uFFFD`, '\uFFFD'),
});

const keywords = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'anyOf', 'enum', 'const', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'pattern', 'format', 'default']);
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/** Fail before writing either generated SQL block; annotations are opaque values. */
export function assertSqlSchemaSubset(schema: unknown, path = '$', depth = 0): void {
  if (depth > 32) throw new Error(`${path}: schema depth exceeds 32`);
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) throw new Error(`${path}: expected schema object`);
  for (const [key, value] of Object.entries(schema)) {
    const location = `${path}.${key}`;
    if (!keywords.has(key)) throw new Error(`${location}: unsupported keyword ${key}`);
    if (key === 'properties') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${location}: expected properties object`);
      for (const [name, child] of Object.entries(value)) assertSqlSchemaSubset(child, `${location}.${name}`, depth + 1);
    } else if (key === 'anyOf') {
      if (!Array.isArray(value) || value.length === 0) throw new Error(`${location}: anyOf must be nonempty`);
      value.forEach((child, i) => assertSqlSchemaSubset(child, `${location}[${i}]`, depth + 1));
    } else if (key === 'items' || (key === 'additionalProperties' && typeof value !== 'boolean')) {
      assertSqlSchemaSubset(value, location, depth + 1);
    } else if (key === 'type' && (typeof value !== 'string' || !types.has(value))) {
      throw new Error(`${location}: unsupported type`);
    } else if (key === 'pattern' && (typeof value !== 'string' || !Object.hasOwn(SQL_PATTERNS, value))) {
      throw new Error(`${location}: pattern has no reviewed SQL translation`);
    } else if (key === 'format' && value !== 'uuid') {
      throw new Error(`${location}: unsupported format`);
    } else if (['maxLength', 'minItems', 'maxItems'].includes(key) && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`${location}: expected nonnegative integer`);
    } else if (key === 'required' && (!Array.isArray(value) || value.some(item => typeof item !== 'string'))) {
      throw new Error(`${location}: expected string array`);
    } else if (key === 'enum' && (!Array.isArray(value) || !value.length)) {
      throw new Error(`${location}: expected nonempty enum`);
    } else if (key === 'uniqueItems' && typeof value !== 'boolean') {
      throw new Error(`${location}: expected boolean`);
    }
  }
}

/** $schema is Zod's dialect declaration, removed before emitting our subset. */
export function toSqlSchema(shape: ZodType): Record<string, unknown> {
  const { $schema: dialect, ...schema } = z.toJSONSchema(shape);
  if (dialect !== 'https://json-schema.org/draft/2020-12/schema') throw new Error('Unsupported $schema dialect');
  assertSqlSchemaSubset(schema);
  if (Buffer.byteLength(JSON.stringify(schema)) > 131072) throw new Error('SQL schema exceeds 131072 bytes');
  return schema;
}
