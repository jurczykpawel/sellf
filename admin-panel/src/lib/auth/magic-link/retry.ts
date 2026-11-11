/**
 * Durable retry for purchase mails sent through Supabase Auth (post-payment login link, free-license
 * key). A refused send (send limit, cooldown, transient failure) is parked in auth_mail_retries and
 * the minute cron (`job=auth-mail-retry`) delivers it with backoff, so the buyer still gets the mail
 * after closing the page (W147-8, W147-9).
 * @see supabase/migrations/20261110235906_release_2026_11_0_buyer_mail.sql
 * @see src/app/api/cron/route.ts
 */
import 'server-only';

import { eventMailForSlug } from '@/lib/events/mail';
import { createAdminClient } from '@/lib/supabase/admin';
import { readBuyerEmailPolicy } from './buyer-email-policy';
import { deliverMagicLink } from './deliver';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MagicLinkErrorCode, MagicLinkResult } from './types';

export type AuthMailRetryKind = 'post_checkout' | 'license';

/** Attempts by cron after the first refusal; minutes to wait after each failed attempt. */
export const AUTH_MAIL_MAX_ATTEMPTS = 6;
const BACKOFF_MINUTES = [5, 15, 30, 60, 120];

interface QueueInput {
  email: string;
  redirectTo: string;
  data?: Record<string, string | Record<string, string>>;
  kind: AuthMailRetryKind;
  code: MagicLinkErrorCode;
}

/** Parks a refused mail; returns the original refusal marked as queued (or not, if parking failed). */
export async function queueAuthMailRetry(input: QueueInput): Promise<MagicLinkResult> {
  const { error } = await createAdminClient().rpc('queue_auth_mail_retry', {
    p_email: input.email, p_redirect_to: input.redirectTo, p_data: input.data ?? {}, p_kind: input.kind, p_error: input.code,
  });
  if (error) {
    console.error('[auth-mail-retry] Queue failed:', error.message);
    return { ok: false, code: input.code };
  }
  return { ok: false, code: input.code, queued: true };
}

/** Cron worker: delivers due parked mails; never throws. */
export async function runAuthMailRetries(db: SupabaseClient = createAdminClient()): Promise<{ processed: number; errors: number }> {
  const { data: claimed, error } = await db.rpc('claim_auth_mail_retries', { p_limit: 20 });
  if (error) {
    console.error('[auth-mail-retry] Claim failed:', error.message);
    return { processed: 0, errors: 1 };
  }
  let processed = 0, errors = 0;
  for (const row of (claimed ?? []) as Array<{ id: string; email: string; redirect_to: string; data: Record<string, string | Record<string, string>>; attempts: number; kind: string }>) {
    let purchaseReady = true;
    if (row.kind === 'post_checkout') {
      const destination = new URL(row.redirect_to).searchParams.get('redirect_to') ?? '';
      const target = new URL(destination, 'http://local.invalid');
      const slug = target.searchParams.get('product') ?? target.pathname.match(/^\/(?:pl\/|en\/)?p\/([^/?]+)/)?.[1];
      if (slug) {
        const context: Record<string, string> = await eventMailForSlug(row.email, slug, row.data.locale === 'pl' ? 'pl' : 'en')
          .catch(() => ({ purchase_mail_pending: 'true' }));
        if (context.license_mail_managed === 'true' && await readBuyerEmailPolicy(db) === true) {
          await db.from('auth_mail_retries').delete().eq('id', row.id);
          processed++;
          continue;
        }
        if (context.purchase_mail_pending === 'true') purchaseReady = false;
        row.data = { ...row.data, ...context };
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
    const result: MagicLinkResult = !purchaseReady ? { ok: false, code: 'send_failed' } : await deliverMagicLink({ email: row.email, redirectTo: row.redirect_to, shouldCreateUser: true, transactionalOnly: row.kind === 'license', data: row.data });
    // Purchase data (e.g. a license key) must not linger in the account once the mail was rendered.
    const cleared = await db.rpc('prepare_event_mail', { p_email: row.email, p_data: { locale: row.data.locale === 'pl' ? 'pl' : 'en' } });
    if (cleared.error) console.error('[auth-mail-retry] Account data cleanup failed');
    if (result.ok) {
      await db.from('auth_mail_retries').delete().eq('id', row.id);
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
