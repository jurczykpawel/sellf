import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { readBuyerEmailPolicy } from './buyer-email-policy';
import type { MagicLinkResult } from './types';

export interface DeliverMagicLinkInput {
  transactionalOnly?: boolean;
  email: string;
  redirectTo: string;
  shouldCreateUser: boolean;
  data?: Record<string, string | Record<string, string>>;
}

// Service-role client: Supabase Auth skips its own captcha for admin credentials,
// so every caller MUST have verified a captcha or a paid Stripe session first.
export async function deliverMagicLink(input: DeliverMagicLinkInput): Promise<MagicLinkResult> {
  try {
    const client = createAdminClient();
    const redirect = new URL(input.redirectTo);
    const destination = redirect.searchParams.get('redirect_to') ?? redirect.pathname;
    const enabled = await readBuyerEmailPolicy(client);
    if (enabled === null) return { ok: false, code: 'send_failed' };
    if (!enabled && input.transactionalOnly) return { ok: true, skipped: true };
    const data = { ...(enabled ? input.data : {}), locale: input.data?.locale === 'pl' || (!input.data?.locale && destination.startsWith('/pl/')) ? 'pl' : 'en' };
    const prepared = await client.rpc('prepare_event_mail', { p_email: input.email, p_data: data });
    if (prepared.error) return { ok: false, code: 'send_failed' };
    const { error } = await client.auth.signInWithOtp({
      email: input.email,
      options: {
        shouldCreateUser: input.shouldCreateUser,
        emailRedirectTo: input.redirectTo,
        data,
      },
    });
    if (!error) return { ok: true };
    console.error(`[magic-link] send failed: status=${error.status ?? 'n/a'} code=${error.code ?? 'n/a'}`);
    return { ok: false, code: error.status === 429 ? 'rate_limited' : 'send_failed' };
  } catch {
    console.error('[magic-link] send unavailable');
    return { ok: false, code: 'send_failed' };
  }
}
