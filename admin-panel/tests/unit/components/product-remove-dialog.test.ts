// @vitest-environment happy-dom
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProductRemoveDialog from '@/components/ProductRemoveDialog';
import { initialFormData } from '@/components/ProductFormModal/types';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import type { Product } from '@/types';

const { getCustom } = vi.hoisted(() => ({ getCustom: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { getCustom } }));
afterEach(cleanup);

for (const [locale, messages] of [['en', en], ['pl', pl]] as const) {
  for (const mode of ['remove', 'permanent'] as const) {
    it(`identifies containing bundles and disables ${mode} in ${locale}`, async () => {
      getCustom.mockResolvedValue({ orders: 1, invoices: 0, licenses: 0, accesses: 0, subscriptions: 0,
        activeSubscriptions: 0, futureReservations: 0, affiliateRules: 0, affiliateCommissions: 0,
        bundles: 1, bundleReferences: [{ id: 'bundle', name: 'Complete course' }], hasHistory: true });
      const product = { ...initialFormData, id: 'component', name: 'Lesson', slug: 'lesson', created_at: '', updated_at: '', layout_template: 'default' } as Product;
      const view = render(React.createElement(NextIntlClientProvider, { locale, messages },
        React.createElement(ProductRemoveDialog, { product, mode, onClose: vi.fn(), onDone: vi.fn() })));
      await waitFor(() => expect(view.getByTestId('product-remove-dialog').textContent).toContain('Complete course'));
      const label = mode === 'permanent' ? messages.admin.products.remove.permanentConfirm : messages.admin.products.remove.archiveConfirm;
      expect(view.queryByText(messages.admin.products.remove.permanentLead)).toBeNull();
      expect(view.getByTestId('product-remove-dialog').textContent).toContain(locale === 'pl' ? 'przywróć pakiet' : 'restore the bundle');
      expect((view.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(true);
    });
  }
}
