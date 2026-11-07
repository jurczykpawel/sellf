// @vitest-environment happy-dom
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProductAccessView from '@/app/[locale]/p/[slug]/components/ProductAccessView';
import type { Product } from '@/types';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/EventAccess', () => ({ default: () => null }));
vi.mock('@/components/DigitalContentRenderer', () => ({ default: () => null }));
vi.mock('@/components/SellfBranding', () => ({ default: () => null }));
vi.mock('@/components/FloatingToolbar', () => ({ default: () => null }));
afterEach(cleanup);
it.each(['pl', 'en'] as const)('shows access expiry in page language %s', locale => {
  const product = { id: 'p', name: 'Membership', slug: 'membership', is_active: true, content_config: { content_items: [] } } as unknown as Product;
  const expires = '2090-12-07T14:43:06Z';
  render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(ProductAccessView, { product, licenseValid: true, initialSecureData: { product, userAccess: { access_expires_at: expires, access_granted_at: '2026-11-07T00:00:00Z', is_expired: false, is_expiring_soon: false, days_until_expiration: 1000 } } })));
  expect(screen.getByText(text => text.includes(locale === 'pl' ? '7 grudnia 2090' : 'December 7, 2090'))).toBeTruthy();
});
