/** Auth mail that hands a free-product buyer their license key. @see services/free-access-events.ts */
import { sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
import { buildPostCheckoutMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import type { SupabaseClient } from '@supabase/supabase-js';

interface LicenseMailInput { userId: string; email: string; productSlug: string; productName: string; token: string }

/** Never throws: the grant and the lead webhook must not depend on mail delivery. */
export async function sendLicenseMail(db: SupabaseClient, input: LicenseMailInput): Promise<void> {
  try {
    const { data: account } = await db.auth.admin.getUserById(input.userId);
    const locale = account.user?.user_metadata?.locale === 'pl' ? 'pl' : 'en';
    const result = await sendTrustedMagicLink({
      email: input.email,
      redirectTo: buildPostCheckoutMagicLinkRedirect({ origin: getSellfBaseUrl(), productSlug: input.productSlug, locale, sessionId: undefined, paymentIntentId: undefined }),
      data: { locale, purchase_product: input.productName, license_key: input.token },
      retry: 'license',
    });
    if (!result.ok) console.error('[license-mail] Delivery failed:', result.code, result.queued ? '(queued for retry)' : '');
  } catch {
    console.error('[license-mail] Delivery failed');
  } finally {
    // The key must not linger in account data once the mail was rendered.
    const cleared = await db.rpc('prepare_event_mail', { p_email: input.email, p_data: { locale: 'en' } }).then(r => r, () => ({ error: true }));
    if (cleared.error) console.error('[license-mail] License key cleanup failed');
  }
}
