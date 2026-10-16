/** Hero section contracts and server rendering. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { heroProductDefinition } from '@/lib/storefront-templates/hero-product';
import { loadCataloguePage } from '@/lib/storefront-templates/catalogue';
import { heroContentSchema } from '@/lib/storefront-templates/schemas';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { heroProductFixture, heroProductRow, HERO_FIXTURE_IDS } from '../../fixtures/storefront-sections/hero-product';

vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));

const spec = { id: 'hero', type: 'hero-product/1', variant: 'split-process', product: { setting: 'heroProduct' }, content: { slot: 'home.hero' } } as const;
const render = (props = heroProductFixture()) => renderToStaticMarkup(createElement(heroProductDefinition.Component, props));

describe('hero-product/1', () => {
  it('reuses strict section and slot contracts', () => {
    expect(heroProductDefinition.schema.safeParse(spec).success).toBe(true);
    for (const extra of [{ ...spec, demo: 'example' }, { ...spec, product: { setting: 'any' } }, { ...spec, content: { slot: 'home.faq' } }, { ...spec, variant: 'other' }]) {
      expect(heroProductDefinition.schema.safeParse(extra).success).toBe(false);
    }
    expect(heroProductDefinition.fixtureIds).toEqual(HERO_FIXTURE_IDS);
  });

  it('resolves only supplied bindings and hero content without fetching', () => {
    const fixture = heroProductFixture();
    const inputs = { locale: 'en' as const, settings: { heroProduct: fixture.product!.id }, productsById: { [fixture.product!.id]: fixture.product! }, slots: { 'home.hero': fixture.content! } };
    expect(heroProductDefinition.resolve(spec, inputs)).toEqual(fixture);
    expect(heroProductDefinition.resolve(spec, { ...inputs, settings: {}, slots: {} })).toEqual({ locale: 'en', variant: 'split-process', product: null, content: null });
    expect(heroProductDefinition.resolve(spec, { ...inputs, slots: { 'home.hero': { kind: 'faq', items: [] } } }).content).toBeNull();
  });

  for (const variant of ['split-process', 'simple'] as const) {
    for (const locale of ['en', 'pl'] as const) {
      it(`${variant}/${locale} server-renders price, actions, media and steps`, () => {
        const props = { ...heroProductFixture(locale), variant };
        const html = render(props);
        expect(html).toContain('99 zł');
        expect(html).toContain(props.product!.price.taxNote);
        expect(html).toContain(`href="${props.product!.actions.details}"`);
        expect(html).toContain('width="800" height="500"');
        expect(html).toContain('fetchPriority="high"');
        expect(html.match(/<h1/g)).toHaveLength(1);
        expect(html.match(/<li[ >]/g)).toHaveLength(3);
        expect(html).not.toMatch(/<video|<iframe|<button|autoplay/i);
      });
    }
  }

  for (const kind of ['free', 'one-time', 'subscription', 'pwyw'] as const) {
    it(`preserves core ${kind} price output verbatim`, () => {
      const props = heroProductFixture();
      props.product!.price = { kind, display: 'Core display ą', taxNote: 'Core tax', omnibus: 'Core prior price' };
      const html = render(props);
      for (const value of ['Core display ą', 'Core tax', 'Core prior price']) expect(html).toContain(value);
    });
  }

  for (const locale of ['en', 'pl'] as const) {
    it(`${locale}: matches the real core price, action and media projection`, async () => {
      const row = heroProductRow();
      const rows = [{ ...row, price: 0 }, { ...row, sale_price: 10, lowest_prior_price: 18 },
        { ...row, price: 0, product_type: 'subscription', recurring_price: 0, billing_interval: 'month' },
        { ...row, price: 0, allow_custom_price: true, custom_price_min: 3 }];
      const rpc = vi.fn().mockImplementation(async (name: string) => ({ data: name === 'storefront_catalogue_boundary' ? null : rows, error: null }));
      const result = await loadCataloguePage({ rpc } as unknown as SupabaseClient<Database>, { locale });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.products.map(product => product.price.kind)).toEqual(['free', 'one-time', 'subscription', 'pwyw']);
      for (const product of result.data.products) {
        const html = render({ ...heroProductFixture(locale), product });
        for (const text of [product.price.display, product.price.taxNote, product.price.omnibus].filter(Boolean)) expect(html).toContain(text);
        expect(html).toContain(`href="${product.actions.details}"`);
        expect(html).toContain(`src="${product.image!.src}"`);
        expect(html).not.toContain('PRIVATE_');
      }
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(rpc).toHaveBeenCalledWith('storefront_catalogue_boundary');
    });
  }

  it('omits missing media, empty prose and steps without inventing content', () => {
    const props = heroProductFixture();
    props.content = null;
    props.product!.image = null;
    const html = render(props);
    expect(html).toContain('<h1>Example workshop</h1>');
    expect(html).not.toMatch(/<img|<figure|<ol|<p[^>]*><\/p>/);
  });

  it('shows the core safe state for missing and unavailable products', () => {
    for (const product of [null, { ...heroProductFixture().product!, availability: 'unavailable' as const }]) {
      const html = render({ ...heroProductFixture(), product });
      expect(html).toContain('This product is currently not available for new customers.');
      expect(html).not.toMatch(/<a|<img|99 zł/);
    }
  });

  it('renders untrusted prose as literal text and validates bounded content', () => {
    const props = heroProductFixture();
    props.content!.heading = '<img src=x onerror=alert(1)>';
    props.content!.body = '<script>alert(1)</script>';
    props.content!.steps = ['<iframe src=example>'];
    const html = render(props);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script|<iframe|onerror="/);
    expect(heroContentSchema.safeParse(props.content).success).toBe(false);
    expect(heroContentSchema.safeParse({ ...heroProductFixture().content, steps: Array(7).fill('Step') }).success).toBe(false);
  });
});
