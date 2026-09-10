import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { MagicLinkResult } from './types';

export interface DeliverMagicLinkInput {
  email: string;
  redirectTo: string;
  shouldCreateUser: boolean;
  data?: Record<string, string>;
}

// Service-role client: Supabase Auth skips its own captcha for admin credentials,
// so every caller MUST have verified a captcha or a paid Stripe session first.
export async function deliverMagicLink(input: DeliverMagicLinkInput): Promise<MagicLinkResult> {
  try {
    const { error } = await createAdminClient().auth.signInWithOtp({
      email: input.email,
      options: {
        shouldCreateUser: input.shouldCreateUser,
        emailRedirectTo: input.redirectTo,
        ...(input.data ? { data: input.data } : {}),
      },
    });
    if (!error) return { ok: true };
    console.error(`[magic-link] send failed: status=${error.status ?? 'n/a'} code=${error.code ?? 'n/a'}`);
    return { ok: false, code: error.status === 429 ? 'rate_limited' : 'send_failed' };
  } catch (err) {
    console.error('[magic-link] send threw:', err instanceof Error ? err.message : 'Unknown error');
    return { ok: false, code: 'send_failed' };
  }
}
