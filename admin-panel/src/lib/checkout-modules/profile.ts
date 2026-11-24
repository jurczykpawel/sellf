/** Versioned checkout profile grammar and product compatibility. @see ./registry.ts */
import { z } from 'zod';
import { configSchema as buyer } from '@/lib/checkout-modules/buyer';
import { configSchema as recipient } from '@/lib/checkout-modules/recipient';
import { configSchema as phone } from '@/lib/checkout-modules/phone';
import { configSchema as quantity } from '@/lib/checkout-modules/quantity';
import { configSchema as participants } from '@/lib/checkout-modules/participants';

export const checkoutProfileSchema = z.object({ v: z.literal(1), modules: z.array(z.discriminatedUnion('id', [buyer, recipient, phone, quantity, participants])).max(5) }).strict().superRefine((p, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['modules'], message });
  if (new Set(p.modules.map(m => m.id)).size !== p.modules.length) issue('duplicate_module');
  const q = p.modules.find(m => m.id === 'quantity');
  if (q && q.min > q.max) issue('quantity_range');
  if (p.modules.some(m => m.id === 'participants') && !q) issue('participants_require_quantity');
  if (p.modules.some(m => m.id === 'recipient') && !p.modules.some(m => m.id === 'buyer' && m.types.includes('organization'))) issue('recipient_requires_organization');
  if (new TextEncoder().encode(JSON.stringify(p)).length > 8192) issue('profile_too_large');
});
export type CheckoutProfile = z.infer<typeof checkoutProfileSchema>;
export function parseCheckoutProfile(value: unknown, product: Record<string, unknown> = {}) {
  return checkoutProfileSchema.superRefine((p, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if ((product.checkout_template ?? 'default') !== 'default' || (product.product_type ?? 'one_time') !== 'one_time' || product.allow_custom_price === true || product.is_bundle === true) issue('profile_product_incompatible');
    if (product.embed_enabled === true && requiresStandardCheckout(p, product)) issue('embed_incompatible');
    if (product.issue_license_on_purchase === true && p.modules.some(m => m.id === 'quantity' && m.max > 1)) issue('license_quantity');
  }).safeParse(value);
}

/** Reads persisted profiles written before company lookup became shop-wide. */
export const storedCheckoutProfileSchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || !('modules' in value) || !Array.isArray(value.modules)) return value;
  return { ...value, modules: value.modules.map(module => {
    if (!module || typeof module !== 'object' || module.id !== 'buyer') return module;
    const { gus, ...config } = module;
    void gus;
    return config;
  }) };
}, checkoutProfileSchema);

/** Embedded checkout does not collect profile module values. */
interface CheckoutProductKind { price?: unknown; event_mode?: unknown; product_type?: unknown; allow_custom_price?: unknown; checkout_template?: unknown; is_bundle?: unknown; issue_license_on_purchase?: unknown }
export function usesFreeProductForm(product: CheckoutProductKind): boolean {
  return !product.event_mode && product.product_type !== 'subscription' && product.price === 0 && !product.allow_custom_price;
}
export function requiresStandardCheckout(value: unknown, product: CheckoutProductKind = {}): boolean {
  if (value == null || usesFreeProductForm(product)) return false;
  const profile = storedCheckoutProfileSchema.safeParse(value);
  return !profile.success || !parseCheckoutProfile(profile.data, { ...product, embed_enabled: false }).success || profile.data.modules.some(m => m.id === 'participants'
    || (m.id === 'quantity' && (m.min > 1 || m.max < 1 || (m.mode === 'product_page' && m.max !== 1))));
}
