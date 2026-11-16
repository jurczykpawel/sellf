/**
 * Fills the standard checkout invoice section for an organization buyer (one NIP / EU VAT field,
 * then the address block). GUS is answered with "not found", so the company data is typed in and
 * the result does not depend on the GUS test service.
 *
 * @see src/components/checkout/InvoiceSection.tsx
 */
import { expect, type Page } from '@playwright/test';

export interface InvoiceParty {
  nip: string;
  companyName: string;
  address: string;
  postalCode: string;
  city: string;
}

export const TEST_INVOICE_PARTY: InvoiceParty = {
  nip: '5260250274', companyName: 'Testowa firma', address: 'Prosta 1', postalCode: '00-001', city: 'Warszawa',
};

/** Call before the checkout page loads. */
export async function mockGusNotFound(page: Page): Promise<void> {
  await page.route('**/api/gus/fetch-company-data', route => route.fulfill({ status: 404, json: { success: false, code: 'NOT_FOUND' } }));
}

export async function fillInvoiceParty(page: Page, party: InvoiceParty = TEST_INVOICE_PARTY): Promise<void> {
  await page.locator('#nip').fill(party.nip);
  await expect(page.locator('#companyName')).toBeVisible();
  for (const id of ['companyName', 'address', 'postalCode', 'city'] as const) await page.locator(`#${id}`).fill(party[id]);
}
