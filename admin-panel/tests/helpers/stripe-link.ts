import type { FrameLocator, Locator, Page } from '@playwright/test';

/**
 * Pay as a guest: decline Stripe Link's "save my info" and fill the phone number and a postal code (for the chosen country) if they are still asked.
 * On GitHub runners (US egress) Link's sign-up is pre-checked (`aria-checked="true"`, GHA 45771905474) and its mobile
 * number is required (embedded checkout: ZIP the only invalid field, GHA 45789589536), so a card-only submit never navigates (Sellf creates sessions with phone_number_collection
 * disabled). Stripe's checkbox input ignores a plain click on some forms ("did not change its state"), so the label
 * is the fallback and the phone number the last resort. Call it after the card fields are filled; it does nothing
 * when neither shows.
 */
export async function declineLinkSignup(scope: Page | FrameLocator | Locator): Promise<void> {
  // Every call is bounded: the config sets no action timeout, so an unbounded wait here would hold a test until its
  // whole timeout (GHA 45865268794: an `inputValue()` on a missing country field stalled six tests for 300 s each).
  const bound = { timeout: 3000 };
  const optIn = scope.locator('input[name="linkOptIn"]').first();
  const checked = async () => (await optIn.isVisible().catch(() => false)) && (await optIn.isChecked(bound).catch(() => false));
  if (await checked()) {
    await optIn.uncheck({ timeout: 5000 }).catch(() => undefined);
    if (await checked()) await scope.locator('label[for$="linkOptInInput"]').first().click({ timeout: 5000 }).catch(() => undefined);
  }
  const phone = scope.getByRole('textbox', { name: /mobile number|phone number|numer telefonu/i }).first();
  if (await phone.isVisible().catch(() => false)) await phone.fill('2015550123', bound).catch(() => undefined);
  const postal = scope.locator('input[name="postalCode"], input[name="billingPostalCode"]').or(scope.getByRole('textbox', { name: /^ZIP/i })).first();
  if (await postal.isVisible().catch(() => false)) {
    const empty = !(await postal.inputValue(bound).catch(() => 'x'));
    if (empty || (await postal.getAttribute('aria-invalid', bound).catch(() => null)) === 'true') {
      const field = scope.locator('select[name="country"], input[name="country"]').first();
      const country = (await field.count()) ? await field.inputValue(bound).catch(() => '') : '';
      await postal.fill(POSTAL_CODES[country] ?? POSTAL_CODES.US, bound).catch(() => undefined);
    }
  }
}

const POSTAL_CODES: Record<string, string> = { US: '10001', PL: '00-001', GB: 'SW1A 1AA', DE: '10115' };

/**
 * Names (never values) of the visible form controls of a Stripe form, `!` marking invalid ones, plus the chosen
 * country code: the run log is public and keeps no trace, so a stuck form has to be described in its error message.
 */
export async function describeStripeForm(scope: Page | FrameLocator | Locator): Promise<string> {
  const fields = await scope.locator('input, select').evaluateAll(
    elements => elements.filter(element => element.getClientRects().length).map(element => {
      const name = element.getAttribute('name') ?? element.getAttribute('type');
      const mark = element.getAttribute('aria-invalid') === 'true' ? '!' : '';
      return `${name}${mark}${name === 'country' ? `=${(element as HTMLSelectElement | HTMLInputElement).value}` : ''}`;
    }),
  ).catch(() => []);
  return fields.join(', ');
}
