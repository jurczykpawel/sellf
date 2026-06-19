/**
 * Whether to render Sellf's own ToS <TermsCheckbox> on an Elements (Sellf-drawn)
 * checkout surface. Mirrors the server rule (applyTosConsent): consent is
 * collected iff the single setting `collect_terms_of_service` is on. On the
 * storefront we only show it to guests — logged-in buyers accepted at signup.
 */
export function shouldShowTosCheckbox(
  collectTermsOfService: boolean,
  isGuest: boolean,
): boolean {
  return collectTermsOfService && isGuest;
}
