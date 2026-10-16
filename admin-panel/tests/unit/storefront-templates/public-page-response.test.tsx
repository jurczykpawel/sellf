/** Unavailable storefront rendering terminates at the HTTP failure response. */
import { expect, it, vi } from 'vitest';
import PublicStorefrontPage from '@/components/storefront/PublicStorefrontPage';
const redirect = vi.hoisted(() => vi.fn((path: string) => { throw new Error(path); }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/actions/shop-config', () => ({ getShopConfig: async () => null }));
vi.mock('@/lib/storefront-templates/public-page', () => ({ loadPublicStorefront: async () => ({ success: false }) }));
it('redirects unavailable reads before rendering a successful page shell', async () => {
  await expect(PublicStorefrontPage({ locale: 'pl', searchParams: {} })).rejects.toThrow('/api/storefront/unavailable?locale=pl');
  expect(redirect).toHaveBeenCalledExactlyOnceWith('/api/storefront/unavailable?locale=pl');
});
