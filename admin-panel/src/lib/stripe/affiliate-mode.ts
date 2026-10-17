/** Current payment configuration for affiliate accounting. @see server.ts */
import 'server-only';
import { getDecryptedStripeKeyInternal } from '@/lib/stripe/internal-config';
import { getStripeMode } from '@/lib/stripe/server';

export async function getAffiliateLivemode(): Promise<boolean> {
  const key = await getDecryptedStripeKeyInternal(getStripeMode()) ?? process.env.STRIPE_SECRET_KEY;
  const mode = key && /^(?:sk|rk)_(live|test)_/.exec(key)?.[1];
  if (!mode) throw new Error('Stripe configuration unavailable');
  return mode === 'live';
}
