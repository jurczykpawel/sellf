/** Product editorial contracts. @see spec/contracts/product-marketing-fields.md */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { PRODUCT_PAGE_FIELDS } from '@/lib/constants';
import { PRODUCT_PUBLIC_COLUMNS } from '@/lib/product-columns';
import { storedJsonBytes } from '@/lib/storefront-templates/json';
import { marketingFieldsSchema, marketingFieldsShapeSchema, marketingProjectionSchema, resolveMarketingCopy } from '@/lib/validations/product-marketing';

const copy = { result: null, tools: [], requirements: [] };
const empty = { format: null, sourceLocale: 'en', en: copy };
const translated = { format: 'workshop', sourceLocale: 'pl', en: { ...copy, result: 'Build a report' }, pl: { result: 'Zbuduj raport', tools: ['n8n'], requirements: ['Podstawy arkuszy'] } };

describe('product marketing', () => {
  it.each([empty, translated, { format: 'course', sourceLocale: 'en', en: { ...copy, tools: ['Editor'] } }])('round-trips complete copy: %j', value => {
    expect(marketingFieldsSchema.parse(value)).toEqual(value);
  });
  it.each(['course', 'workshop', 'ebook', 'template', 'tool', 'service', 'bundle', 'other', null])('accepts format %s independently of billing', format => {
    expect(marketingFieldsSchema.safeParse({ ...empty, format }).success).toBe(true);
  });
  it.each([
    null, {}, { ...empty, format: 'subscription' }, { ...empty, sourceLocale: 'de' },
    { format: null, sourceLocale: 'pl', en: copy }, { ...empty, pl: null },
    { ...empty, price: 10 }, { ...empty, content_config: {} },
    { ...empty, en: { ...copy, result: 1 } }, { ...empty, en: { tools: [], requirements: [] } },
    { ...empty, en: { ...copy, result: 'a'.repeat(241) } },
    { ...empty, en: { ...copy, tools: ['a'.repeat(81)] } },
    { ...empty, en: { ...copy, requirements: ['a'.repeat(241)] } },
    ...['tools', 'requirements'].flatMap(key => [
      { ...empty, en: { ...copy, [key]: Array.from({ length: 13 }, (_, i) => String(i)) } },
      { ...empty, en: { ...copy, [key]: ['Same', 'Same'] } },
      { ...empty, en: { ...copy, [key]: 'text' } },
    ]),
    ...['<b>Result</b>', 'https://example.com', 'www.example.com', 'javascript:alert(1)', '11111111-1111-4111-8111-111111111111', '$10', '10 PLN', '\u0000', '\uD800'].map(result => ({ ...empty, en: { ...copy, result } })),
    { ...empty, en: { ...copy, unknown: true } },
    JSON.parse('{"format":null,"sourceLocale":"en","en":{"result":null,"tools":[],"requirements":[]},"__proto__":{}}'),
  ])('rejects invalid metadata: %j', value => {
    expect(marketingFieldsSchema.safeParse(value).success).toBe(false);
  });
  it('bounds stored UTF-8 bytes including JSON formatting', () => {
    const long = { result: 'a'.repeat(240), tools: Array.from({ length: 12 }, (_, i) => `${i.toString(16)}${'a'.repeat(79)}`), requirements: Array.from({ length: 12 }, (_, i) => `${i.toString(16)}${'a'.repeat(219)}`) };
    const value = { format: 'course', sourceLocale: 'en', en: long, pl: structuredClone(long) };
    const size = storedJsonBytes(value)!;
    const gap = 8192 - size;
    value.pl.result = 'é'.repeat(gap) + 'a'.repeat(240 - gap);
    expect(storedJsonBytes(value)).toBe(8192);
    expect(marketingFieldsSchema.safeParse(value).success).toBe(true);
    value.pl.result = 'é'.repeat(gap + 1) + 'a'.repeat(239 - gap);
    expect(storedJsonBytes(value)).toBe(8193);
    expect(marketingFieldsSchema.safeParse(value).success).toBe(false);
  });
  it('resolves locale with an explicit fallback flag and preserves absent results', () => {
    expect(resolveMarketingCopy(marketingFieldsSchema.parse(empty), 'pl')).toEqual({ locale: 'en', fallback: true, copy });
    expect(resolveMarketingCopy(marketingFieldsSchema.parse(translated), 'pl')).toEqual({ locale: 'pl', fallback: false, copy: translated.pl });
    expect(resolveMarketingCopy(marketingFieldsSchema.parse(translated), 'en').copy).toEqual(translated.en);
    expect(marketingFieldsSchema.parse({ ...empty, en: { ...copy, result: '' } }).en?.result).toBe('');
  });
  it('projects only public editorial data from a full admin row', () => {
    const row = { id: '11111111-1111-4111-8111-111111111111', marketing_fields: translated, content_config: { url: 'private' }, customer: { email: 'private' }, license_tier: 'private' };
    expect(marketingProjectionSchema.parse(row)).toEqual({ id: row.id, marketing_fields: translated });
    expect(PRODUCT_PUBLIC_COLUMNS).toContain('marketing_fields');
    expect(PRODUCT_PAGE_FIELDS.split(', ')).toContain('marketing_fields');
  });
});

describe('marketing text boundaries', () => {
  it('keeps the stored structural schema generated from the shared contract', () => {
    const sql = readFileSync(new URL('../../../../supabase/migrations/20261016000000_release_2026_10_6.sql', import.meta.url), 'utf8');
    const encoded = sql.match(/SELECT public\.jsonschema_subset_matches\('((?:[^']|'')*)'::json, instance\)/)?.[1];
    const { $schema, ...expected } = z.toJSONSchema(marketingFieldsShapeSchema);
    expect($schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(JSON.parse(encoded!.replaceAll("''", "'"))).toEqual(expected);
    expect(sql).toContain('CHECK (public.product_marketing_valid(marketing_fields))');
  });
  it('counts Unicode characters consistently with the stored schema', () => {
    expect(marketingFieldsSchema.safeParse({ ...empty, en: { ...copy, result: '😀'.repeat(240) } }).success).toBe(true);
    expect(marketingFieldsSchema.safeParse({ ...empty, en: { ...copy, result: '😀'.repeat(241) } }).success).toBe(false);
    expect(marketingFieldsSchema.safeParse({ ...empty, en: { ...copy, tools: ['Node.js'], result: 'Step 1: Prepare the example' } }).success).toBe(true);
  });
  it('requires plain JSON before parsing', () => {
    const value = Object.assign(Object.create({ inherited: true }), empty);
    expect(marketingFieldsSchema.safeParse(value).success).toBe(false);
  });
});
