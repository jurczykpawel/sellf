import type { FrameLocator, Locator, Page } from '@playwright/test';

/**
 * Pay as a guest: decline Stripe Link's "save my info" and fill the phone number if it is still asked.
 * On GitHub runners (US egress) Link's sign-up is pre-checked (`aria-checked="true"`, GHA 45771905474) and its mobile
 * number is required, so a card-only submit never navigates (Sellf creates sessions with phone_number_collection
 * disabled). Stripe's checkbox input ignores a plain click on some forms ("did not change its state"), so the label
 * is the fallback and the phone number the last resort. Call it after the card fields are filled; it does nothing
 * when neither shows.
 */
export async function declineLinkSignup(scope: Page | FrameLocator | Locator): Promise<void> {
  const optIn = scope.locator('input[name="linkOptIn"]').first();
  const checked = async () => (await optIn.isVisible().catch(() => false)) && (await optIn.isChecked().catch(() => false));
  if (await checked()) {
    await optIn.uncheck({ timeout: 5000 }).catch(() => undefined);
    if (await checked()) await scope.locator('label[for$="linkOptInInput"]').first().click({ timeout: 5000 }).catch(() => undefined);
  }
  const phone = scope.getByRole('textbox', { name: /mobile number|phone number|numer telefonu/i }).first();
  if (await phone.isVisible().catch(() => false)) await phone.fill('2015550123');
}
