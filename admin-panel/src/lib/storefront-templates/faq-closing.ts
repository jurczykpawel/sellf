/** FAQ and closing public section resolution. @see spec/contracts/section-contract.md */
import { checkoutUrl, productUrl } from '@/lib/utils/product-urls';
import { ctaContentSchema, faqContentSchema, sectionSchema, settingsSchema } from '@/lib/storefront-templates/schemas';
import type { z } from 'zod';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { SlotContent, TemplateSettings } from '@/lib/storefront-templates/schemas';

export interface FaqProps { content: z.infer<typeof faqContentSchema> | null; locale: 'en' | 'pl' }
export interface ProductCtaProps { product: PublicProductInfo | null; content: z.infer<typeof ctaContentSchema> | null; action: 'details' | 'buy'; locale: 'en' | 'pl' }
interface SectionInputs {
  locale: 'en' | 'pl'; settings: TemplateSettings;
  productsById: Record<string, PublicProductInfo>; slots: Record<string, SlotContent>;
}
type Result<T> = { success: true; data: T } | { success: false; error: 'INVALID' };

export function hasCoreProductActions(product: PublicProductInfo, locale: 'en' | 'pl'): boolean {
  if (!/^[a-zA-Z0-9_-]+$/.test(product.slug)) return false;
  return product.actions.details === `/${locale}${productUrl(product.slug)}` && product.actions.buy === `/${locale}${checkoutUrl(product.slug)}`;
}
export function resolveFaq(spec: unknown, inputs: Pick<SectionInputs, 'locale' | 'slots'>): Result<FaqProps> {
  const parsed = sectionSchema.safeParse(spec);
  if (!parsed.success || parsed.data.type !== 'faq/1') return { success: false, error: 'INVALID' };
  const slot = inputs.slots[parsed.data.content.slot];
  const content = slot === undefined ? null : faqContentSchema.safeParse(slot);
  if (content && !content.success) return { success: false, error: 'INVALID' };
  return { success: true, data: { locale: inputs.locale, content: content?.success ? content.data : null } };
}
export function resolveProductCta(spec: unknown, inputs: SectionInputs): Result<ProductCtaProps> {
  const parsed = sectionSchema.safeParse(spec);
  const settings = settingsSchema.safeParse(inputs.settings);
  if (!parsed.success || parsed.data.type !== 'product-cta/1' || !('product' in parsed.data) || !settings.success) return { success: false, error: 'INVALID' };
  const section = parsed.data;
  const slot = inputs.slots[section.content.slot];
  const content = slot === undefined ? null : ctaContentSchema.safeParse(slot);
  if (content && !content.success) return { success: false, error: 'INVALID' };
  const id = settings.data[section.product.setting];
  const product = id && Object.hasOwn(inputs.productsById, id) ? inputs.productsById[id] : null;
  if (product && (product.id !== id || !hasCoreProductActions(product, inputs.locale))) return { success: false, error: 'INVALID' };
  return { success: true, data: { locale: inputs.locale, product, content: content?.success ? content.data : null, action: section.action } };
}
