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

const paymentFiltersSource = readFileSync(
  resolve(__dirname, '../../src/components/admin/PaymentFilters.tsx'),
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

  it('sends the status and search filters to the server instead of only filtering the loaded page', () => {
    // The transactions list must be re-fetched with the filters applied server-side —
    // not sliced client-side from whatever page happened to already be loaded.
    expect(paymentsDashboardSource).toContain('fetchPaymentTransactionsPage(');
    expect(paymentsDashboardSource).toMatch(/status:\s*filters\.status/);
    expect(paymentsDashboardSource).toMatch(/search:\s*filters\.searchTerm/);
    // A stale client-side status/search filter over `transactions` would silently
    // hide server results outside whatever page happened to load first.
    expect(paymentsDashboardSource).not.toMatch(/filters\.status !== 'all' && transaction\.status/);
  });

  it('sends the date range filter to the server on fetch and load-more instead of leaving it decorative', () => {
    // The date-range dropdown had state, UI, and a chip, but nothing ever read it —
    // sellers picking "last 7 days" still saw everything. It must now be forwarded
    // on both the initial/refetch call and "Load more" so cursor pagination stays
    // within the same filtered result set.
    expect(paymentsDashboardSource).toMatch(/dateRange:\s*filters\.dateRange/);
    const dateRangeUsages = paymentsDashboardSource.match(/dateRange:\s*filters\.dateRange/g) ?? [];
    expect(dateRangeUsages.length).toBeGreaterThanOrEqual(2);
  });

  it('defaults the date range filter to "all" so opening the dashboard and searching still see every payment', () => {
    // Before the date-range filter was wired to the server, it was decorative,
    // so sellers effectively always saw ALL payments. A real 30-day default
    // would be a silent behavior change (payments older than 30 days vanish
    // on open, and server-side search — see da177bb9 — would stop finding an
    // older payment unless the seller first switches the range to "all").
    // Defaulting to "all" preserves prior behavior; a seller opts into a
    // narrower window explicitly.
    expect(paymentsDashboardSource).toMatch(/dateRange:\s*'all'/);
    expect(paymentsDashboardSource).not.toMatch(/dateRange:\s*'30'/);
    expect(paymentFiltersSource).toMatch(/dateRange:\s*'all'/);
    expect(paymentFiltersSource).not.toMatch(/dateRange:\s*'30'/);
  });

  it('only offers payment status filter values that can actually exist in the database', () => {
    // payment_transactions_status_check allows exactly these six values.
    for (const value of ['pending', 'completed', 'refunded', 'partially_refunded', 'disputed', 'abandoned']) {
      expect(paymentFiltersSource).toContain(`value="${value}"`);
    }
    // 'failed' and 'cancelled' can never occur on payment_transactions and
    // previously caused a 400 once the dropdown value reached the server.
    expect(paymentFiltersSource).not.toContain('value="failed"');
    expect(paymentFiltersSource).not.toContain('value="cancelled"');
  });

  it('debounces the search input before it triggers a server request', () => {
    expect(paymentFiltersSource).toMatch(/setTimeout/);
    expect(paymentFiltersSource).toMatch(/clearTimeout/);
  });

  it('defines translated labels for every real payment status in both languages', () => {
    for (const key of ['"partiallyRefunded"', '"abandoned"']) {
      expect(plMessagesSource).toContain(key);
      expect(enMessagesSource).toContain(key);
    }
    // Row-level status badges look up `statuses.<raw db value>` directly.
    for (const key of ['"partially_refunded"', '"abandoned"']) {
      expect(plMessagesSource).toContain(key);
      expect(enMessagesSource).toContain(key);
    }
  });
});
