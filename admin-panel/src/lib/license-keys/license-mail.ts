/** Auth mail that hands a buyer their license key (free claim and paid order). @see services/free-access-events.ts, services/fulfill-paid-order.ts */
import { createHash } from 'node:crypto';
import { isDemoMode } from '@/lib/demo-guard';
import { parseLicenseClaims } from '@/lib/license-keys/format';
import { sendTrustedMagicLink } from '@/lib/auth/magic-link/request';
import { buildPostCheckoutMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import type { SupabaseClient } from '@supabase/supabase-js';

interface LicenseMailInput { userId: string | null; email: string; productSlug: string; productName: string; token: string; keys?: Record<string, string>; mailData?: Record<string, string>; locale?: 'pl' | 'en' }

export function licenseMailKey(email: string, order: string): string {
  return createHash('sha256').update(JSON.stringify([email.trim().toLowerCase(), order])).digest('hex');
}

/**
 * `pending`: the mail is parked in auth_mail_retries and the retry worker delivers it (e.g. after the auth mail limit).
 * `skipped`: buyer emails are off, so the mail is left to the webhook channel.
 */
export type LicenseMailDelivery = 'sent' | 'skipped' | 'pending' | 'failed';

/** Never throws: the grant and the lead webhook must not depend on mail delivery. */
export async function sendLicenseMail(db: SupabaseClient, input: LicenseMailInput): Promise<LicenseMailDelivery> {
  if (isDemoMode()) return 'failed';
  let retryId: string | undefined;
  let locale: 'pl' | 'en' = input.locale ?? 'en';
  try {
    const account = input.locale || !input.userId ? null : (await db.auth.admin.getUserById(input.userId)).data;
    locale = input.locale ?? (account?.user?.user_metadata?.locale === 'pl' ? 'pl' : 'en');
    const data: Record<string, string | Record<string, string>> = { ...input.mailData, locale, purchase_product: input.productName, license_key: input.token, ...(input.keys ? { license_keys: input.keys } : {}) };
    delete data.license_mail_managed;
    delete data.purchase_mail_pending;
    const mailKey = licenseMailKey(input.email, parseLicenseClaims(input.token)?.order ?? input.token);
    const redirect = new URL(buildPostCheckoutMagicLinkRedirect({ origin: getSellfBaseUrl(), productSlug: input.productSlug, locale, sessionId: undefined, paymentIntentId: undefined }));
    redirect.searchParams.set('mail_id', mailKey);
    const claimed = await db.rpc('claim_license_mail', { p_key: mailKey, p_email: input.email, p_redirect_to: redirect.toString(), p_data: data });
    if (claimed.error) throw new Error('Mail registration unavailable');
    if (!claimed.data) {
      const pending = await db.from('auth_mail_retries').select('id,given_up_at').eq('license_mail_key', mailKey).maybeSingle();
      if (pending.error) return 'failed';
      if (!pending.data) return 'sent';
      if (!pending.data.given_up_at) return 'pending';
      // A repeated grant resumes a mail the worker gave up on: fresh attempts, due on its next tick.
      const resumed = await db.from('auth_mail_retries').update({ given_up_at: null, attempts: 0, next_attempt_at: new Date().toISOString() })
        .eq('id', pending.data.id).not('given_up_at', 'is', null).select('id');
      return resumed.error || !resumed.data?.length ? 'failed' : 'pending';
    }
    retryId = claimed.data;
    const result = await sendTrustedMagicLink({ transactionalOnly: true,
      email: input.email,
      redirectTo: redirect.toString(),
      data,
      retry: 'license',
    });
    const finished = await db.rpc('finish_license_mail', { p_retry_id: retryId, p_completed: result.ok, p_error: result.ok ? null : result.code });
    if (finished.error) console.error('[license-mail] Delivery state awaiting recovery');
    if (!result.ok) console.error('[license-mail] Delivery failed:', result.code, result.queued ? '(queued for retry)' : '');
    if (finished.error) return 'failed';
    return result.ok ? (result.skipped ? 'skipped' : 'sent') : 'pending';
  } catch {
    console.error('[license-mail] Delivery failed');
    // A claimed mail keeps its queue row, so the retry worker still delivers it.
    return retryId ? 'pending' : 'failed';
  } finally {
    if (retryId) {
      // The key must not linger in account data once the mail was rendered; the buyer's language stays.
      const cleared = await db.rpc('prepare_event_mail', { p_email: input.email, p_data: { locale } }).then(r => r, () => ({ error: true }));
      if (cleared.error) console.error('[license-mail] License key cleanup failed');
    }
  }
}

/** Deliver all licenses of an order together, with one sign-in link. */
export async function mailOrderLicenses(db: SupabaseClient, input: { email: string; userId: string | null; locale?: 'pl' | 'en'; licenses: { productId: string; token: string }[]; mailData?: Record<string, string> }): Promise<void> {
  if (!input.licenses.length) return;
  try {
    const { data: products, error } = await db.from('products').select('id,slug,name').in('id', [...new Set(input.licenses.map(l => l.productId))]);
    if (error || !products?.length) throw new Error('Order products unavailable');
    const byId = new Map(products.map((p: { id: string; slug: string; name: string }) => [p.id, p]));
    const keys: Record<string, string> = {};
    for (const license of input.licenses) {
      const product = byId.get(license.productId);
      if (!product) throw new Error('Order product unavailable');
      keys[`${product.name} (${product.slug})`] = license.token;
    }
    const first = byId.get(input.licenses[0].productId)!;
    await sendLicenseMail(db, { userId: input.userId, email: input.email, productSlug: first.slug,
      productName: products.map(p => p.name).join(', ').slice(0, 500), mailData: input.mailData, token: input.licenses[0].token,
      ...(input.licenses.length > 1 ? { keys } : {}), ...(input.locale ? { locale: input.locale } : {}) });
  } catch {
    console.error('[license-mail] Order license mail failed');
  }
}
