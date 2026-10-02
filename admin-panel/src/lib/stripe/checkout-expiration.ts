/**
 * Close unpaid checkout sessions and reconcile their pending transactions.
 * @see src/app/api/create-payment-intent/route.ts
 * @see src/app/api/webhooks/stripe/route.ts
 */
import { verifyCheckoutBinding } from '@/lib/security/checkout-binding';
import type Stripe from 'stripe';
import type { createAdminClient } from '@/lib/supabase/admin';

interface ExpirationResult {
  success: boolean;
  error?: string;
  status?: number;
}

export async function abandonPendingCheckoutSession(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string,
): Promise<ExpirationResult> {
  try {
    const { error } = await supabase
      .from('payment_transactions')
      .update({ status: 'abandoned', updated_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .eq('status', 'pending');
    if (!error) return { success: true };
    console.error('[abandonPendingCheckoutSession] Update failed:', error);
  } catch (error) {
    console.error('[abandonPendingCheckoutSession] Request failed:', error instanceof Error ? error.message : 'Unknown error');
  }
  return { success: false, error: 'Unable to reconcile checkout session', status: 503 };
}

export async function expireBoundCheckoutSession(
  stripe: Stripe,
  supabase: ReturnType<typeof createAdminClient>,
  input: { clientSecret: unknown; bindingToken: unknown },
): Promise<ExpirationResult> {
  const sessionId = typeof input.clientSecret === 'string' ? input.clientSecret.split('_secret_')[0] : '';
  if (!/^cs_(test|live)_[a-zA-Z0-9]+$/.test(sessionId)) {
    return { success: false, error: 'Invalid checkout session format', status: 400 };
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const productId = session.metadata?.product_id;
    if (!productId || typeof input.bindingToken !== 'string' || !verifyCheckoutBinding(input.bindingToken, {
      stripeObjectId: sessionId,
      userId: session.metadata?.user_id || null,
      productId,
    })) {
      return { success: false, error: 'Invalid checkout binding', status: 403 };
    }
    if (session.status === 'complete') return { success: true };
    if (session.status === 'open') await stripe.checkout.sessions.expire(sessionId);
    return await abandonPendingCheckoutSession(supabase, sessionId);
  } catch (error) {
    console.error('[expireBoundCheckoutSession] Expiration failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'Unable to expire checkout session', status: 503 };
  }
}
