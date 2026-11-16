/** Recipient module: an institution with a Polish NIP, the same rules as the standard checkout. @see ./buyer.ts */
import { z } from 'zod';
import { validateInvoiceRecipient } from '@/lib/checkout/invoice-section';
import { addInvoiceIssues, invoicePartyInput, invoicePartyShape } from '@/lib/checkout-modules/buyer';
import type { CheckoutCtx } from '@/lib/checkout-modules/registry';
export const configSchema = z.object({ id: z.literal('recipient'), for: z.array(z.literal('organization')).length(1) }).strict();
const differentSchema = z.object({ differs: z.literal(true), ...invoicePartyShape, country: z.string().max(10).optional() }).strict();
export function valueSchema(_config: z.infer<typeof configSchema>, ctx: CheckoutCtx) {
  return z.discriminatedUnion('differs', [z.object({ differs: z.literal(false) }).strict(), differentSchema])
    .superRefine((party, context) => { if (party.differs) addInvoiceIssues(validateInvoiceRecipient(invoicePartyInput(party)).errors, context); })
    .transform(party => party.differs ? { differs: true as const, ...validateInvoiceRecipient(invoicePartyInput(party)).party } : party)
    .refine(v => !v.differs || ctx.buyerType === 'organization', 'recipient_requires_organization');
}
export function toOrder(value: z.infer<ReturnType<typeof valueSchema>>) { return { recipient: { v: 1, ...value } }; }
