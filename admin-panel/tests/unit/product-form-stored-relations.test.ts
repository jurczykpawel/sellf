// @vitest-environment happy-dom
/**
 * Regression: editing a stored product must never save empty relations it has not read yet.
 * Categories and tags come with the stored product (GET /api/v1/products/:id embeds them);
 * the OTO offer and bundle components are read separately, and saving waits for those reads
 * and stays blocked when one fails.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type React from 'react';
import { useProductForm } from '@/components/ProductFormModal/hooks/useProductForm';
import type { Product } from '@/types';

const mocks = vi.hoisted(() => ({ getCustom: vi.fn(), bundleRead: vi.fn(), getProductCategories: vi.fn(), getProductTags: vi.fn() }));

vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/components/providers/config-provider', () => {
  const config = { trustedDownloadDomains: [] };
  return { useConfig: () => config };
});
vi.mock('@/lib/actions/categories', () => ({ getCategories: vi.fn().mockResolvedValue({ success: true, data: [] }), getProductCategories: mocks.getProductCategories }));
vi.mock('@/lib/actions/tags', () => ({ getTags: vi.fn().mockResolvedValue({ success: true, data: [] }), getProductTags: mocks.getProductTags }));
vi.mock('@/lib/actions/shop-config', () => ({
  getMyShopConfig: vi.fn().mockResolvedValue({ default_currency: 'PLN', tax_rate: 0.23, omnibus_enabled: false, tax_mode: 'local', is_vat_exempt: false }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: { has_webhook: true, products_count: 0 }, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ order: mocks.bundleRead }) }) }),
  }),
}));
vi.mock('@/hooks/useProducts', () => ({ fetchAllProductsForDropdown: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/client')>()), api: { getCustom: mocks.getCustom } }));
vi.mock('@/utils/themeUtils', () => ({ getIconEmoji: () => '🚀' }));

/** Stored product as GET /api/v1/products/:id returns it: categories and tags embedded. */
const stored = (extra: Partial<Product> = {}) => ({
  id: 'p1', name: 'Course', slug: 'course', description: 'About', price: 50, currency: 'PLN', vat_rate: 23,
  is_active: true, product_type: 'one_time', content_delivery_type: 'content', content_config: { content_items: [] },
  categories: [{ id: 'c1', name: 'Cat', slug: 'cat' }], tags: [{ id: 't1', name: 'Tag', slug: 'tag' }],
  ...extra,
}) as unknown as Product;

const submitEvent = { preventDefault: () => {} } as React.FormEvent;
const onSubmit = vi.fn().mockResolvedValue(undefined);

function open(product: Product) {
  return renderHook(() => useProductForm({ product, isOpen: true, onSubmit }));
}

beforeEach(() => {
  mocks.getProductCategories.mockImplementation(() => new Promise(() => {}));
  mocks.getProductTags.mockImplementation(() => new Promise(() => {}));
  mocks.bundleRead.mockResolvedValue({ data: [{ component_product_id: 'p2' }], error: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('starts categories and tags from the stored product', async () => {
  mocks.getCustom.mockResolvedValue({ has_oto: false });
  const { result } = open(stored());
  await act(async () => {});
  expect(result.current.formData.categories).toEqual(['c1']);
  expect(result.current.formData.tags).toEqual(['t1']);
  await act(async () => { await result.current.handleSubmit(submitEvent); });
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ categories: ['c1'], tags: ['t1'] }));
});

it('does not save while the OTO read is pending, nor after it fails', async () => {
  let failOto!: (err: Error) => void;
  mocks.getCustom.mockImplementation(() => new Promise((_, reject) => { failOto = reject; }));
  const { result } = open(stored());
  await act(async () => {});
  await act(async () => { await result.current.handleSubmit(submitEvent); });
  expect(onSubmit).not.toHaveBeenCalled();

  await act(async () => { failOto(new Error('offline')); });
  expect(result.current.storedDataState).toBe('failed');
  await act(async () => { await result.current.handleSubmit(submitEvent); });
  expect(onSubmit).not.toHaveBeenCalled();
});

it('does not save a bundle whose components could not be read', async () => {
  mocks.getCustom.mockResolvedValue({ has_oto: false });
  mocks.bundleRead.mockResolvedValue({ data: null, error: { message: 'offline' } });
  const { result } = open(stored({ is_bundle: true }));
  await act(async () => {});
  expect(result.current.storedDataState).toBe('failed');
  await act(async () => { await result.current.handleSubmit(submitEvent); });
  expect(onSubmit).not.toHaveBeenCalled();
});

it('saves the stored OTO offer and bundle components once they are read', async () => {
  mocks.getCustom.mockResolvedValue({ has_oto: true, oto_product_id: 'p3', discount_type: 'percentage', discount_value: 30, duration_minutes: 10 });
  const { result } = open(stored({ is_bundle: true }));
  await act(async () => {});
  expect(result.current.storedDataState).toBe('ready');
  await act(async () => { await result.current.handleSubmit(submitEvent); });
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ bundleItemIds: ['p2'], oto_enabled: true, oto_product_id: 'p3' }));
});
