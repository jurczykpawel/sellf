/** Portable section evidence, independent of the session application. */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { beforeAll, expect, it, vi } from 'vitest';
import { D_CONFIG, D_TOKENS, DEFAULT_CONFIG, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { resolvePresentation, resolveSelection } from '@/lib/storefront-templates/resolver';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { renderPreviewMarkup } from '@sellf/template-preview';
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
let render: typeof renderPreviewMarkup;
beforeAll(() => {
  execFileSync('bun', ['run', 'template:preview-build'], { stdio: 'pipe' });
  render = createRequire(import.meta.url)('@sellf/template-preview').renderPreviewMarkup;
});
it.each(['en', 'pl'] as const)('renders real sections with inert controls and %s lang', async locale => {
  for (const config of [DEFAULT_CONFIG, D_CONFIG]) {
    const products = PUBLIC_FIXTURE.products as PublicProductInfo[];
    const selection = resolveSelection(config, ['default', 'd']);
    const page = { products, nextCursor: null };
    const model = resolvePresentation(selection, { locale, productsById: Object.fromEntries(products.map(p => [p.id, p])), categoriesById: Object.fromEntries(PUBLIC_FIXTURE.categories.map(c => [c.id, c])), catalogue: { variant: config.templateId === 'd' ? 'detail-cards' : 'default-groups', groups: config.templateId === 'd' ? { all: page } : { featured: page, free: page, paid: page }, filters: ['category'], pageSize: 9, density: 'comfortable', locale, categories: PUBLIC_FIXTURE.categories } });
    const snapshot = await render({ model, tokens: D_TOKENS });
    expect(snapshot.html).toContain(`<html lang="${locale}">`);
    expect(snapshot.html).toContain(`data-template="${config.templateId}"`);
    expect(snapshot.html).not.toMatch(/<script|<form|href=|onClick|srcSet=|<link|<iframe/);
    expect(snapshot.html).toMatch(/<button[^>]*disabled/);
    expect(snapshot.html).toContain('aria-disabled="true"');
    expect(snapshot.html).toContain('Example 1');
    expect(snapshot.css).toContain('--sf-accent');
    expect(snapshot.assets).toEqual([{ id: 'geist', url: '/api/storefront/preview-font/geist', kind: 'font' }]);
  }
});
it('retains seller text as text and lists only actual public media', async () => {
  const config = structuredClone(D_CONFIG);
  const product: PublicProductInfo = { ...PUBLIC_FIXTURE.products[0], title: '<script>example</script>', marketing: { format: 'workshop', sourceLocale: 'en', en: { result: null, tools: [], requirements: [] } }, price: { ...PUBLIC_FIXTURE.products[0].price, kind: 'one-time' }, image: { src: 'https://media.example.com/cover.webp', alt: 'Example cover', width: 1200, height: 800 }, availability: 'available' };
  const model = resolvePresentation(resolveSelection(config, ['d']), { locale: 'en', productsById: { [product.id]: product }, categoriesById: {}, catalogue: { variant: 'detail-cards', groups: { all: { products: [product], nextCursor: null } }, filters: [], pageSize: 9, density: 'comfortable', locale: 'en' } });
  const snapshot = await render({ model, tokens: { ...D_TOKENS, typography: { ...D_TOKENS.typography, font: 'dm-sans' } } });
  expect(snapshot.html).toContain('&lt;script&gt;example&lt;/script&gt;');
  expect(snapshot.html).not.toContain('<script>');
  expect(snapshot.assets).toContainEqual({ id: product.id, url: product.image!.src, kind: 'image' });
  expect(snapshot.assets.filter(a => a.kind === 'font')).toEqual([{ id: 'dm-sans', url: '/api/storefront/preview-font/dm-sans', kind: 'font' }]);
});
