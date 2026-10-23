/** Server-side profile checks for product mutations. @see ./profile.ts */
import { parseCheckoutProfile } from '@/lib/checkout-modules/profile';
import { getDecryptedGUSAPIKeyInternal } from '@/lib/integrations/internal-secrets';
export async function checkoutProfileErrors(product: Record<string, unknown>): Promise<string[]> {
  if (product.checkout_profile == null) return [];
  const parsed = parseCheckoutProfile(product.checkout_profile, product, true);
  if (!parsed.success) return parsed.error.issues.map(i => `checkout_profile: ${i.message}`);
  if (parsed.data.modules.some(m => m.id === 'buyer' && m.gus) && !await getDecryptedGUSAPIKeyInternal()) return ['checkout_profile: gus_required'];
  return [];
}
