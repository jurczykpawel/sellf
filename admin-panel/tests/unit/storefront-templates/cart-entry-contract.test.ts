/** Every installed storefront leads to the shared checkout rather than its own coupon form. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import StorefrontComposition from '@/components/storefront/StorefrontComposition';
import { D_CONFIG, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { resolvePresentation, resolveSelection } from '@/lib/storefront-templates/resolver';
import { referenceConfig } from '../../fixtures/storefront-sections/phase2/contracts';
import { referenceProducts, referenceCategories } from '../../fixtures/storefront-sections/phase2/reference';
vi.mock('@/components/CookiePreferences', () => ({ default: () => null }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
it.each(['d', 'storefront-a', 'storefront-b', 'storefront-c'] as const)('%s keeps cart ownership in core checkout', templateId => {
  const products = templateId === 'd' ? PUBLIC_FIXTURE.products : referenceProducts('en').map(p => ({ ...p, image: null }));
  const categories = templateId === 'd' ? PUBLIC_FIXTURE.categories : referenceCategories('en');
  const config = templateId === 'd' ? { ...D_CONFIG, templateId } : { ...referenceConfig(), templateId };
  const result = resolvePresentation(resolveSelection(config, [templateId, 'default']), {
    locale: 'en', productsById: Object.fromEntries(products.map(p => [p.id, p])), categoriesById: Object.fromEntries(categories.map(c => [c.id, c])),
    catalogue: { variant: 'compact', groups: { all: { products, nextCursor: null } }, filters: [], pageSize: 24, density: 'comfortable', locale: 'en' },
  });
  expect(result.templateId).toBe(templateId);
  const html = renderToStaticMarkup(React.createElement(StorefrontComposition, { model: result, shopName: 'Example', renderKey: 'fixture', year: 2026, showSellfBranding: false }));
  expect(html).not.toMatch(/name="coupon"|couponEntryPrompt/);
  expect(html).toMatch(/href="\/en\/(?:p|checkout)\//);
});
