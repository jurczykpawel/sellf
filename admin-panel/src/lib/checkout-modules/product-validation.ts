/** Server-side profile checks for product mutations. @see ./profile.ts */
import { parseCheckoutProfile } from '@/lib/checkout-modules/profile';
export async function checkoutProfileErrors(product: Record<string, unknown>): Promise<string[]> {
  if (product.checkout_profile == null) return [];
  const parsed = parseCheckoutProfile(product.checkout_profile, product);
  if (!parsed.success) return parsed.error.issues.map(i => `checkout_profile: ${i.message}`);
  return [];
}
