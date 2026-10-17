/** Locale-aware dates and relative times. @see lib/utils/relative-time.ts */
import { expect, it } from 'vitest';
import { formatRelativeTime } from '@/lib/utils/relative-time';
it('formats the last-order age in the panel language', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const past = new Date(now - 113 * 86400000).toISOString();
  expect(formatRelativeTime(past, 'pl', now)).toBe('113 dni temu');
  expect(formatRelativeTime(past, 'en', now)).toBe('113 days ago');
});

it('uses the current locale for account and payment table timestamps', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['UsersTable.tsx', 'UserDetailsModal.tsx', 'AccessManagementModal.tsx', 'admin/PaymentTransactionsTable.tsx', 'admin/PaymentSessionsTable.tsx', 'webhooks/WebhookLogsTable.tsx']) {
    const source = readFileSync(`src/components/${file}`, 'utf8');
    expect(source).not.toContain("toLocaleDateString('en-US'");
    expect(source).not.toContain('toLocaleString()');
  }
});

it('uses the panel locale for product availability and creation dates', async () => {
  const { formatUTCForDisplay } = await import('@/lib/timezone');
  expect(formatUTCForDisplay('2026-10-17T12:00:00Z', { month: 'short' }, 'pl')).toContain('paź');
});
