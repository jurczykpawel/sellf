/**
 * Buyer module; shares the existing order buyer fields. An organization follows the invoice rules
 * of the standard checkout section (W223b): `tax_id_mode: 'tax_id'` = the NIP path, where the number
 * decides the country; without it the manual path (chosen country, optional number).
 * @see ../payment/buyer-details.ts
 * @see ../checkout/invoice-section.ts
 */
import { z } from 'zod';
import { buildBuyerDetails } from '@/lib/payment/buyer-details';
import { validateInvoiceBuyer } from '@/lib/checkout/invoice-section';
import type { InvoicePartyError, InvoicePartyResult } from '@/lib/checkout/invoice-section';
import type { CheckoutCtx } from '@/lib/checkout-modules/registry';

export const configSchema = z.object({ id: z.literal('buyer'), types: z.array(z.enum(['person', 'organization'])).min(1).max(2).refine(v => new Set(v).size === v.length, 'duplicate_type'), bank_transfer_for: z.array(z.enum(['person', 'organization'])).max(2).refine(v => new Set(v).size === v.length, 'duplicate_type').optional() }).strict();
const textSchema = (max: number) => z.string().trim().max(max).regex(/^[^\u0000-\u001f\u007f]*$/, 'invalid_text');
export const nameSchema = textSchema(100).min(1, 'required');
/** Raw party text; the shared invoice rules decide what is required and how long it may be. */
const partyText = z.string().max(400).default('');
export const invoicePartyShape = {
  company_name: partyText, nip: partyText, address: partyText, postal_code: partyText, city: partyText,
};
/** Put shared invoice errors on the module's own fields (the number lives in `nip`). */
export function addInvoiceIssues(errors: InvoicePartyError[], ctx: z.RefinementCtx): void {
  for (const error of errors) ctx.addIssue({ code: 'custom', path: [error.key === 'tax_id' ? 'nip' : error.key], message: error.code });
}
export function invoicePartyInput(party: { company_name: string; nip: string; address: string; postal_code: string; city: string }) {
  return { tax_id: party.nip, company_name: party.company_name, address: party.address, postal_code: party.postal_code, city: party.city };
}
const personSchema = z.object({ type: z.literal('person'), first_name: nameSchema, last_name: nameSchema, email: z.email().max(254), address: textSchema(300).optional(), city: textSchema(100).optional(), postal_code: textSchema(20).optional(), country: z.string().regex(/^[A-Z]{2}$/).default('PL') }).strict();
const organizationSchema = z.object({ type: z.literal('organization'), ...invoicePartyShape, country: z.string().max(10).default('PL'), tax_id_mode: z.enum(['tax_id', 'manual']).optional(), first_name: nameSchema.optional(), last_name: nameSchema.optional(), email: z.email().max(254).optional() }).strict();
type Organization = z.infer<typeof organizationSchema>;
const checkOrganization = (party: Organization): InvoicePartyResult =>
  validateInvoiceBuyer({ ...invoicePartyInput(party), country: party.country }, party.tax_id_mode ?? 'manual');
export function valueSchema(config: z.infer<typeof configSchema>, ctx: CheckoutCtx) {
  void ctx;
  return z.discriminatedUnion('type', [personSchema, organizationSchema])
    .superRefine((party, context) => { if (party.type === 'organization') addInvoiceIssues(checkOrganization(party).errors, context); })
    .transform(party => {
      if (party.type !== 'organization') return party;
      const { tax_id_mode, ...rest } = party;
      void tax_id_mode;
      return { ...rest, ...checkOrganization(party).party };
    })
    .refine(v => config.types.includes(v.type), { path: ['type'], message: 'buyer_type_not_allowed' });
}
export function toOrder(value: z.infer<ReturnType<typeof valueSchema>>) {
  return { buyer: { ...buildBuyerDetails({ firstName: value.first_name, lastName: value.last_name, needsInvoice: value.type === 'organization', ...('nip' in value ? { nip: value.nip, companyName: value.company_name } : {}), address: value.address, city: value.city, postalCode: value.postal_code, country: value.country }, 'checkout'), ...value } };
}
