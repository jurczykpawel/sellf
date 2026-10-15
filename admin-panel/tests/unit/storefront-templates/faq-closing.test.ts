/** FAQ and closing section contracts. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Faq from '@/components/storefront/sections/Faq';
import ProductCta from '@/components/storefront/sections/ProductCta';
import { resolveFaq, resolveProductCta } from '@/lib/storefront-templates/faq-closing';
import { loadStorefrontBindings } from '@/lib/storefront-templates/catalogue';
import { faqContentSchema } from '@/lib/storefront-templates/schemas';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { closingFixture, faqFixture } from '../../fixtures/storefront-sections/faq-closing';

vi.mock('@/components/storefront/sections/FaqClosing.module.css', () => ({ default: {} }));
const faq = { id: 'faq', type: 'faq/1', content: { slot: 'home.faq' } };
const cta = { id: 'closing', type: 'product-cta/1', content: { slot: 'home.closing' }, product: { setting: 'closingProduct' }, action: 'details' };
const fixture = closingFixture('en');
const product = fixture.product!;
const inputs = { locale: 'en' as const, settings: { closingProduct: product.id }, productsById: { [product.id]: product }, slots: { 'home.faq': faqFixture('en').content!, 'home.closing': fixture.content! } };
const render = (props = fixture) => renderToStaticMarkup(createElement(ProductCta, props));

describe('FAQ and closing sections', () => {
  it('resolves declared slots and product bindings from public batches', () => {
    expect(resolveFaq(faq, inputs)).toEqual({ success: true, data: faqFixture('en') });
    expect(resolveProductCta(cta, inputs)).toEqual({ success: true, data: fixture });
    expect(resolveProductCta({ ...cta, product: { setting: 'heroProduct' }, action: 'buy' }, { ...inputs, settings: { heroProduct: product.id } })).toEqual({ success: true, data: { ...fixture, action: 'buy' } });
  });
  it('rejects incorrect kinds, extra fields and undeclared bindings', () => {
    for (const spec of [{ ...faq, content: { slot: 'home.closing' } }, { ...faq, url: 'https://example.com' }]) expect(resolveFaq(spec, inputs).success).toBe(false);
    expect(resolveFaq(faq, { ...inputs, slots: { 'home.faq': fixture.content! } }).success).toBe(false);
    expect(resolveProductCta({ ...cta, action: 'redirect' }, inputs).success).toBe(false);
    expect(resolveProductCta(cta, { ...inputs, slots: { 'home.closing': faqFixture('en').content! } }).success).toBe(false);
  });
  it('accepts twenty unique answers and rejects duplicate IDs, extra items and HTML', () => {
    const content = faqFixture('en', true).content!;
    expect(faqContentSchema.safeParse(content).success).toBe(true);
    for (const items of [[...content.items, content.items[0]], [content.items[0], content.items[0]], [{ ...content.items[0], answer: '<b>text</b>' }]]) {
      expect(resolveFaq(faq, { ...inputs, slots: { 'home.faq': { kind: 'faq', items } } }).success).toBe(false);
    }
    expect(resolveProductCta(cta, { ...inputs, slots: { 'home.closing': { ...fixture.content!, body: '<img src=x>' } } }).success).toBe(false);
  });
  it('omits empty disclosures, optional prose and absent products', () => {
    expect(renderToStaticMarkup(createElement(Faq, { locale: 'en', content: null }))).toBe('');
    expect(renderToStaticMarkup(createElement(Faq, { locale: 'en', content: { kind: 'faq', items: [{ id: 'empty', question: ' ', answer: 'answer' }, { id: 'no-answer', question: 'Question', answer: '' }] } }))).toBe('');
    expect(render({ ...fixture, product: null })).toBe('');
    const html = render({ ...fixture, content: null });
    expect(html).not.toContain('<p');
    expect(html).toContain(product.title);
    expect(resolveProductCta(cta, { ...inputs, productsById: {} })).toMatchObject({ success: true, data: { product: null } });
    expect(resolveFaq(faq, { ...inputs, slots: {} })).toMatchObject({ success: true, data: { content: null } });
  });
  it.each(['free', 'one-time', 'subscription', 'pwyw'] as const)('retains core %s price and exact action', kind => {
    const props = closingFixture('pl', kind);
    const html = render({ ...props, action: 'buy' });
    expect(html).toContain(props.product!.price.display);
    expect(html).toContain(`href="${props.product!.actions.buy}"`);
    for (const note of [props.product!.price.taxNote, props.product!.price.omnibus]) if (note) expect(html).toContain(note);
    expect(html).not.toContain('<img');
  });
  it('omits unavailable commerce and escapes literal prose', () => {
    const html = render({ ...fixture, product: { ...product, availability: 'unavailable' } });
    expect(html).not.toContain('href='); expect(html).not.toContain(product.price.display);
    expect(render({ ...fixture, content: { kind: 'cta', heading: '<b>literal</b>', body: '' } })).toContain('&lt;b&gt;');
  });
  it('renders the authoritative public projection without extra reads or private fields', async () => {
    for (const locale of ['en', 'pl'] as const) for (const kind of ['free', 'one-time', 'subscription', 'pwyw']) {
      const rpc = vi.fn().mockResolvedValue({ error: null, data: [{ id: product.id, slug: product.slug, name: product.title,
        created_at: '2026-01-01T00:00:00.123456+00:00', price: kind === 'free' ? 0 : 20, currency: 'USD',
        product_type: kind === 'subscription' ? 'subscription' : 'one_time', recurring_price: kind === 'subscription' ? 0 : null,
        billing_interval: kind === 'subscription' ? 'month' : null, billing_interval_count: 1,
        allow_custom_price: kind === 'pwyw', custom_price_min: 3, sale_price: kind === 'one-time' ? 10 : null,
        sale_price_until: null, sale_quantity_limit: null, sale_quantity_sold: 0, marketing_fields: product.marketing,
        image_url: null, vat_rate: 23, vat_exempt: false, vat_exempt_note: null, price_includes_vat: true,
        tax_mode: 'local', lowest_prior_price: 18, content_config: 'PRIVATE_CONTENT', customer: 'PRIVATE_CUSTOMER', license_key: 'PRIVATE_KEY',
      }] });
      const loaded = await loadStorefrontBindings({ rpc } as unknown as SupabaseClient<Database>, { locale, closingProduct: product.id, target: 'catalogue' });
      expect(loaded.success).toBe(true);
      if (!loaded.success || !loaded.data.closing) throw Error('Expected closing binding');
      const projected = loaded.data.closing;
      const resolved = resolveProductCta(cta, { ...inputs, locale, productsById: { [product.id]: projected } });
      expect(resolved.success).toBe(true);
      if (!resolved.success) throw Error('Expected resolved section');
      const html = render(resolved.data);
      expect(projected.price.kind).toBe(kind);
      expect(html).toContain(projected.price.display);
      expect(html).toContain(projected.actions.details);
      for (const note of [projected.price.taxNote, projected.price.omnibus]) if (note) expect(html).toContain(note);
      expect(JSON.stringify(resolved) + html).not.toContain('PRIVATE_');
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });
  it('accepts only the exact locale-aware core routes for this product', () => {
    for (const url of ['https://example.com', '//example.com', 'javascript:alert(1)', '/en/p/other', '/en/p/example-workshop?email=a', '/en/p/example-workshop#x', '/en/p/../other', '/en/p/%65xample-workshop', '/en/p/example-workshop\n']) {
      const result = resolveProductCta(cta, { ...inputs, productsById: { [product.id]: { ...product, actions: { ...product.actions, details: url } } } });
      expect(result.success).toBe(false);
      expect(render({ ...fixture, product: { ...product, actions: { ...product.actions, details: url } } })).not.toContain('href=');
    }
    for (const changed of [{ ...product, slug: '../other' }, { ...product, id: '22222222-2222-4222-8222-222222222222' }, { ...product, actions: { ...product.actions, buy: 'https://example.com' } }]) {
      expect(resolveProductCta(cta, { ...inputs, productsById: { [product.id]: changed } }).success).toBe(false);
    }
  });
});
