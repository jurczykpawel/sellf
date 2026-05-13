import { expect } from '@playwright/test';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error('Missing STRIPE_SECRET_KEY for Stripe checkout tests');
}

export async function getStripeCheckoutSession(sessionId: string) {
  expect(sessionId, 'Expected create-payment-intent to return checkoutSessionId').toBeTruthy();

  const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  expect(sessionRes.ok, `Stripe checkout session fetch failed: ${sessionRes.status}`).toBeTruthy();
  const session = await sessionRes.json();

  const lineItemsRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  expect(lineItemsRes.ok, `Stripe checkout session line items fetch failed: ${lineItemsRes.status}`).toBeTruthy();
  const lineItems = await lineItemsRes.json();

  return { session, lineItems: lineItems.data };
}
