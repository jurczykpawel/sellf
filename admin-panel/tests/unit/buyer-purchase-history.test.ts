// @vitest-environment happy-dom
/** Buyer history uses saved payment totals and completed refund information.
 * @see src/lib/purchases/line-items.ts
 */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyPurchasesPage from '@/app/[locale]/my-purchases/page';
import { formatPrice } from '@/lib/constants';
import { formatAdminDate } from '@/lib/timezone';
import { hasMixedRefundPolicies, normalizePurchaseLineItems, requiresManualRefundReview } from '@/lib/purchases/line-items';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { PurchaseLineItem } from '@/lib/purchases/line-items';

const fixture = vi.hoisted(() => ({ status: 'completed', refundable: false, coupon: '10%' }));
const rows: PurchaseLineItem[] = [
  { id: 'main', transaction_id: 'tx', product_id: 'main', item_type: 'main_product', product_name: 'Main line', quantity: 1,
    total_price: 100, discounted_total: 90, net_amount: 9000, tax_amount: 2070, tax_behavior: 'exclusive', vat_rate: 23, currency: 'PLN' },
  { id: 'bump', transaction_id: 'tx', product_id: 'bump', item_type: 'order_bump', product_name: 'Bump line', quantity: 1,
    total_price: 19, discounted_total: 19, net_amount: 1900, tax_amount: 0, tax_behavior: 'inclusive', vat_rate: 0, currency: 'PLN' },
];
const date = '2026-10-18T12:00:00Z';
const refundDate = '2026-10-21T12:00:00Z';

vi.mock('@/components/DashboardLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/MySubscriptions', () => ({ default: () => null }));
vi.mock('@/contexts/AuthContext', () => {
  const user = { id: 'buyer', email: 'buyer@example.com' };
  return { useAuth: () => ({ user, loading: false }) };
});
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  rpc: async () => ({ data: [{ transaction_id: 'tx', product_name: 'Order', purchase_date: date, amount: 12970, currency: 'PLN',
    status: fixture.status, is_refundable: fixture.refundable, refund_eligible: false, refund_request_status: null,
    refunded_amount: fixture.status === 'refunded' ? 12970 : 0 }] }),
  from: (table: string) => ({ select: (columns: string) => ({ in: async () => {
    const records = table === 'payment_line_items' ? rows : table === 'products'
      ? rows.map(row => ({ id: row.product_id, is_refundable: fixture.refundable, refund_period_days: null }))
      : [{ id: 'tx', metadata: { coupon_discount: fixture.coupon }, refunded_at: refundDate }];
    return { data: records.map(record => Object.fromEntries(columns.split(',').map(key => [key.trim(), record[key.trim() as keyof typeof record]]))) };
  } }) }),
}) }));

