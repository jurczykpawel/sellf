// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import Storefront from '@/components/storefront/Storefront';
import StorefrontComposition from '@/components/storefront/StorefrontComposition';
import { compositionFixture } from '../../fixtures/storefront-sections/composition';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

vi.mock('@/components/storefront/StorefrontComposition.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/ProductList.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/TaskNav.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/FaqClosing.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/Catalogue.module.css', () => ({ default: {} }));

const cases = [
  ['en', 'Runs on Sellf', '© 2031 Example shop'],
  ['pl', 'Działa na Sellf', '© 2031 Example shop'],
] as const;

function composition(locale: 'en' | 'pl', showSellfBranding: boolean): string {
  return renderToStaticMarkup(createElement(StorefrontComposition, {
    model: compositionFixture(locale, 'default'), shopName: 'Example shop', renderKey: 'x', year: 2031, showSellfBranding,
  }));
}
function classic(locale: 'en' | 'pl', showSellfBranding: boolean): string {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale, messages: locale === 'pl' ? pl : en, timeZone: 'UTC',
    children: createElement(Storefront, {
      products: [], shopName: 'Example shop', featuredProducts: [], freeProducts: [], paidProducts: [],
      year: 2031, showSellfBranding,
    }),
  }));
}

describe.each([['composition', composition], ['classic storefront', classic]] as const)('%s footer', (_name, renderFooter) => {
  describe.each(cases)('%s', (locale, runsOn, copyright) => {
    it('shows the shop copyright and no Sellf link with the Pro feature', () => {
      const html = renderFooter(locale, false);
      expect(html).toContain(copyright);
      expect(html).not.toContain(runsOn);
      expect(html).not.toContain('sellf.app');
      expect(html).not.toMatch(/Powered by|Napędzane|Napedzane/);
    });
    it('adds a small Sellf link without the Pro feature', () => {
      const html = renderFooter(locale, true);
      expect(html).toContain(copyright);
      expect(html).toMatch(new RegExp(`<a [^>]*href="https://sellf.app"[^>]*rel="noopener[^"]*"[^>]*>${runsOn}</a>`));
    });
  });
});
