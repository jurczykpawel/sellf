/** Buyer language comes from the event's own record, then the shop default. */
import { z } from 'zod';
import { defaultLocale, type Locale } from '@/lib/locales';
import type { SupabaseClient } from '@supabase/supabase-js';

export const customerLocaleSchema = z.enum(['pl', 'en']);
export const buyerWebhookCustomerSchema = z.object({ locale: customerLocaleSchema }).catchall(z.unknown());
export interface BuyerWebhookCustomer { email: string | null; userId?: string | null; locale: Locale }

export async function resolveCustomerLocale(db: SupabaseClient, saved: unknown): Promise<Locale> {
  const parsed = customerLocaleSchema.safeParse(saved);
  if (parsed.success) return parsed.data;
  const { data, error } = await db.from('shop_config').select('custom_settings').maybeSingle();
  if (error) throw new Error('Shop language unavailable');
  const configured = customerLocaleSchema.safeParse(data?.custom_settings?.default_locale);
  return configured.success ? configured.data : defaultLocale;
}

export async function orderCustomerLocale(db: SupabaseClient, id: string): Promise<Locale> {
  const { data, error } = await db.from('payment_transactions').select('metadata').eq('id', id).maybeSingle();
  if (error) throw new Error('Order language unavailable');
  return resolveCustomerLocale(db, data?.metadata?.locale);
}

/** Used once before customization and signing, including committed SQL events. */
export async function withCustomerLocale(event: string, input: unknown, db: SupabaseClient): Promise<unknown> {
  if (!input || typeof input !== 'object' || !('customer' in input) || !input.customer || typeof input.customer !== 'object') return input;
  const data = input as Record<string, any>;
  let saved = data.customer.locale;
  const orderId = data.order?.orderId ?? data.payment?.id ?? data.license?.orderId ?? data.sourceOrder?.id;
  if (typeof orderId === 'string') {
    saved = await orderCustomerLocale(db, orderId);
  } else if (event === 'license.issued' && typeof data.license?.order === 'string') {
    const ref = data.license.order;
    const column = /^[0-9a-f-]{36}$/i.test(ref) ? 'id' : ref.startsWith('pi_') ? 'stripe_payment_intent_id' : ref.startsWith('cs_') ? 'session_id' : ref.startsWith('in_') ? 'stripe_invoice_id' : null;
    if (column) {
      const { data: tx, error } = await db.from('payment_transactions').select('metadata').eq(column, ref).maybeSingle();
      if (error) throw new Error('License order language unavailable');
      saved = tx?.metadata?.locale;
    }
  } else if (data.access?.subscriptionId) {
    const { data: sub, error } = await db.from('subscriptions').select('metadata').eq('id', data.access.subscriptionId).maybeSingle();
    if (error) throw new Error('Subscription language unavailable');
    saved = sub?.metadata?.locale;
  } else if (data.subscription?.stripeSubscriptionId) {
    const { data: sub, error } = await db.from('subscriptions').select('metadata').eq('stripe_subscription_id', data.subscription.stripeSubscriptionId).maybeSingle();
    if (error) throw new Error('Subscription language unavailable');
    saved = sub?.metadata?.locale;
  } else if (event === 'lead.captured' && data.leadId) {
    const { data: lead, error } = await db.from('lead_submissions').select('locale').eq('id', data.leadId).maybeSingle();
    if (error) throw new Error('Lead language unavailable');
    saved = lead?.locale;
  }
  return { ...data, customer: buyerWebhookCustomerSchema.parse({ ...data.customer, locale: await resolveCustomerLocale(db, saved) }) };
}
