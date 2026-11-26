// @vitest-environment happy-dom
/**
 * Regression: admin edit forms are seeded from list rows. A reopen after a confirmed save must never
 * show the pre-save row (even when the list refresh is slow or fails), a form must not close or save
 * twice mid-save, and an older list response must not replace a newer one.
 */
import React, { StrictMode, createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OrderBumpsPageContent from '@/components/OrderBumpsPageContent';
import VariantsPageContent from '@/components/VariantsPageContent';
import WebhooksPageContent from '@/components/WebhooksPageContent';

const mocks = vi.hoisted(() => ({ getCustom: vi.fn(), listAll: vi.fn(), update: vi.fn(), rpc: vi.fn() }));

vi.mock('next-intl', async (importOriginal) => {
  const { createNextIntlMock } = await import('@/../tests/mocks/next-intl');
  return createNextIntlMock(await importOriginal<typeof import('next-intl')>());
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/useProducts', () => ({ fetchAllProductsForDropdown: async () => [] }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/client')>()),
  api: { getCustom: mocks.getCustom, listAll: mocks.listAll, update: mocks.update },
}));

type Stub = { title: string; save: () => void; close: () => void };
const dialogStub = ({ title, save, close }: Stub) =>
  createElement('div', { role: 'dialog' },
    createElement('output', null, title),
    createElement('button', { onClick: close }, 'close'),
    createElement('button', { onClick: save }, 'save'));

vi.mock('@/components/webhooks/WebhookFormModal', () => ({
  default: ({ isOpen, editingEndpoint, onSubmit, onClose }: { isOpen: boolean; editingEndpoint: { description: string } | null; onSubmit: (d: unknown) => Promise<void>; onClose: () => void }) =>
    isOpen ? dialogStub({ title: editingEndpoint?.description ?? '', close: onClose, save: () => { void onSubmit({ description: 'Saved', events: ['purchase.completed'] }); } }) : null,
}));
vi.mock('@/components/webhooks/WebhookListTable', () => ({
  default: ({ endpoints, onEdit }: { endpoints: { id: string; description: string }[]; onEdit: (e: unknown) => void }) =>
    createElement('div', null, endpoints.map(e => createElement('button', { key: e.id, onClick: () => onEdit(e) }, `edit ${e.description}`))),
}));
vi.mock('@/components/webhooks/WebhookTestModal', () => ({ default: () => null }));
vi.mock('@/components/webhooks/WebhookDeleteModal', () => ({ default: () => null }));
vi.mock('@/components/WebhookLogsDrawer', () => ({ default: () => null }));
vi.mock('@/components/WebhookFailuresPanel', () => ({ default: () => null }));
vi.mock('@/components/webhooks/AbandonedEventsPanel', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));

const product = (id: string) => ({ id, name: `Product ${id}`, slug: id, price: 50, currency: 'PLN', icon: null, is_active: true });
const bump = (bump_title: string) => ({
  id: 'b1', main_product_id: 'p1', bump_product_id: 'p2', bump_price: null, bump_title, bump_description: null,
  is_active: true, display_order: 0, access_duration_days: null, urgency_duration_minutes: null, created_at: '', updated_at: '',
  main_product: product('p1'), bump_product: product('p2'),
});
const group = (name: string) => ({
  id: 'g1', name, slug: 'g1', is_active: true, created_at: '', updated_at: '',
  products: ['p1', 'p2'].map((id, i) => ({ id: `gp${i}`, product_id: id, group_id: 'g1', variant_name: null, display_order: i, is_featured: false, created_at: '', product: product(id) })),
});
const endpoint = (description: string, events = ['purchase.completed']) => ({ id: 'w1', url: 'https://hooks.test/x', description, events, is_active: true });
const endpoints = (...rows: ReturnType<typeof endpoint>[]) => ({ data: rows, truncated: false });

const never = () => new Promise<never>(() => {});
const shown = (view: ReturnType<typeof render>) => view.getByRole('dialog').querySelector('output')?.textContent;
const groupModal = (view: ReturnType<typeof render>) => view.queryByTestId('variant-group-modal');
const groupName = (view: ReturnType<typeof render>) => (view.getByPlaceholderText('groupNamePlaceholder') as HTMLInputElement).value;

beforeEach(() => { vi.stubGlobal('React', React); });
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// ===== ORDER BUMPS =====

it('order bumps: an older list response does not replace a newer one', async () => {
  const resolvers: ((rows: unknown) => void)[] = [];
  mocks.getCustom.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));
  const view = render(createElement(StrictMode, null, createElement(OrderBumpsPageContent)));
  await act(async () => {});
  expect(resolvers).toHaveLength(2);
  await act(async () => { resolvers[1]([bump('Newer')]); });
  await act(async () => { resolvers[0]([bump('Older')]); });
  expect(view.queryByText('Newer')).not.toBeNull();
  expect(view.queryByText('Older')).toBeNull();
});

// ===== VARIANT GROUPS (real form modal) =====

