/** D-057 generation gate. @see scripts/storefront-schema-subset.ts */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { offerConfigSchema } from '@/lib/storefront-templates/phase2-contracts';
import { configSchema } from '@/lib/storefront-templates/schemas';
import { marketingFieldsShapeSchema } from '@/lib/validations/product-marketing';
import { assertSqlSchemaSubset, SQL_PATTERNS, toSqlSchema } from '../../../scripts/storefront-schema-subset';

describe('SQL schema generation contract', () => {
  for (const [name, shape] of Object.entries({ config: configSchema, marketing: marketingFieldsShapeSchema, offer: offerConfigSchema })) {
    it(`accepts every emitted ${name} keyword and pattern`, () => {
      const schema = toSqlSchema(shape);
      expect(schema).not.toHaveProperty('$schema');
      expect(() => assertSqlSchemaSubset(schema)).not.toThrow();
    });
    it(`fails actual ${name} generation on an unsupported Zod metadata keyword`, () => {
      expect(() => toSqlSchema(shape.meta({ unsupportedKeyword: true }))).toThrow('unsupportedKeyword');
      expect(() => toSqlSchema(z.object({ child: shape.meta({ minLength: 1 }) }))).toThrow('minLength');
    });
    for (const keyword of ['$ref', '$defs', 'oneOf', 'allOf', 'not', 'minimum', 'minLength', 'minProperties', 'patternProperties', 'contains', 'title']) {
      it(`rejects ${keyword} in nested ${name} schemas`, () => {
        const schema = toSqlSchema(shape);
        expect(() => assertSqlSchemaSubset({ ...schema, properties: { injected: { [keyword]: true } } })).toThrow(keyword);
      });
    }
  }
  it.each(['20261016223736_storefront_a_contract.sql', '20261017014729_storefront_b_contract.sql', '20261017030527_storefront_c_contract.sql', '20261016232157_product_offer_snapshots.sql'])('validates every frozen emitted keyword in %s', file => {
    const source = readFileSync(`../supabase/migrations/${file}`, 'utf8');
    const matches = [...source.matchAll(/AS \$schema\$ SELECT '((?:''|[^'])*)'::json/g)];
    expect(matches).toHaveLength(1);
    expect(() => assertSqlSchemaSubset(JSON.parse(matches[0][1].replaceAll("''", "'")))).not.toThrow();
    expect(source).not.toContain('jsonb_matches_schema');
  });
  it('walks schema positions without interpreting property names or annotation values as keywords', () => {
    expect(() => assertSqlSchemaSubset({ type: 'object', properties: { title: { type: 'string', default: { unsupported: true } } } })).not.toThrow();
  });
  it.each(['items', 'additionalProperties'])('checks nested %s schemas', keyword => {
    expect(() => assertSqlSchemaSubset({ [keyword]: { minLength: 1 } })).toThrow('minLength');
  });
  it('checks anyOf branches', () => {
    expect(() => assertSqlSchemaSubset({ anyOf: [{ type: 'null' }, { oneOf: [] }] })).toThrow('oneOf');
  });
  it('rejects unreviewed regex and format semantics', () => {
    expect(() => assertSqlSchemaSubset({ type: 'string', pattern: '\\w+' })).toThrow('pattern');
    expect(() => assertSqlSchemaSubset({ type: 'string', format: 'email' })).toThrow('format');
    expect(Object.keys(SQL_PATTERNS)).toHaveLength(7);
  });
  it('rejects unsupported dialects, shapes and excessive recursion', () => {
    expect(() => assertSqlSchemaSubset({ $schema: 'unknown' })).toThrow('$schema');
    expect(() => assertSqlSchemaSubset({ type: ['string', 'null'] })).toThrow('type');
    expect(() => assertSqlSchemaSubset({ anyOf: [] })).toThrow('anyOf');
    let schema: unknown = { type: 'string' };
    for (let i = 0; i < 40; i++) schema = { items: schema };
    expect(() => assertSqlSchemaSubset(schema)).toThrow('depth');
  });
});
