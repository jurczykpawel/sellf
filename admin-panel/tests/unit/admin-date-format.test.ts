import { expect, it } from 'vitest';
import { formatAdminDate } from '@/lib/timezone';
it('uses one locale-aware calendar style for payment timestamps and dates', () => {
  expect(formatAdminDate('2026-10-17T12:00:00Z', 'pl', false)).toBe('17 paź 2026');
  expect(formatAdminDate('2026-10-17T12:00:00Z', 'en', false)).toBe('Oct 17, 2026');
  expect(formatAdminDate('2026-06-25T12:00:00Z', 'pl')).toContain('25 cze 2026');
  expect(formatAdminDate(null, 'pl')).toBe('—');
  expect(formatAdminDate('invalid', 'pl')).toBe('—');
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ADMIN_DATE_SCREENS = [
  'components/webhooks/WebhookLogsTable.tsx', 'components/UsersTable.tsx', 'components/UserDetailsModal.tsx',
  'components/AccessManagementModal.tsx', 'components/ApiKeysPageContent.tsx', 'components/CouponsPageContent.tsx',
  'components/ProductsTable.tsx', 'components/storefront/TemplateHistory.tsx',
  'components/settings/SecurityAuditSettings.tsx', 'components/settings/StripeSettings.tsx',
  'components/settings/CurrencySettings.tsx', 'components/settings/IssuedLicensesSettings.tsx',
];
it.each(ADMIN_DATE_SCREENS)('%s renders dates only through formatAdminDate', (file) => {
  const source = readFileSync(join(__dirname, '../../src', file), 'utf8');
  expect(source).toContain('formatAdminDate');
  expect(source).not.toMatch(/new Date\([^)]*\)\.toLocale(Date)?String\(/);
  expect(source).not.toMatch(/new Date\([^)]*\)\)\.toLocale|DateTimeFormat\(undefined/);
  expect(source).not.toContain('formatUTCForDisplay');
});