beforeEach(() => {
  fixture.status = 'completed'; fixture.refundable = false; fixture.coupon = '10%';
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function showPage(locale: 'pl' | 'en') {
  const messages = locale === 'pl' ? pl : en;
  render(React.createElement(NextIntlClientProvider, { locale, messages, timeZone: 'UTC' }, React.createElement(MyPurchasesPage)));
  return messages.myPurchases;
}

function normalized(policies: Array<{ is_refundable: boolean; refund_period_days: number | null }>, status = 'completed') {
  return normalizePurchaseLineItems(policies.map((product, index) => ({ ...rows[index % 2], id: String(index), product })), date, status);
}

describe('buyer purchase history', () => {
  it('uses a distinct completed-refund state', () => {
    expect(normalized([{ is_refundable: true, refund_period_days: null }], 'refunded')[0].refundState).toBe('refunded');
  });
  it.each([false, true])('does not request manual review for identical policies: refundable=%s', refundable => {
    const items = normalized(Array.from({ length: 2 }, () => ({ is_refundable: refundable, refund_period_days: 14 })));
    expect(hasMixedRefundPolicies(items)).toBe(false);
    expect(requiresManualRefundReview(items)).toBe(false);
  });
  it('detects different refund periods even when both products are eligible', () => {
    const items = normalized([{ is_refundable: true, refund_period_days: 14 }, { is_refundable: true, refund_period_days: 30 }]);
    expect(hasMixedRefundPolicies(items)).toBe(true);
    expect(requiresManualRefundReview(items)).toBe(true);
  });
  it('ignores unused refund periods on non-refundable products', () => {
    expect(hasMixedRefundPolicies(normalized([{ is_refundable: false, refund_period_days: 14 }, { is_refundable: false, refund_period_days: null }]))).toBe(false);
  });
  it('preserves distinct policies after a completed refund', () => {
    expect(hasMixedRefundPolicies(normalized([{ is_refundable: false, refund_period_days: null }, { is_refundable: true, refund_period_days: null }], 'refunded'))).toBe(true);
  });
  it('uses paid gross line totals and a gross subtotal before the coupon', () => {
    const items = normalizePurchaseLineItems(rows, date, 'completed');
    expect(items.map(item => item.grossTotal)).toEqual([110.7, 19]);
    expect(items.map(item => item.grossSubtotal)).toEqual([123, 19]);
    expect(Math.round(items.reduce((sum, item) => sum + item.grossTotal, 0) * 100)).toBe(12970);
  });
  it('keeps legacy prices when tax and coupon snapshots are absent', () => {
    const item = { ...rows[0], net_amount: null, tax_amount: null, discounted_total: null, tax_behavior: null };
    const [result] = normalizePurchaseLineItems([item], date, 'completed');
    expect(result.grossTotal).toBe(100); expect(result.grossSubtotal).toBe(100);
  });
  it('uses major-unit discounted prices without a tax snapshot', () => {
    const [item] = normalizePurchaseLineItems([{ ...rows[0], net_amount: null, tax_amount: null, tax_behavior: null }], date, 'completed');
    expect(item.grossTotal).toBe(90);
  });
  it('handles zero-decimal currencies and quantities without multiplying saved line totals again', () => {
    const [item] = normalizePurchaseLineItems([{ ...rows[0], currency: 'JPY', quantity: 2, total_price: 2000, discounted_total: 1800, net_amount: 1800, tax_amount: 180, vat_rate: 10 }], date, 'completed');
    expect(item.grossTotal).toBe(1980); expect(item.grossSubtotal).toBe(2200);
  });
  it('keeps inclusive gross prices before and after a coupon', () => {
    const [item] = normalizePurchaseLineItems([{ ...rows[0], total_price: 123, discounted_total: 110.7, tax_behavior: 'inclusive' }], date, 'completed');
    expect(item.grossTotal).toBe(110.7); expect(item.grossSubtotal).toBe(123);
  });
  it('respects saved VAT exemption when showing the gross subtotal', () => {
    const [item] = normalizePurchaseLineItems([{ ...rows[0], tax_amount: 0, vat_exempt: true }], date, 'completed');
    expect(item.grossTotal).toBe(90); expect(item.grossSubtotal).toBe(100);
  });
  it('uses the saved VAT rate rather than a rate distorted by small-amount rounding', () => {
    const [item] = normalizePurchaseLineItems([{ ...rows[0], total_price: 0.04, discounted_total: 0.03, net_amount: 3, tax_amount: 1 }], date, 'completed');
    expect(item.grossTotal).toBe(0.04); expect(item.grossSubtotal).toBe(0.05);
  });
  it('normalizes numeric strings returned by saved payment queries', () => {
    const row = { ...rows[0], total_price: '100', discounted_total: '90', net_amount: '9000', tax_amount: '2070' } as unknown as PurchaseLineItem;
    const [item] = normalizePurchaseLineItems([row], date, 'completed');
    expect(item.grossTotal).toBe(110.7); expect(item.grossSubtotal).toBe(123);
  });
  it('handles fully discounted net-priced lines', () => {
    const [item] = normalizePurchaseLineItems([{ ...rows[0], discounted_total: 0, net_amount: 0, tax_amount: 0 }], date, 'completed');
    expect(item.grossTotal).toBe(0); expect(item.grossSubtotal).toBe(123);
  });
  it.each(['pl', 'en'] as const)('renders the paid gross lines and gross coupon reduction in %s', async locale => {
    const messages = showPage(locale);
    await screen.findByText('Main line');
    for (const [name, amount] of [['Main line', 110.7], ['Bump line', 19]] as const) {
      const row = screen.getByText(name).closest('.min-w-0')!.parentElement!;
      expect(within(row).getByText(formatPrice(amount, 'PLN', locale), { normalizer: text => text.trim() })).toBeTruthy();
    }
    expect(screen.getByText(messages.discountPercentage.replace('{value}', '10'))).toBeTruthy();
    expect(screen.getByText(`-${formatPrice(12.3, 'PLN', locale)}`, { normalizer: text => text.trim() })).toBeTruthy();
    expect(screen.getByText(formatPrice(142, 'PLN', locale), { normalizer: text => text.trim() })).toBeTruthy();
    expect(screen.queryByText(messages.bundleManualRefundContact)).toBeNull();
    expect(screen.queryByText(messages.mixedRefundPolicyNotice)).toBeNull();
  });
  it.each(['pl', 'en'] as const)('renders completed refund amount and date without an expired-period label in %s', async locale => {
    fixture.status = 'refunded'; fixture.refundable = true;
    const messages = showPage(locale);
    await screen.findByText('Main line');
    expect(screen.getByText(`${messages.refundedAmount}: ${formatPrice(129.7, 'PLN', locale)}, ${formatAdminDate(refundDate, locale, false)}`, { normalizer: text => text.trim() })).toBeTruthy();
    expect(screen.queryByText(messages.refundPeriodExpired)).toBeNull();
    expect(screen.queryByText(messages.bundleManualRefundContact)).toBeNull();
    expect(screen.queryByText(messages.requestRefund)).toBeNull();
  });
});
