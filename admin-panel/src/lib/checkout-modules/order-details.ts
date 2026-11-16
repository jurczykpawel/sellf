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
  missing_modules: z.array(z.enum(['buyer', 'recipient', 'quantity', 'phone', 'participants'])).optional(),
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

/** Size limit of order details checked by the database (set_payment_order_details, order_details CHECK). */
export const ORDER_DETAILS_MAX_BYTES = 65536;

/** SQLSTATE set_payment_order_details raises when the merged order details would exceed the limit. */
export const ORDER_DETAILS_TOO_LARGE_SQLSTATE = '54000';

const encoder = new TextEncoder();
const utf8Bytes = (text: string): number => encoder.encode(text).length;

/**
 * Bytes of `details::jsonb::text` as PostgreSQL measures it (octet_length): JSON with ", " and ": "
 * separators, UTF-8. Lets a route refuse oversized details before its first write. @see ORDER_DETAILS_MAX_BYTES
 */
export function orderDetailsByteLength(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length === 0 ? 2 : 2 + 2 * (value.length - 1) + value.reduce<number>((sum, item) => sum + orderDetailsByteLength(item ?? null), 0);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    return entries.length === 0 ? 2 : 2 + 2 * (entries.length - 1)
      + entries.reduce((sum, [key, item]) => sum + utf8Bytes(JSON.stringify(key)) + 2 + orderDetailsByteLength(item), 0);
  }
  return utf8Bytes(JSON.stringify(value) ?? 'null');
}

