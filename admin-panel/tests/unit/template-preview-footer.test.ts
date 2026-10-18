/** The private template preview renders the same footer inputs as the public storefront. */
import { isValidElement, type ReactElement } from 'react';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ shop: { shop_name: 'Acme Books' } as { shop_name: string } | null, pro: false }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound'); } }));
vi.mock('@/lib/storefront-templates/http', () => ({ templateRequestPrincipal: async () => ({}) }));
vi.mock('@/lib/storefront-templates/preview', () => ({ preparePreview: async () => ({ success: true, data: { model: { m: 1 }, tokens: {} } }) }));
vi.mock('@/lib/license/public-snapshot', () => ({ checkPublicFeature: () => state.pro }));
vi.mock('@/lib/actions/shop-config', () => ({ getShopConfig: async () => state.shop }));
vi.mock('@/components/storefront/PublicThemeShell', () => ({ default: () => null }));
vi.mock('@/components/storefront/StorefrontComposition', () => ({ default: () => null }));
import Page from '@/app/template-preview/[revision]/page';
import Composition from '@/components/storefront/StorefrontComposition';

function compositionProps(node: unknown): Record<string, unknown> | null {
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<{ children?: unknown } & Record<string, unknown>>;
  if (element.type === Composition) return element.props;
  const kids = ([] as unknown[]).concat(element.props.children ?? []);
  for (const kid of kids) { const found = compositionProps(kid); if (found) return found; }
  return null;
}
const render = async (locale: string) => compositionProps(await Page({ params: Promise.resolve({ revision: '3' }), searchParams: Promise.resolve({ locale }) }));

it('uses the real shop name, not a placeholder, in both locales', async () => {
  for (const locale of ['pl', 'en']) expect((await render(locale))?.shopName).toBe('Acme Books');
});
it('falls back to the public storefront default and mirrors its Sellf link rule', async () => {
  state.shop = null;
  expect((await render('pl'))?.shopName).toBe('Sellf');
  expect((await render('pl'))?.showSellfBranding).toBe(true);
  state.pro = true;
  expect((await render('pl'))?.showSellfBranding).toBe(false);
});
