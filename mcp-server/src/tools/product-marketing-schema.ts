/** Standalone editorial contract; parity tested against the API validator.
 * @see admin-panel/src/lib/validations/product-marketing.ts
 */
import { z } from 'zod';

const prosePattern = /^(?![\s\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\/\/|[wW][wW][wW]\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\u20AC\u00A3]\s*\d|\d\s*(?:USD|EUR|PLN|GBP|z\u0142)|[\u0000\uFEFF\uFFFD]))[\s\S]*$/;
const invalidString = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const text = (max: number) => z.string().regex(prosePattern)
  .refine(value => !invalidString.test(value) && Array.from(value).length <= max, `Text must contain at most ${max} valid characters`)
  .meta({ maxLength: max });
const list = (max: number) => z.array(text(max)).max(12)
  .refine(items => new Set(items).size === items.length, 'Items must be distinct').meta({ uniqueItems: true });
const copy = z.strictObject({ result: text(240).nullable(), tools: list(80), requirements: list(240) });
const format = z.enum(['course', 'workshop', 'ebook', 'template', 'tool', 'service', 'bundle', 'other']).nullable();

// Match jsonb text spacing without changing punctuation inside strings.
function storedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(storedJson).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${storedJson(item)}`).join(', ')}}`;
  }
  return JSON.stringify(value);
}

export const marketingFieldsSchema = z.union([
  z.strictObject({ format, sourceLocale: z.literal('en'), en: copy, pl: copy.optional() }),
  z.strictObject({ format, sourceLocale: z.literal('pl'), en: copy.optional(), pl: copy }),
]).superRefine((value, context) => {
  if (new TextEncoder().encode(storedJson(value)).length > 8192) {
    context.addIssue({ code: 'custom', message: 'Marketing fields must fit within 8192 stored UTF-8 bytes' });
  }
});
export type ProductMarketingFields = z.infer<typeof marketingFieldsSchema>;
