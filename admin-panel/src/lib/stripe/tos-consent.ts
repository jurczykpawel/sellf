/**
 * Single source of truth for Stripe Terms-of-Service consent collection.
 *
 * Rule: set `consent_collection.terms_of_service = 'required'` ONLY for
 * Stripe-rendered checkouts (`ui_mode` embedded / embedded_page / hosted),
 * because Stripe draws the consent checkbox itself there. For `ui_mode:
 * 'elements'` the cart is rendered by Sellf, which collects consent via its
 * own <TermsCheckbox> (gated on the same setting) — so we must NOT set
 * consent_collection, which would otherwise require a ToS URL in the Stripe
 * Dashboard and 400 the session.
 */
type TosSessionConfig = {
  ui_mode?: string;
  consent_collection?: { terms_of_service: 'required' | 'none' };
};

export function applyTosConsent(
  sessionConfig: TosSessionConfig,
  checkoutConfig: { collect_terms_of_service: boolean },
): void {
  if (!checkoutConfig.collect_terms_of_service) return;
  if (sessionConfig.ui_mode === 'elements') return;
  sessionConfig.consent_collection = { terms_of_service: 'required' };
}
