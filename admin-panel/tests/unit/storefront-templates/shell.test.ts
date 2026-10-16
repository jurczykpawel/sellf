/** Public shell first-paint and landing branches. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SmartLandingClient from '@/components/storefront/SmartLandingClient';
import StorefrontComposition from '@/components/storefront/StorefrontComposition';
import { resolvePresentation, resolveSelection } from '@/lib/storefront-templates/resolver';
import { DEFAULT_CONFIG } from '@/lib/storefront-templates/fixtures';
const auth = vi.hoisted(() => ({ user: null, isAdmin: false, loading: true }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'en' }));
vi.mock('@/components/DashboardLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => createElement('main', null, children) }));
vi.mock('@/components/storefront/AdminOnboardingCTA', () => ({ default: () => createElement('h1', null, 'Onboarding') }));
vi.mock('@/components/storefront/ComingSoonEmptyState', () => ({ default: () => createElement('h1', null, 'Coming soon') }));
vi.mock('@/components/storefront/StorefrontComposition.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/ProductList.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/TaskNav.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/FaqClosing.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/Catalogue.module.css', () => ({ default: {} }));
beforeEach(() => Object.assign(auth, { user: null, isAdmin: false, loading: true }));
describe('public storefront shell', () => {
  it('server-renders public content while auth is loading', () => {
    const html = renderToStaticMarkup(createElement(SmartLandingClient, { hasProducts: true, shopConfig: null }, createElement('h1', null, 'Public offer')));
    expect(html).toContain('Public offer'); expect(html).not.toContain('animate-spin');
  });
  it('keeps guest/member coming-soon and admin onboarding', () => {
    const render = () => renderToStaticMarkup(createElement(SmartLandingClient, { hasProducts: false, shopConfig: null }));
    expect(render()).toContain('Coming soon');
    Object.assign(auth, { loading: false, isAdmin: false }); expect(render()).toContain('Coming soon');
    Object.assign(auth, { loading: false, isAdmin: true }); expect(render()).toContain('Onboarding');
  });
  it('renders free default with one h1 and independent catalogue groups on the server', () => {
    const model = resolvePresentation(resolveSelection(DEFAULT_CONFIG), { locale: 'en', productsById: {}, categoriesById: {}, catalogue: { variant: 'default-groups', groups: { featured: { products: [], nextCursor: null }, free: { products: [], nextCursor: null }, paid: { products: [], nextCursor: null } }, filters: [], pageSize: 12, density: 'comfortable', locale: 'en' } });
    const html = renderToStaticMarkup(createElement(StorefrontComposition, { model, shopName: 'Example shop', renderKey: 'initial' }));
    expect(html.match(/<h1/g)).toHaveLength(1); expect(html).toContain('Example shop');
    expect(html).toContain('id="catalogue"'); expect(html).not.toContain('animate-spin');
  });
});

describe('default brand states', () => {
  for (const [state, expected] of [['freeOnly', 'Start Your Journey'], ['paidOnly', 'Premium Quality'], ['mixed', 'From Free']] as const) {
    it(`retains the ${state} brand heading`, async () => {
      const { compositionFixture } = await import('../../fixtures/storefront-sections/composition');
      const model = compositionFixture('en', 'default');
      if (state === 'freeOnly') { model.catalogue.groups.paid!.products = []; model.catalogue.groups.featured!.products = []; }
      if (state === 'paidOnly') model.catalogue.groups.free!.products = [];
      const html = renderToStaticMarkup(createElement(StorefrontComposition, { model, shopName: 'Example shop', renderKey: 'initial' }));
      expect(html).toContain(expected);
    });
  }
});


describe('default catalogue totals', () => {
  it.each(['featured', 'free', 'paid'] as const)('omits totals when %s has another page', async (group) => {
    const { compositionFixture } = await import('../../fixtures/storefront-sections/composition');
    const model = compositionFixture('en', 'default');
    model.catalogue.groups[group]!.nextCursor = 'another-page';
    const html = renderToStaticMarkup(createElement(StorefrontComposition, { model, shopName: 'Example shop', renderKey: 'initial' }));
    expect(html).not.toContain('<dl aria-label="Products shown">');
    expect(html).not.toContain('Start with 1 free resources');
  });
  it('retains totals for a complete catalogue', async () => {
    const { compositionFixture } = await import('../../fixtures/storefront-sections/composition');
    const model = compositionFixture('en', 'default');
    const html = renderToStaticMarkup(createElement(StorefrontComposition, { model, shopName: 'Example shop', renderKey: 'initial' }));
    expect(html).toContain('<dl aria-label="Products shown">');
    expect(html).toContain('<dd>4</dd>');
  });
});
