/** Shared submit-time module gate. @see app/api/update-payment-metadata/route.ts */
import { checkoutProfileSchema } from '@/lib/checkout-modules/profile';
import { validateModuleValues } from '@/lib/checkout-modules/registry';
export function validateCheckoutModules(profile: unknown, values: unknown,
  context: { locale: string; currency: string; termsAccepted: unknown }) {
  const parsed = checkoutProfileSchema.safeParse(profile);
  if (!parsed.success) return { success: false as const, status: 500, errors: [{ field: 'profile', code: 'invalid_configuration' }] };
  const quantity = values && typeof values === 'object' && 'quantity' in values ? values.quantity : 1;
  const result = validateModuleValues(parsed.data, values, {
    locale: context.locale === 'pl' ? 'pl' : 'en', currency: context.currency, quantity: quantity as number,
  });
  if (!result.success) return { ...result, status: 422 };
  const buyer = result.details.buyer;
  if (buyer && typeof buyer === 'object' && !Array.isArray(buyer)) buyer.terms_accepted = context.termsAccepted === true;
  return { ...result, quantity: quantity as number };
}
