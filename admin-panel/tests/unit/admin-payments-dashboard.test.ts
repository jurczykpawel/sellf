import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const statsRouteSource = readFileSync(
  resolve(__dirname, '../../src/app/api/v1/payments/stats/route.ts'),
  'utf-8'
);

const statsCardsSource = readFileSync(
  resolve(__dirname, '../../src/components/admin/PaymentStatsCards.tsx'),
  'utf-8'
);

const transactionsTableSource = readFileSync(
  resolve(__dirname, '../../src/components/admin/PaymentTransactionsTable.tsx'),
  'utf-8'
);

const paymentsRouteSource = readFileSync(
  resolve(__dirname, '../../src/app/api/v1/payments/route.ts'),
  'utf-8'
);

const paymentsDashboardSource = readFileSync(
  resolve(__dirname, '../../src/components/admin/PaymentsDashboard.tsx'),
  'utf-8'
);

const sidebarSource = readFileSync(
  resolve(__dirname, '../../src/components/DashboardLayout.tsx'),
  'utf-8'
);

const subscriptionHandlersSource = readFileSync(
  resolve(__dirname, '../../src/app/api/webhooks/stripe/subscription-handlers.ts'),
  'utf-8'
);

const plMessagesSource = readFileSync(
  resolve(__dirname, '../../src/messages/pl.json'),
  'utf-8'
);

const enMessagesSource = readFileSync(
  resolve(__dirname, '../../src/messages/en.json'),
  'utf-8'
);

describe('admin payments dashboard', () => {
  it('exposes the payments dashboard from the admin sidebar', () => {
    expect(sidebarSource).toContain("href: '/dashboard/payments'");
    expect(sidebarSource).toContain("label: t('payments')");
  });

  it('returns payment stats grouped by currency for conversion-aware totals', () => {
    expect(statsRouteSource).toContain('total_revenue_by_currency');
    expect(statsRouteSource).toContain('today_revenue_by_currency');
    expect(statsRouteSource).toContain('this_month_revenue_by_currency');
    expect(statsRouteSource).toContain('refunded_amount_by_currency');
    expect(statsRouteSource).toContain("select('amount, currency')");
    expect(statsRouteSource).toContain("select('refunded_amount, currency')");
  });

  it('uses the shared currency selector and conversion hook in the payments dashboard', () => {
    expect(paymentsDashboardSource).toContain("import CurrencySelector from '@/components/dashboard/CurrencySelector'");
    expect(paymentsDashboardSource).toContain('<CurrencySelector />');
    expect(statsCardsSource).toContain('useCurrencyConversion');
    expect(statsCardsSource).toContain('convertMultipleCurrencies');
  });

  it('guards payment dashboard search against nullable transaction fields', () => {
    expect(paymentsDashboardSource).toContain('fieldMatchesSearch');
    expect(paymentsDashboardSource).not.toContain('transaction.user_id.toLowerCase()');
    expect(paymentsDashboardSource).not.toContain('session.customer_email.toLowerCase()');
  });

  it('does not display hardcoded period deltas in payment stat cards', () => {
    expect(statsCardsSource).not.toContain('+15.3%');
    expect(statsCardsSource).not.toContain('+12.5%');
    expect(statsCardsSource).not.toContain('+22.1%');
    expect(statsCardsSource).not.toContain('-2.1%');
    expect(statsCardsSource).not.toContain('vsLastPeriod');
  });

  it('formats minor-unit transaction amounts as major-unit currency values', () => {
    expect(transactionsTableSource).toContain('format(amount / 100)');
    expect(statsCardsSource).toContain('format(amount / 100)');
  });

  it('shows readable customers and transaction line item details in the payments table', () => {
    expect(paymentsRouteSource).toContain(".from('payment_line_items')");
    expect(paymentsRouteSource).toContain('line_items: lineItemsByTransactionId.get(p.id) ?? []');
    expect(transactionsTableSource).toContain('transaction.customer_email');
    expect(transactionsTableSource).toContain('detailsTransaction');
    expect(transactionsTableSource).toContain('getTransactionDisplayItems');
  });

  it('formats transaction line items as current major-unit amounts, not minor-unit transaction totals', () => {
    expect(transactionsTableSource).toContain('formatMajorCurrency');
    expect(transactionsTableSource).toContain('total_price: transaction.amount / 100');
    expect(transactionsTableSource).toContain('formatMajorCurrency(item.total_price');
    expect(transactionsTableSource).not.toContain('formatCurrency(item.total_price');
    expect(transactionsTableSource).not.toContain('areLineItemAmountsStoredAsMinorUnits');
    expect(transactionsTableSource).not.toContain('metadata?.is_pwyw');
  });

  it('defines all payment transaction detail labels used by the modal', () => {
    const requiredKeys = ['"subtotal"', '"paid"', '"total"', '"refundedTotal"', '"remaining"'];

    for (const key of requiredKeys) {
      expect(plMessagesSource).toContain(key);
      expect(enMessagesSource).toContain(key);
    }
  });

  it('stores subscription payment transaction amounts in minor units like one-time payments', () => {
    expect(subscriptionHandlersSource).toContain('amount: invoice.amount_paid ?? 0');
    expect(subscriptionHandlersSource).not.toContain('amount: (invoice.amount_paid ?? 0) / 100');
  });
});
