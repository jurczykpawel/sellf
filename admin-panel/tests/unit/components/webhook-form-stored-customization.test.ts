// @vitest-environment happy-dom
/**
 * Regression: saving a webhook must not rewrite payload customisation the admin did not touch,
 * and an edit to one extra field keeps the other values' JSON types.
 */
import React, { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import WebhookFormModal from '@/components/webhooks/WebhookFormModal';
import type { WebhookEndpoint } from '@/types/webhooks';

vi.mock('next-intl', async (importOriginal) => {
  const { createNextIntlMock } = await import('@/../tests/mocks/next-intl');
  return createNextIntlMock(await importOriginal<typeof import('next-intl')>());
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useProducts', () => ({ useProductsDropdown: () => ({ products: [], loading: false, fetchProducts: vi.fn() }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/client')>()), api: { postCustom: vi.fn() } }));

/** Stored endpoint as GET /api/v1/webhooks/:id returns it (map values of any JSON type, selection as a list). */
const stored = {
  id: 'w1', url: 'https://hooks.test/x', description: 'Hook', events: ['purchase.completed'], is_active: true,
  secret: 'whsec_…', product_filter_mode: 'all', product_ids: [], created_at: '', updated_at: '',
  custom_payload_fields: { source: 'sellf', priority: 3, meta: { plan: 'pro' } },
  payload_field_selection: ['customer', 'order'],
  has_custom_headers: true, custom_header_names: ['X-Token'],
} as unknown as WebhookEndpoint;

afterEach(() => { cleanup(); });

function renderForm() {
  vi.stubGlobal('React', React);
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(createElement(WebhookFormModal, { isOpen: true, onClose: vi.fn(), onSubmit, editingEndpoint: stored, isSubmitting: false }));
  return onSubmit;
}

it('a description-only save sends no payload customisation', () => {
  const onSubmit = renderForm();
  fireEvent.change(screen.getByDisplayValue('Hook'), { target: { value: 'Renamed' } });
  fireEvent.submit(document.getElementById('webhook-form')!);
  const sent = onSubmit.mock.calls[0][0];
  expect(sent.description).toBe('Renamed');
  expect(sent).not.toHaveProperty('custom_payload_fields');
  expect(sent).not.toHaveProperty('payload_field_selection');
  expect(sent).not.toHaveProperty('custom_headers');
});

it('editing one extra field keeps the other values and their types', () => {
  const onSubmit = renderForm();
  fireEvent.click(screen.getByText('customization.title'));
  fireEvent.change(screen.getByDisplayValue('sellf'), { target: { value: 'shop' } });
  fireEvent.submit(document.getElementById('webhook-form')!);
  const sent = onSubmit.mock.calls[0][0];
  expect(sent.custom_payload_fields).toEqual({ source: 'shop', priority: 3, meta: { plan: 'pro' } });
  expect(sent).not.toHaveProperty('payload_field_selection');
});
