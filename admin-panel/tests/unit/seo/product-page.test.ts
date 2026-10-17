import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactElement } from 'react';
import type { Product } from '@/types';

const { state, redirect, purchase, view, content } = vi.hoisted(() => ({
  state: { product: {} as Product, userId: null as string | null, access: [] as { access_expires_at: string | null; access_duration_days: number | null; access_granted_at: string }[] },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
  purchase: vi.fn(), view: vi.fn(), content: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect, notFound: () => { throw new Error('not-found'); } }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/supabase/server', () => ({
  createPublicClient: () => ({ from: () => ({ select: () => ({ eq: () => ({
    single: async () => ({ data: state.product, error: null }),
  }) }) }) }),
  createClient: async () => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: async () => ({ data: state.access }) };
    return { auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }) }, from: () => query };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/license/public-snapshot', () => ({ checkPublicFeature: () => false }));
vi.mock('@/lib/license-keys/lookup', () => ({ findIssuedLicense: vi.fn(), toIssuedLicenseResponse: vi.fn() }));
vi.mock('@/lib/actions/shop-config', () => ({ getShopConfig: vi.fn() }));
vi.mock('@/lib/services/product-content-config', () => ({ loadProductContentConfig: content }));
vi.mock('@/components/ProductPurchasePage', () => ({ default: purchase }));
vi.mock('@/app/[locale]/p/[slug]/components/ProductView', () => ({ default: view }));
import ProductPage, { generateMetadata } from '@/app/[locale]/p/[slug]/page';

afterEach(() => vi.unstubAllEnvs());

const params = Promise.resolve({ slug: 'course', locale: 'pl' });

beforeEach(() => {
  vi.clearAllMocks();
  state.userId = null; state.access = [];
  content.mockResolvedValue({ content_items: [] });
  vi.stubEnv('SITE_URL', 'https://shop.example');
  state.product = { id: 'a', slug: 'course', name: 'Course', description: 'Learn', price: 100,
    sale_price: 70, currency: 'PLN', is_active: true, is_listed: true } as Product;
});

describe('indexable product page', () => {
  it('renders the purchase view and its matching Product data for a visitor', async () => {
    const result = await ProductPage({ params });
    expect(isValidElement(result)).toBe(true);
    const children = (result as ReactElement<{ children: ReactElement[] }>).props.children;
    expect(children[0].type).toBe('script');
    expect(JSON.parse((children[0].props as { dangerouslySetInnerHTML: { __html: string } }).dangerouslySetInnerHTML.__html))
      .toMatchObject({ offers: { price: 70 }, url: 'https://shop.example/pl/p/course' });
    expect(children[1].type).toBe(purchase);
    expect((children[1].props as { product: Product }).product).toBe(state.product);
    expect(redirect).not.toHaveBeenCalled();
    expect(content).not.toHaveBeenCalled();
  });

  it('keeps the content view for an existing buyer after the purchase window closes', async () => {
    state.userId = 'buyer';
    state.access = [{ access_expires_at: null, access_duration_days: null, access_granted_at: '2026-01-01T00:00:00Z' }];
    state.product.available_until = '2000-01-01T00:00:00Z';
    const result = await ProductPage({ params }) as ReactElement<{ outcome: { kind: string }; initialSecureData: { product: { content_config: unknown } } }>;
    expect(result.type).toBe(view);
    expect(result.props.outcome.kind).toBe('render-content');
    expect(result.props.initialSecureData.product.content_config).toEqual({ content_items: [] });
    expect(content).toHaveBeenCalledExactlyOnceWith(expect.any(Object), 'a');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('sets locale-aware canonical metadata and excludes unlisted products from indexing', async () => {
    expect(await generateMetadata({ params })).toMatchObject({
      alternates: { canonical: 'https://shop.example/pl/p/course' }, robots: { index: true },
    });
    state.product.is_listed = false;
    expect(await generateMetadata({ params })).toMatchObject({ robots: { index: false } });
    await expect(ProductPage({ params })).rejects.toThrow('redirect:/pl/checkout/course');
  });

  it('retains checkout context for offer and coupon links', async () => {
    await expect(ProductPage({ params, searchParams: Promise.resolve({ coupon: 'SAVE', oto: 'offer' }) }))
      .rejects.toThrow('redirect:/pl/checkout/course?coupon=SAVE&oto=offer');
  });

  it('does not publish an offer outside the sale window', async () => {
    state.product.available_until = '2000-01-01T00:00:00Z';
    const result = await ProductPage({ params });
    expect((result as ReactElement).type).not.toBe(purchase);
    expect(await generateMetadata({ params })).toMatchObject({ robots: { index: false } });
  });
});
