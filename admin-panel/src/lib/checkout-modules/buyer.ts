/** Buyer module; shares the existing order buyer fields. @see ../payment/buyer-details.ts */
import { z } from 'zod';
import { taxIdErrorCode } from '@/lib/checkout/invoice-form-logic';
import { buildBuyerDetails } from '@/lib/payment/buyer-details';
import { validateTaxId } from '@/lib/validation/nip';
import { classifyTaxId } from '@/lib/validation/tax-id';
import type { TaxIdType } from '@/lib/validation/tax-id';
import type { CheckoutCtx } from '@/lib/checkout-modules/registry';

export const configSchema = z.object({ id: z.literal('buyer'), types: z.array(z.enum(['person', 'organization'])).min(1).max(2).refine(v => new Set(v).size === v.length, 'duplicate_type'), gus: z.boolean(), bank_transfer_for: z.array(z.enum(['person', 'organization'])).max(2).refine(v => new Set(v).size === v.length, 'duplicate_type').optional() }).strict();
const textSchema = (max: number) => z.string().trim().max(max).regex(/^[^\u0000-\u001f\u007f]*$/, 'invalid_text');
export const nameSchema = textSchema(100).min(1, 'required');
export const partyShape = {
  company_name: textSchema(200).min(1, 'required'),
  nip: z.string({ error: 'invalid_nip' }).trim().max(40).default(''),
  address: textSchema(300).min(1, 'required'),
  postal_code: textSchema(20).min(1, 'required'),
  city: textSchema(100).min(1, 'required'),
  country: z.string().regex(/^[A-Z]{2}$/).default('PL'),
};
export function validatePartyTaxId(party: { nip: string; country: string }, ctx: z.RefinementCtx): void {
  if (!validateTaxId(party.nip, true, party.country).isValid) ctx.addIssue({ code: 'custom', path: ['nip'], message: taxIdErrorCode(party.country) });
}
export function normalizePartyTaxId<T extends { nip: string; country: string }>(party: T): T & { tax_id_type?: TaxIdType; tax_id_country?: string } {
  if (!party.nip) return party;
  const result = classifyTaxId(party.nip, party.country);
  return { ...party, nip: result.normalized, tax_id_type: result.type, tax_id_country: result.country };
}
const personSchema = z.object({ type: z.literal('person'), first_name: nameSchema, last_name: nameSchema, email: z.email().max(254), address: textSchema(300).optional(), city: textSchema(100).optional(), postal_code: textSchema(20).optional(), country: z.string().regex(/^[A-Z]{2}$/).default('PL') }).strict();
const organizationSchema = z.object({ type: z.literal('organization'), ...partyShape, first_name: nameSchema.optional(), last_name: nameSchema.optional(), email: z.email().max(254).optional() }).strict();
export function valueSchema(config: z.infer<typeof configSchema>, ctx: CheckoutCtx) {
  void ctx;
  return z.discriminatedUnion('type', [personSchema, organizationSchema]).superRefine((party, context) => { if (party.type === 'organization') validatePartyTaxId(party, context); }).transform(party => party.type === 'organization' ? normalizePartyTaxId(party) : party).refine(v => config.types.includes(v.type), { path: ['type'], message: 'buyer_type_not_allowed' });
}
export function toOrder(value: z.infer<ReturnType<typeof valueSchema>>) {
  return { buyer: { ...buildBuyerDetails({ firstName: value.first_name, lastName: value.last_name, needsInvoice: value.type === 'organization', ...('nip' in value ? { nip: value.nip, companyName: value.company_name } : {}), address: value.address, city: value.city, postalCode: value.postal_code, country: value.country }, 'checkout'), ...value } };
}
