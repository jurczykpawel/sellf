/** Recorded trial completion must direct a new buyer to their first confirmation email. */
import { expect, it, vi } from 'vitest';
import { verifyPaymentSession, mapVerifiedPaymentToStatus } from '@/lib/payment/verify-payment';
import recording from '../../fixtures/stripe/trial-first-mail-checkout.json';

vi.mock('@/lib/stripe/server', () => ({ getStripeServer: async () => ({ checkout: { sessions: { retrieve: async () => recording } } }) }));
it('offers the first confirmation link for a completed zero-charge trial without requiring a one-time purchase', async () => {
  expect(recording.livemode).toBe(false);
  const result = await verifyPaymentSession(recording.id);
  expect(result.error).toBeUndefined();
  expect(result.customer_email).toBe('trial-recording@example.com');
  expect(result).toMatchObject({ scenario: 'subscription_guest', access_granted: false, send_magic_link: true, requires_login: true });
  expect(mapVerifiedPaymentToStatus(result)).toEqual({ paymentStatus: 'magic_link_sent', accessGranted: false, errorMessage: '' });
  expect(recording).not.toHaveProperty('payment_intent');
  expect(recording).not.toHaveProperty('subscription');
});
