/**
 * Durable retry for purchase mails sent through Supabase Auth (post-payment login link, free-license
 * key). A refused send (send limit, cooldown, transient failure) is parked in auth_mail_retries and
 * the minute cron (`job=auth-mail-retry`) delivers it with backoff, so the buyer still gets the mail
 * after closing the page (W147-8, W147-9). A paid guest order also schedules the first access link
 * here, for a buyer who never reaches the confirmation page (W336).
 * @see supabase/migrations/20261110235907_release_2026_11_0_attribution_mail_analytics.sql
 * @see src/app/api/cron/route.ts
 */
import 'server-only';

import { buildPostCheckoutMagicLinkRedirect } from '@/lib/auth/magic-link-redirect';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import { eventMailForSlug } from '@/lib/events/mail';
import { createAdminClient } from '@/lib/supabase/admin';
import { addressMailRetryAfterSeconds, allowMailToAddress } from './address-limit';
import { readBuyerEmailPolicy } from './buyer-email-policy';
import { deliverMagicLink } from './deliver';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MagicLinkErrorCode, MagicLinkResult } from './types';

export type AuthMailRetryKind = 'post_checkout' | 'license';

/** Attempts by cron after the first refusal; minutes to wait after each failed attempt. */
export const AUTH_MAIL_MAX_ATTEMPTS = 6;
const BACKOFF_MINUTES = [5, 15, 30, 60, 120];
/** A post-payment link whose purchase is still not stored after this long is dropped (the purchase mail covers a real one). */
const PURCHASE_PENDING_WINDOW_MS = 30 * 60_000;
/** Minutes a paying guest has to come back from the payment page before the first access link is sent without them (W336). */
export const GUEST_ACCESS_MAIL_DELAY_MINUTES = 10;
/** Marks a link scheduled by a paid order, as opposed to one the confirmation page parked. */
const ACCESS_FALLBACK_FLAG = 'access_fallback';

interface QueueInput {
  email: string;
  redirectTo: string;
  data?: Record<string, string | Record<string, string>>;
  kind: AuthMailRetryKind;
  code: MagicLinkErrorCode;
}

/**
 * Parks a refused mail; returns the original refusal marked as queued (or not, if parking failed).
 * A post-payment link already delivered to this address and page (a sent marker) is not parked again:
 * the buyer has the link, so a refused page refresh reports it as sent instead of mailing it twice (C-B3).
 */
export async function queueAuthMailRetry(input: QueueInput): Promise<MagicLinkResult> {
  const { data: parked, error } = await createAdminClient().rpc('queue_auth_mail_retry', {
    p_email: input.email, p_redirect_to: input.redirectTo, p_data: input.data ?? {}, p_kind: input.kind, p_error: input.code,
  });
  if (error) {
    console.error('[auth-mail-retry] Queue failed:', error.message);
    return { ok: false, code: input.code };
  }
  if (parked === false) return { ok: true, skipped: true };
  return { ok: false, code: input.code, queued: true };
}

function postCheckoutRedirect(productSlug: string, locale: 'pl' | 'en'): string {
  return buildPostCheckoutMagicLinkRedirect({ origin: getSellfBaseUrl(), productSlug, locale, sessionId: undefined, paymentIntentId: undefined });
}

