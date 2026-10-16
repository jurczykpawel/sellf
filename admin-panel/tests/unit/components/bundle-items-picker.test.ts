// @vitest-environment happy-dom
/** Bundle item selection retains its eligibility and price comparison rules. */
import React, { useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { BundleItemsSection } from '@/components/ProductFormModal/sections/BundleItemsSection';
import { initialFormData } from '@/components/ProductFormModal/types';
import type { Product } from '@/types';
import en from '@/messages/en.json';
afterEach(cleanup);
it('uses the shared name picker, excludes ineligible products and keeps the bundle comparison', () => {
  const product = (id: string, name: string, extra: Partial<Product> = {}): Product => ({ ...initialFormData, id, name, slug: id, layout_template: 'default', is_bundle: false, created_at: '', updated_at: '', price: 50, ...extra });
  const products = [product('a', 'Workshop'), product('b', 'Bundle', { is_bundle: true }), product('c', 'Subscription', { product_type: 'subscription' }), product('self', 'This bundle')];
  function Harness() {
    const [formData, setFormData] = useState({ ...initialFormData, price: 30 });
    return React.createElement(BundleItemsSection, { formData, setFormData, products, currentProductId: 'self', t: key => key });
  }
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(Harness)));
  expect(view.getByRole('button', { name: 'Add Workshop' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Add Bundle' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Add Subscription' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Add This bundle' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Add Workshop' }));
  expect(view.getByText('bundle.savings')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Remove Workshop' }));
  expect(view.queryByText('bundle.savings')).toBeNull();
});
