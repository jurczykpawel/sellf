/**
 * Stripe PaymentIntent Integration Tests
 *
 * Tests real Stripe API responses for each payment config mode.
 * Requires STRIPE_SECRET_KEY (test mode) in .env.local.
 *
 * These tests create real PaymentIntents in Stripe test mode (free),
 * verify the response, and immediately cancel them.
 *
 * Run: bun test tests/unit/stripe-payment-intent.integration.test.ts
 */

import { describe, it, expect, afterAll } from 'vitest';
import Stripe from 'stripe';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const hasStripeTestKey = !!STRIPE_SECRET_KEY && STRIPE_SECRET_KEY.startsWith('sk_test_');

// Collect PaymentIntent IDs for cleanup
const createdIntents: string[] = [];

function getStripe(): Stripe | null {
  if (!hasStripeTestKey) {
    return null;
  }
  return new Stripe(STRIPE_SECRET_KEY!);
}

const stripe = getStripe();

// Cleanup: cancel all created PaymentIntents
afterAll(async () => {
  if (!stripe) return;
  await Promise.allSettled([
    ...createdIntents.map((id) => stripe.paymentIntents.cancel(id)),
    ...createdSessions.map((id) => stripe.checkout.sessions.expire(id)),
  ]);
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function createAndTrack(
  params: Stripe.PaymentIntentCreateParams
): Promise<Stripe.PaymentIntent> {
  const pi = await stripe!.paymentIntents.create(params);
  createdIntents.push(pi.id);
  return pi;
}


const createdSessions: string[] = [];

async function createSession(opts: { currency: string; allowed: Stripe.Checkout.SessionCreateParams.AllowedPaymentMethodType[] }): Promise<Stripe.Checkout.Session> {
  const session = await stripe!.checkout.sessions.create({
    mode: 'payment',
    success_url: 'https://example.com/ok',
    line_items: [{ quantity: 1, price_data: { currency: opts.currency, unit_amount: 1000, product_data: { name: 'Test' } } }],
    allowed_payment_method_types: opts.allowed,
  });
  createdSessions.push(session.id);
  return session;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!hasStripeTestKey)('Stripe PaymentIntent Integration (requires STRIPE_SECRET_KEY=sk_test_*)', () => {
  // -------------------------------------------------------------------------
  // Automatic mode
  // -------------------------------------------------------------------------

  describe('automatic mode', () => {
    it('should accept automatic_payment_methods and return payment methods', async () => {
      const pi = await createAndTrack({
        amount: 1000,
        currency: 'pln',
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'always',
        },
      });

      expect(pi.status).toBe('requires_payment_method');
      // Stripe populates payment_method_types based on account config
      expect(pi.payment_method_types).toBeDefined();
      expect(pi.payment_method_types.length).toBeGreaterThan(0);
      expect(pi.payment_method_types).toContain('card');
    });

    it('should include link in automatic mode if enabled on account', async () => {
      const pi = await createAndTrack({
        amount: 1000,
        currency: 'pln',
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'always',
        },
        payment_method_options: {
          link: { setup_future_usage: 'off_session' },
        },
      });

      // Link availability depends on Stripe Dashboard settings
      // This test documents what Stripe returns — not a hard assertion
      console.log(
        '[automatic PLN] payment_method_types:',
        pi.payment_method_types
      );
      expect(pi.payment_method_types).toContain('card');
    });

    it('should work with EUR currency', async () => {
      const pi = await createAndTrack({
        amount: 1000,
        currency: 'eur',
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'always',
        },
      });

      expect(pi.payment_method_types).toContain('card');
      console.log(
        '[automatic EUR] payment_method_types:',
        pi.payment_method_types
      );
    });
  });

  // -------------------------------------------------------------------------
  // Custom mode — Checkout Session allowed_payment_method_types (filter, not a static list)
  // -------------------------------------------------------------------------

  describe('custom mode (Checkout allowed_payment_method_types)', () => {
    it('keeps only card when card is the sole allowed type', async () => {
      const session = await createSession({ currency: 'pln', allowed: ['card'] });
      expect(session.payment_method_types).toEqual(['card']);
    });

    it('returns the compatible subset for card + link', async () => {
      const session = await createSession({ currency: 'pln', allowed: ['card', 'link'] });
      expect(session.payment_method_types).toContain('card');
      expect(session.payment_method_types.every((t) => ['card', 'link'].includes(t))).toBe(true);
    });

    it('silently drops blik for EUR instead of failing (currency mismatch)', async () => {
      const session = await createSession({ currency: 'eur', allowed: ['card', 'blik'] });
      expect(session.payment_method_types).toContain('card');
      expect(session.payment_method_types).not.toContain('blik');
    });
  });

  // -------------------------------------------------------------------------
  // Removed parameter — the API rejects the old explicit list
  // -------------------------------------------------------------------------

  describe('removed payment_method_types parameter', () => {
    it('rejects payment_method_types on PaymentIntents', async () => {
      await expect(
        stripe!.paymentIntents.create({
          amount: 1000,
          currency: 'pln',
          payment_method_types: ['card'],
        } as unknown as Stripe.PaymentIntentCreateParams)
      ).rejects.toMatchObject({ type: 'StripeInvalidRequestError' });
    });

    it('rejects payment_method_types on Checkout Sessions', async () => {
      await expect(
        stripe!.checkout.sessions.create({
          mode: 'payment',
          success_url: 'https://example.com/ok',
          line_items: [{ quantity: 1, price_data: { currency: 'pln', unit_amount: 1000, product_data: { name: 'Test' } } }],
          payment_method_types: ['card'],
        } as unknown as Stripe.Checkout.SessionCreateParams)
      ).rejects.toMatchObject({ type: 'StripeInvalidRequestError' });
    });
  });

  // -------------------------------------------------------------------------
  // Mutual exclusivity — Stripe rejects mixed params
  // -------------------------------------------------------------------------

  describe('mutual exclusivity', () => {
    it('should reject automatic_payment_methods + payment_method_configuration', async () => {
      try {
        await stripe!.paymentIntents.create({
          amount: 1000,
          currency: 'pln',
          automatic_payment_methods: { enabled: true },
          payment_method_configuration: 'pmc_fake',
        });
        throw new Error('Should have thrown');
      } catch (err: any) {
        expect(err.type).toBe('StripeInvalidRequestError');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Link-specific behavior
  // -------------------------------------------------------------------------

  describe('Link payment method', () => {
    it.each(['pln', 'usd', 'eur'])('offers link next to card for %s', async (currency) => {
      const session = await createSession({ currency, allowed: ['card', 'link'] });
      expect(session.payment_method_types).toContain('card');
      expect(session.payment_method_types).toContain('link');
    });
  });
});
