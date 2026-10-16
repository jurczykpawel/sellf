/** Shared product editorial fields. @see spec/contracts/product-marketing-fields.md */
import { z } from 'zod';
import { isPlainJson, storedJsonBytes } from '@/lib/storefront-templates/json';

export const MARKETING_BYTES = 8192;
export const productFormatSchema = z.enum(['course', 'workshop', 'ebook', 'template', 'tool', 'service', 'bundle', 'other']);
// Editorial copy carries prose; commerce and destinations come from core fields.
const prosePattern = /^(?![\s\S]*(?:[<>]|(?:https?|ftp|javascript|data|mailto):|:\/\/|[wW][wW][wW]\.|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[$\u20AC\u00A3]\s*\d|\d\s*(?:USD|EUR|PLN|GBP|z\u0142)|[\u0000\uFEFF\uFFFD]))[\s\S]*$/;
const text = (max: number) => z.string().regex(prosePattern).refine(value => Array.from(value).length <= max, `Text must contain at most ${max} characters`).meta({ maxLength: max });
const list = (max: number) => z.array(text(max)).max(12).refine(items => new Set(items).size === items.length, 'Items must be distinct').meta({ uniqueItems: true });
export const marketingCopySchema = z.strictObject({ result: text(240).nullable(), tools: list(80), requirements: list(240) });
export const marketingFieldsShapeSchema = z.union([
  z.strictObject({ format: productFormatSchema.nullable(), sourceLocale: z.literal('en'), en: marketingCopySchema, pl: marketingCopySchema.optional() }),
  z.strictObject({ format: productFormatSchema.nullable(), sourceLocale: z.literal('pl'), en: marketingCopySchema.optional(), pl: marketingCopySchema }),
]);
export const marketingFieldsSchema = z.custom<z.input<typeof marketingFieldsShapeSchema>>(isPlainJson, 'Marketing fields must be plain JSON').pipe(marketingFieldsShapeSchema).superRefine((value, context) => {
  const bytes = storedJsonBytes(value);
  if (bytes === null || bytes > MARKETING_BYTES) {
    context.addIssue({ code: 'custom', message: 'Marketing fields must be valid JSON within 8192 stored UTF-8 bytes' });
  }
});
export type ProductMarketingCopy = z.infer<typeof marketingCopySchema>;
export type ProductMarketingFields = z.infer<typeof marketingFieldsSchema>;
export type ProductFormat = z.infer<typeof productFormatSchema>;

/** Public editorial projection; additional row fields are discarded. */
export const marketingProjectionSchema = z.object({ id: z.uuid(), marketing_fields: marketingFieldsSchema });
export type ProductMarketingProjection = z.infer<typeof marketingProjectionSchema>;

export function resolveMarketingCopy(fields: ProductMarketingFields, locale: 'en' | 'pl'): { locale: 'en' | 'pl'; fallback: boolean; copy: ProductMarketingCopy } {
  const copy = fields[locale];
  if (copy) return { locale, fallback: false, copy };
  const source = fields.sourceLocale === 'en' ? fields.en : fields.pl;
  return { locale: fields.sourceLocale, fallback: true, copy: source };
}
