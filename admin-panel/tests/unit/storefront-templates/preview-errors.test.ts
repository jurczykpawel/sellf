import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ code: 'CONFLICT' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/storefront-templates/http', () => ({ templateRequestPrincipal: async () => ({}) }));
vi.mock('@/lib/storefront-templates/preview', () => ({ preparePreview: async () => ({ success: false, code: state.code }) }));
vi.mock('@/lib/actions/shop-config', () => ({ getShopConfig: vi.fn() }));
vi.mock('@/components/storefront/StorefrontComposition', () => ({ default: () => createElement('div') }));
import TemplatePreview from '@/app/template-preview/[revision]/page';
it.each(['en', 'pl'] as const)('distinguishes an expired link from a changed draft in %s', async locale => {
  const render = async (issuedAt: number) => renderToStaticMarkup(await TemplatePreview({ params: Promise.resolve({ revision: '59' }), searchParams: Promise.resolve({ locale, fixture: 'standard', issuedAt: String(issuedAt) }) }));
  const expired = await render(Date.now() - 600001);
  expect(expired).toContain(locale === 'pl' ? 'Podgląd wygasł' : 'Preview expired');
  const changed = await render(Date.now());
  expect(changed).toContain(locale === 'pl' ? 'To nie jest bieżący szkic' : 'This is not the current draft');
  expect(changed).not.toContain(locale === 'pl' ? 'Podgląd wygasł' : 'Preview expired');
});
