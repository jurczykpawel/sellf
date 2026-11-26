// @vitest-environment happy-dom
/**
 * Regression: admin edit dialogs are seeded from list rows, so after a save the dialog
 * must stay open until the refreshed list arrives; an immediate reopen then shows the saved values.
 */
import React, { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OrderBumpsPageContent from '@/components/OrderBumpsPageContent';
import VariantsPageContent from '@/components/VariantsPageContent';
import WebhooksPageContent from '@/components/WebhooksPageContent';

const mocks = vi.hoisted(() => ({ getCustom: vi.fn(), listAll: vi.fn(), update: vi.fn() }));

vi.mock('next-intl', async (importOriginal) => {
  const { createNextIntlMock } = await import('@/../tests/mocks/next-intl');
  return createNextIntlMock(await importOriginal<typeof import('next-intl')>());
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/useProducts', () => ({ fetchAllProductsForDropdown: async () => [] }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/client')>()),
  api: { getCustom: mocks.getCustom, listAll: mocks.listAll, update: mocks.update },
}));

type Stub = { editing: { title: string } | null; save: () => void };
const dialogStub = ({ editing, save }: Stub) =>
  createElement('div', { role: 'dialog' },
    createElement('output', null, editing?.title ?? ''),
    createElement('button', { onClick: save }, 'save'));

vi.mock('@/components/OrderBumpFormModal', () => ({
  default: ({ editingBump, onSubmit }: { editingBump: { bump_title: string } | null; onSubmit: (d: unknown) => Promise<void> }) =>
    dialogStub({ editing: editingBump && { title: editingBump.bump_title }, save: () => { void onSubmit({ bump_title: 'Saved' }).catch(() => {}); } }),
}));
vi.mock('@/components/VariantGroupFormModal', () => ({
  default: ({ editingGroup, onSuccess }: { editingGroup: { name: string } | null; onSuccess: () => void }) =>
    dialogStub({ editing: editingGroup && { title: editingGroup.name }, save: onSuccess }),
}));
vi.mock('@/components/webhooks/WebhookFormModal', () => ({
  default: ({ isOpen, editingEndpoint, onSubmit }: { isOpen: boolean; editingEndpoint: { description: string } | null; onSubmit: (d: unknown) => Promise<void> }) =>
    isOpen ? dialogStub({ editing: editingEndpoint && { title: editingEndpoint.description }, save: () => { void onSubmit({ description: 'Saved' }); } }) : null,
}));
vi.mock('@/components/webhooks/WebhookListTable', () => ({
  default: ({ endpoints, onEdit }: { endpoints: { id: string }[]; onEdit: (e: unknown) => void }) =>
    createElement('div', null, endpoints.map(e => createElement('button', { key: e.id, onClick: () => onEdit(e) }, 'edit'))),
}));
vi.mock('@/components/webhooks/WebhookTestModal', () => ({ default: () => null }));
vi.mock('@/components/webhooks/WebhookDeleteModal', () => ({ default: () => null }));
vi.mock('@/components/WebhookLogsDrawer', () => ({ default: () => null }));
vi.mock('@/components/WebhookFailuresPanel', () => ({ default: () => null }));
vi.mock('@/components/webhooks/AbandonedEventsPanel', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ createClient: async () => ({}) }));

const product = { id: 'p1', name: 'Course', slug: 'course', price: 50, currency: 'PLN', icon: null };
const bump = (bump_title: string) => ({
  id: 'b1', main_product_id: 'p1', bump_product_id: 'p1', bump_price: null, bump_title, bump_description: null,
  is_active: true, display_order: 0, access_duration_days: null, urgency_duration_minutes: null, created_at: '', updated_at: '',
  main_product: product, bump_product: product,
});
const group = (name: string) => ({
  id: 'g1', name, slug: 'g1', is_active: true, created_at: '', updated_at: '',
  products: [{ id: 'gp1', product_id: 'p1', group_id: 'g1', variant_name: null, display_order: 0, is_featured: false, created_at: '', product }],
});
const endpoint = (description: string) => ({ id: 'w1', url: 'https://hooks.test/x', description, events: ['purchase.completed'], is_active: true });

/** First load resolves with `before`; the refresh after the save waits until the test releases it. */
function holdRefresh<T>(fn: typeof mocks.getCustom, before: T): (after: T) => void {
  let release!: (value: T) => void;
  fn.mockResolvedValueOnce(before).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  return after => release(after);
}

async function expectDialogWaitsForRefresh(view: ReturnType<typeof render>, openEdit: () => void, releaseRefresh: () => void) {
  await act(async () => {});
  openEdit();
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  expect(view.queryByRole('dialog')).not.toBeNull();
  await act(async () => { releaseRefresh(); });
  expect(view.queryByRole('dialog')).toBeNull();
  openEdit();
  expect(view.getByRole('dialog').querySelector('output')?.textContent).toBe('Saved');
}

beforeEach(() => {
  vi.stubGlobal('React', React);
  mocks.update.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('order bumps: keeps the edit dialog open until the refreshed list arrives', async () => {
  const release = holdRefresh(mocks.getCustom, [bump('Before')]);
  const view = render(createElement(OrderBumpsPageContent));
  await expectDialogWaitsForRefresh(view, () => fireEvent.click(view.getByRole('button', { name: 'edit' })), () => release([bump('Saved')]));
});

it('variant groups: keeps the edit dialog open until the refreshed list arrives', async () => {
  const release = holdRefresh(mocks.getCustom, [group('Before')]);
  const view = render(createElement(VariantsPageContent));
  await expectDialogWaitsForRefresh(view, () => fireEvent.click(view.getByTitle('edit')), () => release([group('Saved')]));
});

it('webhooks: keeps the edit dialog open until the refreshed list arrives', async () => {
  const release = holdRefresh(mocks.listAll, { data: [endpoint('Before')], truncated: false });
  const view = render(createElement(WebhooksPageContent));
  await expectDialogWaitsForRefresh(view, () => fireEvent.click(view.getByRole('button', { name: 'edit' })), () => release({ data: [endpoint('Saved')], truncated: false }));
});
