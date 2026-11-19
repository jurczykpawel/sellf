import { expect, it, vi } from 'vitest';
import type { Product } from '@/types';
const state = vi.hoisted(() => ({ ids: ['archived'], products: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createPublicClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: state.ids.map(id => ({ component_product_id: id, component: null })), error: null }) }) }) }) }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: state.products }) }));
vi.mock('@/lib/actions/payment-config', () => ({ getPublicPaymentConfig: async () => null }));
vi.mock('@/types/payment-config', () => ({ extractExpressCheckoutConfig: () => undefined }));
vi.mock('@/lib/license/public-snapshot', () => ({ checkPublicFeature: async () => true }));
vi.mock('@/lib/actions/shop-config', () => ({ getShopConfig: async () => null }));
vi.mock('@/lib/stripe/checkout-config', () => ({ getCheckoutConfig: async () => ({ collect_terms_of_service: false }) }));
vi.mock('@/lib/checkout/invoice-recipient-setting', () => ({ readInvoiceRecipientEnabled: async () => false }));
vi.mock('@/lib/checkout-templates/registry', () => ({ getTemplate: () => ({ Component: () => null }) }));
import ProductPurchasePage from '@/components/ProductPurchasePage';

it('shows an archived component authorized by public bundle membership', async () => {
  state.ids = ['archived'];
  state.products.mockReturnValue({ select: () => ({ in: async (_field: string, ids: string[]) => ({
    data: ids.map(id => ({ id, name: 'Archived course', icon: null, slug: 'course', price: 20 })), error: null,
  }) }) });
  const view = await ProductPurchasePage({ product: { id: 'bundle', is_bundle: true } as Product });
  expect(view.props.bundleComponents).toEqual([expect.objectContaining({ id: 'archived', name: 'Archived course' })]);
});
it('does not read privileged component metadata when the bundle has no public mappings', async () => {
  state.ids = []; state.products.mockClear();
  const view = await ProductPurchasePage({ product: { id: 'private-bundle', is_bundle: true } as Product });
  expect(view.props.bundleComponents).toEqual([]);
  expect(state.products).not.toHaveBeenCalled();
});
it('keeps checkout available if component metadata cannot be read', async () => {
  state.ids = ['unavailable'];
  state.products.mockReturnValue({ select: () => ({ in: async () => ({ data: null, error: { code: 'unavailable' } }) }) });
  const view = await ProductPurchasePage({ product: { id: 'bundle-read-error', is_bundle: true } as Product });
  expect(view.props.bundleComponents).toEqual([]);
});
it('does not publish an incomplete component sum when a member is missing', async () => {
  state.ids = ['gone'];
  state.products.mockReturnValue({ select: () => ({ in: async () => ({ data: [], error: null }) }) });
  const view = await ProductPurchasePage({ product: { id: 'bundle-missing-member', is_bundle: true } as Product });
  expect(view.props.bundleComponents).toEqual([]);
});
