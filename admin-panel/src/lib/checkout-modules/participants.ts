/** Participants module. @see ./quantity.ts */
import { z } from 'zod';
import { nameSchema } from '@/lib/checkout-modules/buyer';
import type { CheckoutCtx } from '@/lib/checkout-modules/registry';
export const configSchema = z.object({ id: z.literal('participants'), required: z.boolean(), prefill_from_buyer: z.boolean(), allow_later: z.boolean().optional() }).strict();
const personSchema = z.object({ first_name: nameSchema, last_name: nameSchema, email: z.email().max(254) }).strict();
export function valueSchema(config: z.infer<typeof configSchema>, ctx: CheckoutCtx) {
  return z.array(personSchema).max(100).superRefine((list, c) => {
    if (list.length !== ctx.quantity && ((config.required && !(config.allow_later && list.length === 0)) || list.length > 0)) c.addIssue({ code: 'custom', message: 'participant_count' });
    const seen = new Set<string>();
    list.forEach((p, i) => { const email = p.email.toLowerCase(); if (seen.has(email)) c.addIssue({ code: 'custom', path: [i, 'email'], message: 'duplicate_email' }); seen.add(email); });
  });
}
export function toOrder(value: z.infer<typeof personSchema>[]) { return { participants: { v: 1, people: value } }; }
