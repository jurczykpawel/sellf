'use client';

import { loadStripe, type Stripe } from '@stripe/stripe-js';

const stripePromiseCache = new Map<string, Promise<Stripe | null>>();

export function getStripeClient(publishableKey: string): Promise<Stripe | null> {
  const cached = stripePromiseCache.get(publishableKey);
  if (cached) return cached;

  const stripePromise = loadStripe(publishableKey);
  stripePromiseCache.set(publishableKey, stripePromise);
  return stripePromise;
}
