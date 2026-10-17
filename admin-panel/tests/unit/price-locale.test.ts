// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import Storefront from '@/components/storefront/Storefront';
import PaymentSessionsTable from '@/components/admin/PaymentSessionsTable';
import PaymentTransactionsTable from '@/components/admin/PaymentTransactionsTable';
import ProductShowcase from '@/app/[locale]/checkout/[slug]/components/ProductShowcase';
import PwywSection from '@/app/[locale]/checkout/[slug]/components/PwywSection';
import OrderSummary from '@/components/checkout/OrderSummary';
import OmnibusPrice from '@/components/OmnibusPrice';
import OtoCountdownBanner from '@/components/storefront/OtoCountdownBanner';
import CouponField from '@/app/[locale]/checkout/[slug]/components/CouponField';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { ReactElement } from 'react';
import type { Product } from '@/types';
import type { PaymentSession, PaymentTransaction } from '@/types/payment';

vi.mock('@/lib/actions/payment', () => ({ processRefund: vi.fn() }));

const product: Product = {
  id: 'product', name: 'Course', slug: 'course', description: '', icon: '📦',
  price: 49, currency: 'PLN', price_includes_vat: true, vat_exempt: false,
  layout_template: 'default', is_active: true, is_featured: false, is_listed: true,
  is_bundle: false, omnibus_exempt: true, content_delivery_type: 'content',
  content_config: {}, pass_params_to_redirect: false, is_refundable: false,
  enable_waitlist: false, allow_custom_price: false, custom_price_min: 5,
  show_price_presets: true, custom_price_presets: [5, 49], checkout_template: 'default',
  custom_checkout_fields: [], created_at: '2026-10-01', updated_at: '2026-10-01',
};

function localized(element: ReactElement, locale: 'en' | 'pl'): ReactElement {
  return createElement(NextIntlClientProvider, {
    locale, messages: locale === 'pl' ? pl : en, timeZone: 'UTC',
    children: element,
  });
}

function html(element: ReactElement, locale: 'en' | 'pl'): string {
  return renderToStaticMarkup(localized(element, locale));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each([
  ['pl', '49,00\u00a0zł', '99,00\u00a0zł', '5,00\u00a0zł'],
  ['en', 'PLN\u00a049.00', 'PLN\u00a099.00', 'PLN\u00a05.00'],
] as const)('prices on %s pages', (locale, price, oldPrice, minimum) => {
  it('formats both sale and crossed-out prices on checkout', () => {
    const output = html(createElement(ProductShowcase, {
      product: { ...product, price: 99, sale_price: 49 },
    }), locale);
    expect(output).toContain('line-through');
    expect(output).toContain(oldPrice);
    expect(output).toContain(price);
  });

  it('formats PWYW presets and the minimum', () => {
    const output = html(createElement(PwywSection, {
      product: { ...product, allow_custom_price: true },
      user: null, customAmount: 49, customAmountInput: '49', customAmountError: null,
      isFreeAccess: false, isFullDiscountCoupon: false, hasAccess: false, error: null,
      pwyw: {} as Parameters<typeof PwywSection>[0]['pwyw'],
      onAmountInputChange: vi.fn(), onAmountBlur: vi.fn(), onPresetClick: vi.fn(),
      collectTermsOfService: false,
    }), locale);
    expect(output).toContain(price);
    expect(output.split(minimum).length - 1).toBe(2);
  });

  it('formats the checkout total identically on server and client', () => {
    const element = createElement(OrderSummary, {
      productName: 'Course', currency: 'PLN', basePrice: 49,
      totalGross: 49, totalNet: 49, discountAmount: 0, vatRate: null,
    });
    const server = html(element, locale);
    const client = render(localized(element, locale));
    expect(server).toContain(price);
    expect(client.container.textContent).toContain(price);
  });

  it('formats admin session amounts in major units', () => {
    const session: PaymentSession = {
      id: 'session', session_id: 'cs_test', provider_type: 'stripe', product_id: product.id,
      customer_email: 'buyer@example.com', amount: 49, currency: 'pln',
      status: 'completed', metadata: {}, expires_at: '2026-10-20',
      created_at: '2026-10-01', updated_at: '2026-10-01',
    };
    expect(html(createElement(PaymentSessionsTable, { sessions: [session] }), locale)).toContain(price);
  });

  it('formats Omnibus history using the page language', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      lowestPrice: 49, currency: 'PLN', showOmnibus: true,
    })));
    const result = render(localized(createElement(OmnibusPrice, {
      productId: product.id, currentPrice: 49, currency: 'PLN',
    }), locale));
    await waitFor(() => expect(result.container.textContent).toContain(price));
  });

  it('formats fixed coupon and OTO discounts', () => {
    const coupon = html(createElement(CouponField, {
      couponCode: 'SAVE', appliedCoupon: { id: 'coupon', code: 'SAVE', discount_type: 'fixed', discount_value: 49 },
      isVerifying: false, couponError: null, currency: 'PLN', showCouponInput: true,
      onCodeChange: vi.fn(), onApply: vi.fn(), onRemove: vi.fn(),
    }), locale);
    const banner = html(createElement(OtoCountdownBanner, {
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      discountType: 'fixed', discountValue: 49.5, currency: 'PLN', onExpire: vi.fn(),
    }), locale);
    expect(coupon).toContain(price);
    expect(banner).toContain(locale === 'pl' ? '49,50\u00a0zł' : 'PLN\u00a049.50');
  });

  it('formats admin transaction amounts in minor units', () => {
    const transaction: PaymentTransaction = {
      id: 'transaction', session_id: 'cs_test', user_id: null, product_id: product.id,
      amount: 4900, currency: 'pln', status: 'completed', refunded_amount: 0,
      metadata: {}, created_at: '2026-10-01', updated_at: '2026-10-01',
    };
    expect(html(createElement(PaymentTransactionsTable, { transactions: [transaction] }), locale)).toContain(price);
  });
});

it('updates storefront prices when the page language changes', () => {
  const element = createElement(Storefront, {
    products: [product], shopName: 'Shop', featuredProducts: [], freeProducts: [],
    paidProducts: [product], year: 2026, showSellfBranding: false,
  });
  const result = render(localized(element, 'pl'));
  expect(result.container.textContent).toContain('49,00\u00a0zł');
  result.rerender(localized(element, 'en'));
  expect(result.container.textContent).toContain('PLN\u00a049.00');
  expect(result.container.textContent).not.toContain('49,00\u00a0zł');
});
