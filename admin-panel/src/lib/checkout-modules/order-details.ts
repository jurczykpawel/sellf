/** Stored module projection shared by admin details and purchase webhooks. @see ./registry.ts */
import { z } from 'zod';

const party = z.object({
  v: z.literal(1), company_name: z.string().optional(), nip: z.string().optional(),
  address: z.string().optional(), postal_code: z.string().optional(),
  city: z.string().optional(), country: z.string().optional(),
  tax_id_type: z.enum(['pl_nip', 'eu_vat', 'other']).optional(), tax_id_country: z.string().optional(),
  tax_id_vies: z.enum(['valid', 'invalid', 'unavailable']).optional(),
});
const buyer = party.extend({
  type: z.enum(['person', 'organization']).optional(), needs_invoice: z.boolean().optional(),
  first_name: z.string().optional(), last_name: z.string().optional(), email: z.string().optional(),
}).passthrough();
const storedDetailsSchema = z.object({
  buyer: buyer.nullish().catch(null),
  recipient: party.extend({ differs: z.boolean() }).nullish().catch(null),
  phone: z.object({ v: z.literal(1), value: z.string() }).nullish().catch(null),
  quantity: z.object({ v: z.literal(1), value: z.number().int().min(1).max(100) }).nullish().catch(null),
  participants: z.object({ v: z.literal(1), people: z.array(z.object({
    first_name: z.string(), last_name: z.string(), email: z.string(),
  })).max(100) }).nullish().catch(null),
  details_missing: z.boolean().optional(),
});
export function readOrderDetails(value: unknown): z.infer<typeof storedDetailsSchema> {
  const parsed = storedDetailsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
export interface WebhookOrderDetails {
  buyer: ReturnType<typeof readOrderDetails>['buyer'];
  recipient: ReturnType<typeof readOrderDetails>['recipient'];
  phone: ReturnType<typeof readOrderDetails>['phone'];
  participants: ReturnType<typeof readOrderDetails>['participants'];
  quantity: ReturnType<typeof readOrderDetails>['quantity'];
}
