/** Ordered path bindings and core commercial display. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ProductPaths from '@/components/storefront/sections/ProductPaths';
import { phase2ConfigSchema } from '@/lib/storefront-templates/phase2-contracts';
import { templateCapabilities } from '@/lib/storefront-templates/capabilities';
import { referenceConfig } from '../../fixtures/storefront-sections/phase2/contracts';
import { resolveProductPaths } from '@/lib/storefront-templates/product-paths';
import { pathsFixture, pathsSpec } from '../../fixtures/storefront-sections/product-paths';

describe('product-paths/1', () => {
  it('supports bounded optional C section labels without changing bindings', () => {
    const inputs = pathsFixture('en'); const content = inputs.slots['home.paths']!;
    const slots = { 'home.paths': { ...content, eyebrow: 'Your first step', actionLabel: 'View material', items: content.items.map(item => ({ ...item, label: 'Starting point' })) } };
    const resolved = resolveProductPaths(pathsSpec, { ...inputs, slots });
    expect(resolved.success).toBe(true); if (!resolved.success) return;
    const html = renderToStaticMarkup(createElement(ProductPaths, resolved.data));
    for (const label of ['Your first step', 'View material', 'Starting point']) expect(html).toContain(label);
    for (const patch of [{ eyebrow: 'a'.repeat(81) }, { actionLabel: 'a'.repeat(81) }, { items: [{ ...content.items[0], label: 'a'.repeat(81) }] }]) expect(resolveProductPaths(pathsSpec, { ...inputs, slots: { 'home.paths': { ...content, ...patch } } }).success).toBe(false);
  });
  it('retains localized paths across selections and exposes generated contracts', () => {
    const content = { sourceLocale: 'en' as const, en: pathsFixture('en').slots['home.paths']!, pl: pathsFixture('pl').slots['home.paths']! };
    for (const templateId of ['storefront-c', 'storefront-a', 'd'] as const) {
      const parsed = phase2ConfigSchema.parse(JSON.parse(JSON.stringify({ ...referenceConfig(), templateId, content: { 'home.paths': content } })));
      expect(parsed.content['home.paths']).toEqual(content);
    }
    const capabilities = templateCapabilities();
    expect(capabilities.phase2.slots['home.paths']).toBe('paths');
    expect(capabilities.phase2.limits.paths).toBe(4);
    expect(JSON.stringify(capabilities.schemas['phase2-content'])).toContain('actionLabel');
  });
  it('retains four distinct ordered bindings and core product identity', () => {
    const inputs = pathsFixture('pl'); inputs.slots['home.paths']!.items.reverse();
    const resolved = resolveProductPaths(pathsSpec, inputs);
    expect(resolved.success).toBe(true); if (!resolved.success) return;
    expect(resolved.data.items.map(item => item.product.id)).toEqual(inputs.slots['home.paths']!.items.map(item => item.productId));
    for (const item of resolved.data.items) expect(item.product).toBe(inputs.productsById[item.product.id]);
    const html = renderToStaticMarkup(createElement(ProductPaths, resolved.data));
    expect(html.match(/<article/g)).toHaveLength(4); expect(html).not.toMatch(/<h1|iframe|undefined/);
    expect(html).toContain('href="/pl/p/example-0"');
  });
  it('rejects fifth, duplicate product/path, unknown binding, field and slot', () => {
    const inputs = pathsFixture('en'); const content = inputs.slots['home.paths']!; const first = content.items[0];
    for (const items of [[...content.items, { ...first, id: 'fifth', productId: '00000000-0000-4000-8000-000000000005' }], [first, { ...first, id: 'duplicate' }], [first, { ...content.items[1], id: first.id }], [{ ...first, productId: 'unknown' }], [{ ...first, productId: '00000000-0000-4000-8000-000000000099' }], [{ ...first, price: 'Seller price' }], [{ ...first, situation: '<b>Title</b>' }]]) expect(resolveProductPaths(pathsSpec, { ...inputs, slots: { 'home.paths': { ...content, items } } }).success).toBe(false);
    expect(resolveProductPaths({ ...pathsSpec, content: { slot: 'home.starts' } }, inputs).success).toBe(false);
    expect(resolveProductPaths({ ...pathsSpec, product: { setting: 'heroProduct' } }, inputs).success).toBe(false);
  });
  it('omits known unavailable/null bindings and absent optional content', () => {
    const inputs = pathsFixture('en', 'unavailable'); const ids = Object.keys(inputs.productsById); inputs.productsById[ids[0]] = null;
    const resolved = resolveProductPaths(pathsSpec, inputs);
    expect(resolved.success && resolved.data.items.map(item => item.product.id)).toEqual(ids.slice(2));
    inputs.productsById = Object.fromEntries(ids.map(id => [id, null]));
    const absent = resolveProductPaths(pathsSpec, inputs);
    expect(absent.success && renderToStaticMarkup(createElement(ProductPaths, absent.data))).toBe('');
    const empty = resolveProductPaths(pathsSpec, pathsFixture('en', 'empty'));
    expect(empty.success && renderToStaticMarkup(createElement(ProductPaths, empty.data))).toBe('');
  });
  it('uses core prices, free labels, details routing and facts for every price kind', () => {
    const inputs = pathsFixture('en', 'prices'); Object.values(inputs.productsById)[0]!.actions.details = '/offer/core-selected';
    const resolved = resolveProductPaths(pathsSpec, inputs);
    expect(resolved.success).toBe(true); if (!resolved.success) return;
    const html = renderToStaticMarkup(createElement(ProductPaths, resolved.data));
    for (const product of Object.values(inputs.productsById)) expect(html).toContain(product!.price.display);
    expect(html).toContain('/offer/core-selected'); expect(html).toContain('Core prior price'); expect(html).toContain('Core tax note'); expect(html).toContain('30');
    expect(resolveProductPaths(pathsSpec, pathsFixture('pl', 'long')).success).toBe(true);
  });
});
