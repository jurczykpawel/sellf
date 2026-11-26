import type { FrameLocator, Locator, Page } from '@playwright/test';

/**
 * Pay as a guest: decline Stripe Link's "save my info" and, when the form still asks for a mobile number, fill one.
 * On GitHub runners (US egress) Link's sign-up is pre-checked and its phone field is required, so a card-only
 * submit never navigates (stripe-live and J171 in GHA 45752263064; Sellf creates sessions with
 * phone_number_collection disabled). Call it after the card fields are filled; it does nothing when neither shows.
 */
export async function declineLinkSignup(scope: Page | FrameLocator | Locator): Promise<void> {
  const optIn = scope.locator('input[name="linkOptIn"]').first();
  if (await optIn.isVisible().catch(() => false)) {
    if (await optIn.isChecked().catch(() => false)) await optIn.uncheck();
    return;
  }
  const phone = scope.getByRole('textbox', { name: /mobile number|phone number|numer telefonu/i }).first();
  if (await phone.isVisible().catch(() => false)) await phone.fill('2015550123');
}
