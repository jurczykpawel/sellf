import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Consumes a captcha nonce exactly once.
 *
 * Inserts `nonceHash` into `public.captcha_nonces`; returns `true` only when
 * the row was newly inserted (first use). A conflict means the nonce was
 * already consumed — a replay.
 */
export async function consumeCaptchaNonce(nonceHash: string, expiresAt: Date): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .from('captcha_nonces')
      .upsert(
        { nonce_hash: nonceHash, expires_at: expiresAt.toISOString() },
        { onConflict: 'nonce_hash', ignoreDuplicates: true },
      )
      .select('nonce_hash');

    if (error) {
      console.error('[captcha] nonce store error:', error.message);
      return process.env.NODE_ENV === 'production' ? false : true;
    }

    // ignoreDuplicates: true returns no row when the nonce already existed.
    return (data?.length ?? 0) > 0;
  } catch (err) {
    console.error('[captcha] nonce store threw:', err instanceof Error ? err.message : 'Unknown error');
    return process.env.NODE_ENV === 'production' ? false : true;
  }
}