it('variant groups: the modal cannot be closed and saves once while the save runs; the refreshing list offers no stale group', async () => {
  let resolveSave!: (value: unknown) => void;
  let failRefresh!: (err: Error) => void;
  mocks.getCustom.mockResolvedValueOnce([group('Before')]).mockImplementationOnce(() => new Promise((_, reject) => { failRefresh = reject; }));
  mocks.update.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
  const view = render(createElement(VariantsPageContent));
  await act(async () => {});
  fireEvent.click(view.getByTitle('edit'));
  expect(groupName(view)).toBe('Before');

  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'saveChanges' })); });
  const saving = view.getByRole('button', { name: 'saving' }) as HTMLButtonElement;
  expect(saving.disabled).toBe(true);
  fireEvent.submit(saving.closest('form')!);
  fireEvent.click(view.getByRole('button', { name: 'cancel' }));
  fireEvent.click(groupModal(view)!.parentElement!.previousElementSibling!);
  expect(groupModal(view)).not.toBeNull();
  expect(mocks.update).toHaveBeenCalledTimes(1);

  await act(async () => { resolveSave(group('Saved')); });
  expect(groupModal(view)).toBeNull();
  expect(view.queryByTitle('edit')).toBeNull();
  await act(async () => { failRefresh(new Error('offline')); });
  expect(view.queryByText('loadError')).not.toBeNull();
  expect(view.queryByTitle('edit')).toBeNull();
});

it('variant groups: an older list response does not replace a newer one', async () => {
  const resolvers: ((rows: unknown) => void)[] = [];
  mocks.getCustom.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));
  const view = render(createElement(StrictMode, null, createElement(VariantsPageContent)));
  await act(async () => {});
  expect(resolvers).toHaveLength(2);
  await act(async () => { resolvers[1]([group('Newer')]); });
  await act(async () => { resolvers[0]([group('Older')]); });
  expect(view.queryByText(/Newer/)).not.toBeNull();
  expect(view.queryByText(/Older/)).toBeNull();
});

// ===== WEBHOOKS =====

it('webhooks: a reopen during a pending or failed list refresh shows the saved endpoint', async () => {
  let failRefresh!: (err: Error) => void;
  mocks.listAll.mockResolvedValueOnce(endpoints(endpoint('Before'))).mockImplementationOnce(() => new Promise((_, reject) => { failRefresh = reject; }));
  mocks.update.mockResolvedValue(endpoint('Saved'));
  const view = render(createElement(WebhooksPageContent));
  await act(async () => {});
  fireEvent.click(view.getByRole('button', { name: 'edit Before' }));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  expect(view.queryByRole('dialog')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'edit Saved' }));
  expect(shown(view)).toBe('Saved');
  fireEvent.click(view.getByRole('button', { name: 'close' }));
  await act(async () => { failRefresh(new Error('offline')); });
  fireEvent.click(view.getByRole('button', { name: 'edit Saved' }));
  expect(shown(view)).toBe('Saved');
});

it('webhooks: ignores a close request while the save is in flight', async () => {
  let resolveSave!: (value: unknown) => void;
  mocks.listAll.mockResolvedValueOnce(endpoints(endpoint('Before'))).mockImplementation(never);
  mocks.update.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
  const view = render(createElement(WebhooksPageContent));
  await act(async () => {});
  fireEvent.click(view.getByRole('button', { name: 'edit Before' }));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  fireEvent.click(view.getByRole('button', { name: 'close' }));
  expect(view.queryByRole('dialog')).not.toBeNull();
  await act(async () => { resolveSave(endpoint('Saved')); });
  expect(view.queryByRole('dialog')).toBeNull();
});

it('webhooks: confirming the waitlist warning twice saves once', async () => {
  let resolveSave!: (value: unknown) => void;
  mocks.listAll.mockResolvedValueOnce(endpoints(endpoint('Before', ['waitlist.signup']))).mockImplementation(never);
  mocks.rpc.mockResolvedValue({ data: { products_count: 2 } });
  mocks.update.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
  const view = render(createElement(WebhooksPageContent));
  await act(async () => {});
  fireEvent.click(view.getByRole('button', { name: 'edit Before' }));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  const confirm = view.getByRole('button', { name: 'waitlistWarning.confirmEdit' });
  await act(async () => { fireEvent.click(confirm); });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: /waitlistWarning.confirmEdit/ })); });
  expect(mocks.update).toHaveBeenCalledTimes(1);
  await act(async () => { resolveSave(endpoint('Saved')); });
  expect(view.queryByRole('button', { name: /waitlistWarning.confirmEdit/ })).toBeNull();
});

it('webhooks: an older list response does not replace a newer one', async () => {
  const resolvers: ((page: unknown) => void)[] = [];
  mocks.listAll.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));
  const view = render(createElement(StrictMode, null, createElement(WebhooksPageContent)));
  await act(async () => {});
  expect(resolvers).toHaveLength(2);
  await act(async () => { resolvers[1](endpoints(endpoint('Newer'))); });
  await act(async () => { resolvers[0](endpoints(endpoint('Older'))); });
  expect(view.queryByRole('button', { name: 'edit Newer' })).not.toBeNull();
  expect(view.queryByRole('button', { name: 'edit Older' })).toBeNull();
});
