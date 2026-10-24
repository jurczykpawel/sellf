/** Quantity module. @see ./profile.ts */
import { z } from 'zod';
import type { CheckoutCtx } from '@/lib/checkout-modules/registry';
export const configSchema = z.object({ id: z.literal('quantity'), min: z.number().int().min(1).max(100), max: z.number().int().min(1).max(100), mode: z.enum(['hidden', 'checkout', 'product_page']) }).strict();
export function valueSchema(config: z.infer<typeof configSchema>, ctx: CheckoutCtx) {
  void ctx;
  return z.number().int().min(config.min).max(config.max).refine(v => config.mode !== 'hidden' || v === config.min, 'hidden_quantity');
}
export function toOrder(value: number) { return { quantity: { v: 1, value } }; }
export function parseQuantityInput(value: string, config: z.infer<typeof configSchema>): number | null {
  const parsed = valueSchema(config, { locale: 'en', currency: '', quantity: 1 }).safeParse(/^\d+$/.test(value.trim()) ? Number(value) : NaN);
  return parsed.success ? parsed.data : null;
}
