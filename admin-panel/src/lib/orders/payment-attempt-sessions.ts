/**
 * Close the Stripe payment pages of online payment attempts that the database has just superseded (the order was
 * cancelled, released by the timer or marked paid). The duplicate refund in quick-pay.ts remains the safety net.
 * @see migration 20261118000000_release_2026_11_1.sql (expire_sessions)
 */
import type Stripe from 'stripe';

/** Expire the Stripe payment pages of attempts the database just closed. The duplicate refund remains the safety net. */
export async function expireOrderPaymentSessions(stripe: () => Promise<Stripe>, sessionIds: readonly string[]): Promise<{ expired: string[]; failed: string[] }> {
  const expired: string[] = [], failed: string[] = [];
  if (!sessionIds.length) return { expired, failed };
  const client = await stripe();
  for (const sessionId of sessionIds) {
    try { await client.checkout.sessions.expire(sessionId); expired.push(sessionId); }
    catch (error) {
      failed.push(sessionId);
      console.error('[quick-pay] Session not expired (a late payment is refunded):', sessionId, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  return { expired, failed };
}

/** Session ids returned by a database operation that closed an order (expire_sessions). */
export function sessionsToExpire(result: unknown): string[] {
  const value = result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>).expire_sessions : undefined;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && /^cs_(test|live)_[A-Za-z0-9]+$/.test(v)) : [];
}
