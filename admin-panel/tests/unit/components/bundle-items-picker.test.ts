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
import pl from '@/messages/pl.json';
afterEach(cleanup);
it('uses the shared name picker, excludes ineligible products and keeps the bundle comparison', () => {
  const product = (id: string, name: string, extra: Partial<Product> = {}): Product => ({ ...initialFormData, id, name, slug: id, layout_template: 'default', is_bundle: false, created_at: '', updated_at: '', price: 50, ...extra });
  const products = [product('a', 'Workshop'), product('b', 'Bundle', { is_bundle: true }), product('c', 'Subscription', { product_type: 'subscription' }), product('self', 'This bundle'), product('archived', 'Archived course', { archived_at: '2026-11-01T00:00:00Z' })];
  function Harness() {
    const [formData, setFormData] = useState({ ...initialFormData, price: 30 });
    return React.createElement(BundleItemsSection, { formData, setFormData, products, currentProductId: 'self', t: key => key });
  }
  const view = render(React.createElement(NextIntlClientProvider, { locale: 'en', messages: en }, React.createElement(Harness)));
  expect(view.getByRole('button', { name: 'Add Workshop' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Add Archived course' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Add Bundle' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Add Subscription' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Add This bundle' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Add Workshop' }));
  expect(view.getByText('bundle.savings')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Remove Workshop' }));
  expect(view.queryByText('bundle.savings')).toBeNull();
});

for (const [locale, messages] of [['en', en], ['pl', pl]] as const) {
  it(`explains an archived component rejection in ${locale}`, () => {
    const view = render(React.createElement(NextIntlClientProvider, { locale, messages },
      React.createElement(BundleItemsSection, { formData: initialFormData, setFormData: () => {}, products: [],
        fieldErrors: { bundleItemIds: 'invalid' }, t: key => key === 'bundle.archivedHelp' ? messages.admin.products.form.bundle.archivedHelp : key })));
    expect(view.getByRole('alert').textContent).toBe(messages.admin.products.form.bundle.archivedHelp);
  });
}

for (const [locale, messages] of [['en', en], ['pl', pl]] as const) {
  it(`an archived bundle shows its components as locked until restored (${locale})`, () => {
    const workshop = { ...initialFormData, id: 'a', name: 'Workshop', slug: 'a', layout_template: 'default', is_bundle: false, created_at: '', updated_at: '', price: 50 } as Product;
    const locked = messages.admin.products.form.bundle.lockedArchived;
    const view = render(React.createElement(NextIntlClientProvider, { locale, messages },
      React.createElement(BundleItemsSection, { formData: { ...initialFormData, bundleItemIds: ['a'] }, setFormData: () => {}, products: [workshop], archived: true,
        t: key => key === 'bundle.lockedArchived' ? locked : key })));
    expect(locked).toBeTruthy();
    expect(view.getByText(locked)).toBeTruthy();
    expect(view.getByText('Workshop')).toBeTruthy();
    // No control to add, remove or reorder components.
    expect(view.queryByRole('button')).toBeNull();
    expect(view.queryByRole('searchbox')).toBeNull();
    expect(view.queryByRole('textbox')).toBeNull();
  });
}
