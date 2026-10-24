/** Recipient module. @see ./buyer.ts */
import { z } from 'zod';
import { partyShape, validatePartyTaxId, normalizePartyTaxId } from '@/lib/checkout-modules/buyer';
import type { CheckoutCtx } from '@/lib/checkout-modules/registry';
export const configSchema = z.object({ id: z.literal('recipient'), for: z.array(z.literal('organization')).length(1) }).strict();
export function valueSchema(_config: z.infer<typeof configSchema>, ctx: CheckoutCtx) {
  return z.discriminatedUnion('differs', [z.object({ differs: z.literal(false) }).strict(), z.object({ differs: z.literal(true), ...partyShape }).strict()]).superRefine((party, context) => { if (party.differs) validatePartyTaxId(party, context); }).transform(party => party.differs ? normalizePartyTaxId(party) : party).refine(v => !v.differs || ctx.buyerType === 'organization', 'recipient_requires_organization');
}
export function toOrder(value: z.infer<ReturnType<typeof valueSchema>>) { return { recipient: { v: 1, ...value } }; }
