/** Issuing product licenses lives with sales handling, not next to Sellf's own license. */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => resolve(__dirname, '../../../src', p);

describe('license issuance placement @J193', () => {
  it('settings no longer render issued product licenses @J193', () => {
    expect(readFileSync(src('components/settings/SettingsTabs.tsx'), 'utf-8')).not.toContain('IssuedLicensesSettings');
  });
  it('a sales-section licenses page renders them for platform admins, prefilled from the URL', () => {
    const page = src('app/[locale]/dashboard/licenses/page.tsx');
    expect(existsSync(page)).toBe(true);
    const body = readFileSync(page, "utf-8") + readFileSync(src("components/admin/LicensesPageContent.tsx"), "utf-8");
    expect(body).toContain('verifyAdminAccess');
    expect(body).toContain('IssuedLicensesSettings');
    expect(body).toMatch(/initialEmail/);
  });
  it('order details link to issuing a license for that buyer and product', () => {
    const table = readFileSync(src('components/admin/PaymentTransactionsTable.tsx'), 'utf-8');
    expect(table).toContain('/dashboard/licenses?');
  });
});
