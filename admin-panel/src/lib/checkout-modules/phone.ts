/** Phone module. @see ./registry.ts */
import { z } from 'zod';
import type { CheckoutCtx } from '@/lib/checkout-modules/registry';
export const configSchema = z.object({ id: z.literal('phone'), required: z.boolean() }).strict();
export function valueSchema(config: z.infer<typeof configSchema>, ctx: CheckoutCtx) {
  void ctx;
  return z.string().max(40).transform(v => { const n = v.replace(/[\s()-]/g, ''); return /^\d{9}$/.test(n) ? `+48${n}` : n.replace(/^00/, '+'); }).refine(v => (!config.required && v === '') || /^\+[1-9]\d{6,14}$/.test(v), 'invalid_phone');
}
export function toOrder(value: string) { return { phone: { v: 1, value } }; }
