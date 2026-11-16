/** Product form navigation: sections are switched from the form's section list. */
import { expect, type Page } from '@playwright/test';

const SECTION_NAV = /Sekcje produktu|Product sections/;

/** Section button in the open product form (title as shown, e.g. "Dane w koszyku"). */
export function formSectionButton(page: Page, title: string | RegExp) {
  return page.getByRole('dialog').getByRole('navigation', { name: SECTION_NAV }).getByRole('button', { name: title });
}

/** Shows a product form section and waits until it is the current one. */
export async function openFormSection(page: Page, title: string | RegExp) {
  const button = formSectionButton(page, title);
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'true');
}