/** Product slug a post-payment link leads to, or undefined for a link without a product. */
function postCheckoutSlug(redirectTo: string): string | undefined {
  try {
    const destination = new URL(redirectTo).searchParams.get('redirect_to') ?? '';
    const target = new URL(destination, 'http://local.invalid');
    return target.searchParams.get('product') ?? target.pathname.match(/^\/(?:pl\/|en\/)?p\/([^/?]+)/)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * A paid order by a buyer without a confirmed account schedules the first access link, due after
 * the return window, so a guest who never reaches the confirmation page still gets it (W336). The
 * address is the one stored with the paid order. Returns true when a link was scheduled; false when
 * the buyer has a confirmed account or a link is already pending or was sent. Throws when the state
 * cannot be read or written, so the caller's fulfillment retry schedules it later.
 */
export async function scheduleGuestAccessMail(db: SupabaseClient, input: { email: string; productSlug: string; locale: 'pl' | 'en'; order: string }): Promise<boolean> {
  const email = input.email.trim().toLowerCase();
  const account = await db.rpc('find_user_id_by_email', { p_email: email });
  if (account.error) throw new Error('Buyer account unavailable');
  if (account.data) {
    const { data, error } = await db.auth.admin.getUserById(account.data as string);
    if (error) throw new Error('Buyer account unavailable');
    if (data.user?.email_confirmed_at) return false;
  }
  const other = input.locale === 'pl' ? 'en' : 'pl';
  const { data, error } = await db.rpc('schedule_post_checkout_mail', {
    p_email: email,
    p_redirects: [postCheckoutRedirect(input.productSlug, input.locale), postCheckoutRedirect(input.productSlug, other)],
    // The order key lets a payment redelivered after a failed fulfillment find the link it already scheduled.
    p_data: { locale: input.locale, [ACCESS_FALLBACK_FLAG]: 'true', order: input.order },
    p_delay_minutes: GUEST_ACCESS_MAIL_DELAY_MINUTES,
  });
  if (error) throw new Error('Access mail schedule unavailable');
  return data === true;
}

/**
 * A post-payment link was delivered: a scheduled one for the same purchase must not follow, whatever
 * page language either was built in. Returns false when the marker could not be stored; never throws.
 */
export async function markPostCheckoutMailSent(email: string, redirectTo: string, db: SupabaseClient = createAdminClient()): Promise<boolean> {
  const slug = postCheckoutSlug(redirectTo);
  const redirects = [...new Set([redirectTo, ...(slug ? [postCheckoutRedirect(slug, 'pl'), postCheckoutRedirect(slug, 'en')] : [])])];
  const { error } = await db.rpc('mark_post_checkout_mail_sent', { p_email: email, p_redirects: redirects });
  if (error) console.error('[auth-mail-retry] Sent marker unavailable:', error.message);
  return !error;
}

/** Cron worker: delivers due parked mails; never throws. */
export async function runAuthMailRetries(db: SupabaseClient = createAdminClient()): Promise<{ processed: number; errors: number }> {
  const { data: claimed, error } = await db.rpc('claim_auth_mail_retries', { p_limit: 20 });
  if (error) {
    console.error('[auth-mail-retry] Claim failed:', error.message);
    return { processed: 0, errors: 1 };
  }
  let processed = 0, errors = 0;
  for (const row of (claimed ?? []) as Array<{ id: string; email: string; redirect_to: string; data: Record<string, string | Record<string, string>>; attempts: number; kind: string; created_at: string }>) {
    let purchaseReady = true;
    if (row.kind === 'post_checkout') {
      const slug = postCheckoutSlug(row.redirect_to);
      if (slug) {
        // One read per attempt: the backoff already spaces the checks.
        const context: Record<string, string> = await eventMailForSlug(row.email, slug, row.data.locale === 'pl' ? 'pl' : 'en', { wait: false })
          .catch(() => ({ purchase_mail_pending: 'true' }));
        // A scheduled access link needs a purchase that still stands (not fully refunded or disputed);
        // an unreadable purchase reads as pending and waits for the next attempt.
        const purchaseGone = row.data[ACCESS_FALLBACK_FLAG] === 'true' && !context.purchase_product && context.purchase_mail_pending !== 'true';
        if (purchaseGone || (context.license_mail_managed === 'true' && await readBuyerEmailPolicy(db) === true)) {
          await db.from('auth_mail_retries').delete().eq('id', row.id);
          processed++;
          continue;
        }
        if (context.purchase_mail_pending === 'true' && Date.now() - Date.parse(row.created_at) > PURCHASE_PENDING_WINDOW_MS) {
          await db.from('auth_mail_retries').delete().eq('id', row.id);
          processed++;
          continue;
        }
        if (context.purchase_mail_pending === 'true') purchaseReady = false;
        // Purchase and event details are re-read at delivery; values parked earlier may be stale.
        row.data = { locale: row.data.locale === 'pl' ? 'pl' : 'en', ...context };
      }
    }
    const keys = row.data.license_keys && typeof row.data.license_keys === 'object'
      ? Object.values(row.data.license_keys) : row.data.license_key ? [row.data.license_key] : [];
    if (keys.length) {
      const current = await db.rpc('license_mail_is_current', { p_email: row.email, p_keys: keys });
      if (current.error) { errors++; continue; }
      if (current.data !== true) {
        await db.from('auth_mail_retries').delete().eq('id', row.id);
        processed++;
        continue;
      }
    }
    if (purchaseReady && !await allowMailToAddress(row.email)) {
      // The inbox got its daily maximum: the mail waits until the limit window resets (the time the
      // page announced) without using up an attempt.
      await db.from('auth_mail_retries').update({
        attempts: Math.max(row.attempts - 1, 0), last_error: 'rate_limited',
        next_attempt_at: new Date(Date.now() + addressMailRetryAfterSeconds() * 1000).toISOString(),
      }).eq('id', row.id);
      continue;
    }
    const result: MagicLinkResult = !purchaseReady ? { ok: false, code: 'send_failed' } : await deliverMagicLink({ email: row.email, redirectTo: row.redirect_to, shouldCreateUser: true, transactionalOnly: row.kind === 'license', data: row.data });
    // Purchase data (e.g. a license key) must not linger in the account once the mail was rendered.
    const cleared = await db.rpc('prepare_event_mail', { p_email: row.email, p_data: { locale: row.data.locale === 'pl' ? 'pl' : 'en' } });
    if (cleared.error) console.error('[auth-mail-retry] Account data cleanup failed');
    if (result.ok) {
      // A delivered post-payment link stays as a sent marker (with its order key) so neither a link in
      // the other page language nor a redelivered payment sends the buyer a second one (W336).
      if (row.kind !== 'post_checkout' || !await markPostCheckoutMailSent(row.email, row.redirect_to, db)) {
        await db.from('auth_mail_retries').delete().eq('id', row.id);
      }
      processed++;
      continue;
    }
    errors++;
    const giveUp = row.attempts >= AUTH_MAIL_MAX_ATTEMPTS;
    const wait = BACKOFF_MINUTES[Math.min(row.attempts - 1, BACKOFF_MINUTES.length - 1)];
    await db.from('auth_mail_retries').update({
      last_error: result.code,
      ...(giveUp ? { given_up_at: new Date().toISOString() } : { next_attempt_at: new Date(Date.now() + wait * 60_000).toISOString() }),
    }).eq('id', row.id);
    if (giveUp) console.error(`[auth-mail-retry] Gave up after ${row.attempts} attempts: ${result.code}`);
  }
  return { processed, errors };
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

/** In-process worker (production only), like business events; `/api/cron?job=auth-mail-retry` is the external entry point. */
export function startAuthMailRetries(): void {
  if (timer || process.env.E2E_MODE === 'true' || process.env.NODE_ENV !== 'production' || process.env.NEXT_PHASE === 'phase-production-build') return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void runAuthMailRetries().catch(() => console.error('[auth-mail-retry] Cycle unavailable')).finally(() => { running = false; });
  }, 60_000);
  timer.unref();
}
