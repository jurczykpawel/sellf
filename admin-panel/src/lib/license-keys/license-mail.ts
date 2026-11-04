/** Auth mail that hands a buyer their license key (free claim and paid order). @see services/free-access-events.ts, services/fulfill-paid-order.ts */
import { sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
import { buildPostCheckoutMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import type { SupabaseClient } from '@supabase/supabase-js';

interface LicenseMailInput { userId: string | null; email: string; productSlug: string; productName: string; token: string; locale?: 'pl' | 'en' }

/** Never throws: the grant and the lead webhook must not depend on mail delivery. */
export async function sendLicenseMail(db: SupabaseClient, input: LicenseMailInput): Promise<void> {
  try {
    const account = input.locale || !input.userId ? null : (await db.auth.admin.getUserById(input.userId)).data;
    const locale = input.locale ?? (account?.user?.user_metadata?.locale === 'pl' ? 'pl' : 'en');
    const result = await sendTrustedMagicLink({
      email: input.email,
      redirectTo: buildPostCheckoutMagicLinkRedirect({ origin: getSellfBaseUrl(), productSlug: input.productSlug, locale, sessionId: undefined, paymentIntentId: undefined }),
      data: { locale, purchase_product: input.productName, license_key: input.token },
    });
    if (!result.ok) console.error('[license-mail] Delivery failed:', result.code);
  } catch {
    console.error('[license-mail] Delivery failed');
  } finally {
    // The key must not linger in account data once the mail was rendered.
    const cleared = await db.rpc('prepare_event_mail', { p_email: input.email, p_data: { locale: 'en' } }).then(r => r, () => ({ error: true }));
    if (cleared.error) console.error('[license-mail] License key cleanup failed');
  }
}

/**
 * Paid order: one key mail per issued license, in the order's language (owner decision
 * 3.11 "license → mail to the buyer with the key"; W146 found paid buyers got none).
 * Never throws; the purchase webhook still carries the tokens for integrations.
 */
export async function mailOrderLicenses(db: SupabaseClient, input: { email: string; userId: string | null; locale?: 'pl' | 'en'; licenses: { productId: string; token: string }[] }): Promise<void> {
  if (!input.licenses.length) return;
  try {
    const { data: products } = await db.from('products').select('id,slug,name').in('id', [...new Set(input.licenses.map(l => l.productId))]);
    const byId = new Map((products ?? []).map((p: { id: string; slug: string; name: string }) => [p.id, p]));
    for (const license of input.licenses) {
      const product = byId.get(license.productId);
      if (!product) { console.error('[license-mail] Product unavailable for license mail'); continue; }
      await sendLicenseMail(db, { userId: input.userId, email: input.email, productSlug: product.slug, productName: product.name, token: license.token, ...(input.locale ? { locale: input.locale } : {}) });
    }
  } catch {
    console.error('[license-mail] Order license mail failed');
  }
}
