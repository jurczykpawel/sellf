/** Validated free-checkout answers retained before email and bound to the eventual grant. */
import 'server-only';
import { validateCustomFieldDefinitions, validateCustomFieldValues } from '@/lib/validations/custom-checkout-fields';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

interface FreeGrantFields { productId: string; productName: string; values: Record<string, string> }
type FieldsResult = ({ ok: true } & FreeGrantFields) | { ok: false; code: 'invalid_request' | 'send_failed'; fieldErrors?: Record<string, string> };
export async function validateFreeGrantFields(db: SupabaseClient<Database>, slug: string, input: unknown): Promise<FieldsResult> {
  const product = await db.from('products').select('id,name,custom_checkout_fields,is_active').eq('slug', slug).single();
  if (product.error || !product.data?.is_active) return { ok: false, code: 'invalid_request' };
  const definitions = validateCustomFieldDefinitions(product.data.custom_checkout_fields ?? []);
  if (!definitions.ok) return { ok: false, code: 'invalid_request' };
  const fields = validateCustomFieldValues(definitions.value, input ?? {});
  return fields.ok ? { ok: true, productId: product.data.id, productName: product.data.name, values: fields.values } : { ok: false, code: 'invalid_request', fieldErrors: fields.errors };
}
export async function prepareFreeGrantRequest(db: SupabaseClient<Database>, email: string, slug: string, input: unknown): Promise<(FieldsResult & { requestId?: string })> {
  const fields = await validateFreeGrantFields(db, slug, input);
  if (!fields.ok) return fields;
  const request = await db.rpc('prepare_free_grant', { p_email: email.trim().toLowerCase(), p_product_id: fields.productId, p_values: fields.values });
  return request.error || !request.data ? { ok: false, code: 'send_failed' } : { ...fields, requestId: request.data };
}
