// @vitest-environment happy-dom
/**
 * Regression: the webhook form starts from the stored endpoint loaded by id (never the list-row copy),
 * admin forms must not close or save twice mid-save, a finished save releases the form before the
 * list refresh, and an older list response must not replace a newer one.
 */
import React, { StrictMode, createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OrderBumpsPageContent from '@/components/OrderBumpsPageContent';
import VariantsPageContent from '@/components/VariantsPageContent';
import WebhooksPageContent from '@/components/WebhooksPageContent';

const mocks = vi.hoisted(() => ({ getCustom: vi.fn(), listAll: vi.fn(), get: vi.fn(), update: vi.fn(), create: vi.fn(), remove: vi.fn(), rpc: vi.fn(), toastError: vi.fn() }));

vi.mock('next-intl', async (importOriginal) => {
  const { createNextIntlMock } = await import('@/../tests/mocks/next-intl');
  return createNextIntlMock(await importOriginal<typeof import('next-intl')>());
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError, warning: vi.fn() } }));
vi.mock('@/hooks/useProducts', () => ({ fetchAllProductsForDropdown: async () => [] }));
vi.mock('@/lib/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api/client')>()),
  api: { getCustom: mocks.getCustom, listAll: mocks.listAll, get: mocks.get, update: mocks.update, create: mocks.create, delete: mocks.remove },
}));

type Stub = { title: string; save: () => void; close: () => void };
const dialogStub = ({ title, save, close }: Stub) =>
  createElement('div', { role: 'dialog' },
    createElement('output', null, title),
    createElement('button', { onClick: close }, 'close'),
    createElement('button', { onClick: save }, 'save'));

vi.mock('@/components/OrderBumpFormModal', () => ({
  default: ({ isSubmitting, onSubmit, onClose }: { isSubmitting: boolean; onSubmit: (d: unknown) => Promise<void>; onClose: () => void }) =>
    createElement('div', { role: 'dialog' },
      createElement('button', { onClick: onClose }, 'close'),
      createElement('button', { disabled: isSubmitting, onClick: () => { void onSubmit({ bump_title: 'New' }).catch(() => {}); } }, 'save'),
      createElement('button', { onClick: () => { void onSubmit({ bump_title: 'New' }).catch(() => {}); void onSubmit({ bump_title: 'New' }).catch(() => {}); } }, 'save twice')),
}));
// The form submits the endpoint it was seeded with plus the edit, as the real form does.
const webhookEdit = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/components/webhooks/WebhookFormModal', () => ({
  default: ({ isOpen, editingEndpoint, onSubmit, onClose }: { isOpen: boolean; editingEndpoint: Record<string, unknown> | null; onSubmit: (d: unknown) => Promise<void>; onClose: () => void }) =>
    isOpen ? dialogStub({ title: JSON.stringify(editingEndpoint?.custom_payload_fields ?? null), close: onClose, save: () => { void onSubmit({ ...editingEndpoint, ...webhookEdit.value }); } }) : null,
}));
vi.mock('@/components/webhooks/WebhookListTable', () => ({
  default: ({ endpoints, onEdit, onDelete }: { endpoints: { id: string; description: string }[]; onEdit: (e: unknown) => void; onDelete: (e: unknown) => void }) =>
    createElement('div', null, endpoints.flatMap(e => [
      createElement('button', { key: `e${e.id}`, onClick: () => onEdit(e) }, `edit ${e.description}`),
      createElement('button', { key: `d${e.id}`, onClick: () => onDelete(e) }, `delete ${e.description}`),
    ])),
}));
vi.mock('@/components/webhooks/WebhookTestModal', () => ({ default: () => null }));
vi.mock('@/components/webhooks/WebhookDeleteModal', () => ({
  default: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => Promise<void> }) =>
    isOpen ? createElement('button', { onClick: () => { void onConfirm(); } }, 'confirm delete') : null,
}));
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
/** Stored endpoint as GET /api/v1/webhooks and GET /api/v1/webhooks/:id return it. */
const storedEndpoint = (custom_payload_fields: Record<string, unknown>) => ({
  ...endpoint('Hook'), secret: 'whsec_…', product_filter_mode: 'all', product_ids: [], created_at: '', updated_at: '',
  custom_payload_fields, payload_field_selection: ['customer', 'order'], has_custom_headers: true, custom_header_names: ['X-Token'],
});
/** PATCH /api/v1/webhooks/:id response: no payload customisation or header fields. */
const patchResponse = () => {
  const { custom_payload_fields: _f, payload_field_selection: _s, has_custom_headers: _h, custom_header_names: _n, ...rest } = storedEndpoint({});
  void _f; void _s; void _h; void _n;
  return rest;
};
const endpoints = (...rows: ReturnType<typeof endpoint>[]) => ({ data: rows, truncated: false });

const never = () => new Promise<never>(() => {});
const shown = (view: ReturnType<typeof render>) => view.getByRole('dialog').querySelector('output')?.textContent;
const groupModal = (view: ReturnType<typeof render>) => view.queryByTestId('variant-group-modal');
const groupName = (view: ReturnType<typeof render>) => (view.getByPlaceholderText('groupNamePlaceholder') as HTMLInputElement).value;

beforeEach(() => { vi.stubGlobal('React', React); });
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  webhookEdit.value = {};
});

// ===== ORDER BUMPS =====

it('order bumps: a finished save releases the form before the list refresh completes', async () => {
  mocks.getCustom.mockResolvedValueOnce([bump('Before')]).mockImplementation(never);
  mocks.create.mockResolvedValue(bump('New'));
  const view = render(createElement(OrderBumpsPageContent));
  await act(async () => {});
  fireEvent.click(view.getAllByRole('button', { name: 'create' })[0]);
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  expect(view.queryByRole('dialog')).toBeNull();
  fireEvent.click(view.getAllByRole('button', { name: 'create' })[0]);
  expect((view.getByRole('button', { name: 'save' }) as HTMLButtonElement).disabled).toBe(false);
});

it('order bumps: two save clicks before a re-render save once', async () => {
  mocks.getCustom.mockResolvedValue([bump('Before')]);
  mocks.create.mockImplementation(() => new Promise(() => {}));
  const view = render(createElement(OrderBumpsPageContent));
  await act(async () => {});
  fireEvent.click(view.getAllByRole('button', { name: 'create' })[0]);
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save twice' })); });
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

it('webhooks: opening Add while an endpoint loads discards that load', async () => {
  let resolveGet!: (value: unknown) => void;
  mocks.listAll.mockResolvedValue(endpoints(storedEndpoint({ source: 'old', priority: 3 })));
  mocks.get.mockImplementation(() => new Promise(resolve => { resolveGet = resolve; }));
  const view = render(createElement(WebhooksPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit Hook' })); });
  await act(async () => { fireEvent.click(view.getAllByRole('button', { name: 'addEndpoint' })[0]); });
  expect(view.queryByText('loading')).toBeNull();
  expect(shown(view)).toBe('null');
  await act(async () => { resolveGet(storedEndpoint({ source: 'new', priority: 3 })); });
  expect(shown(view)).toBe('null');
});

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

it('webhooks: re-saving after a payload change keeps it, whatever the list or the PATCH response holds', async () => {
  // The list keeps the pre-save row (refresh failed); the PATCH response has no payload fields.
  mocks.listAll.mockResolvedValueOnce(endpoints(storedEndpoint({ source: 'old', priority: 3 }))).mockRejectedValue(new Error('offline'));
  mocks.get.mockResolvedValueOnce(storedEndpoint({ source: 'old', priority: 3 })).mockResolvedValueOnce(storedEndpoint({ source: 'new', priority: 3 }));
  mocks.update.mockResolvedValue(patchResponse());
  const view = render(createElement(WebhooksPageContent));
  await act(async () => {});

  webhookEdit.value = { custom_payload_fields: { source: 'new', priority: 3 } };
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit Hook' })); });
  expect(mocks.get).toHaveBeenLastCalledWith('webhooks', 'w1');
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  expect(view.queryByRole('dialog')).toBeNull();

  webhookEdit.value = { description: 'Renamed' };
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit Hook' })); });
  expect(shown(view)).toBe(JSON.stringify({ source: 'new', priority: 3 }));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  expect(mocks.update).toHaveBeenLastCalledWith('webhooks', 'w1', expect.objectContaining({
    description: 'Renamed', custom_payload_fields: { source: 'new', priority: 3 }, payload_field_selection: ['customer', 'order'],
  }));
});

it('webhooks: does not open the form from the list row when loading the endpoint fails', async () => {
  mocks.listAll.mockResolvedValue(endpoints(storedEndpoint({ source: 'old', priority: 3 })));
  mocks.get.mockRejectedValue(new Error('offline'));
  const view = render(createElement(WebhooksPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit Hook' })); });
  expect(view.queryByRole('dialog')).toBeNull();
  expect(mocks.toastError).toHaveBeenCalledWith('error');
});

it('webhooks: a confirmed delete removes the row before the list refresh completes', async () => {
  mocks.listAll.mockResolvedValueOnce(endpoints(storedEndpoint({}))).mockImplementation(never);
  mocks.remove.mockResolvedValue(undefined);
  const view = render(createElement(WebhooksPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'delete Hook' })); });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'confirm delete' })); });
  expect(mocks.remove).toHaveBeenCalledWith('webhooks', 'w1');
  expect(view.queryByRole('button', { name: 'edit Hook' })).toBeNull();
});

it('webhooks: a second submit while the waitlist check runs is ignored', async () => {
  let resolveCheck!: (value: unknown) => void;
  mocks.listAll.mockResolvedValueOnce(endpoints(endpoint('Before', ['waitlist.signup']))).mockImplementation(never);
  mocks.get.mockResolvedValue(endpoint('Before', ['waitlist.signup']));
  mocks.rpc.mockImplementation(() => new Promise(resolve => { resolveCheck = resolve; }));
  webhookEdit.value = { events: ['purchase.completed'] };
  const view = render(createElement(WebhooksPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit Before' })); });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  fireEvent.click(view.getByRole('button', { name: 'close' }));
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(view.queryByRole('dialog')).not.toBeNull();
  await act(async () => { resolveCheck({ data: { products_count: 2 } }); });
  expect(view.getAllByRole('button', { name: 'waitlistWarning.confirmEdit' })).toHaveLength(1);
});

it('webhooks: ignores a close request while the save is in flight', async () => {
  let resolveSave!: (value: unknown) => void;
  mocks.listAll.mockResolvedValueOnce(endpoints(endpoint('Before'))).mockImplementation(never);
  mocks.get.mockResolvedValue(endpoint('Before'));
  mocks.update.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
  const view = render(createElement(WebhooksPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit Before' })); });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'save' })); });
  fireEvent.click(view.getByRole('button', { name: 'close' }));
  expect(view.queryByRole('dialog')).not.toBeNull();
  await act(async () => { resolveSave(endpoint('Saved')); });
  expect(view.queryByRole('dialog')).toBeNull();
});

it('webhooks: confirming the waitlist warning twice saves once', async () => {
  let resolveSave!: (value: unknown) => void;
  mocks.listAll.mockResolvedValueOnce(endpoints(endpoint('Before', ['waitlist.signup']))).mockImplementation(never);
  mocks.get.mockResolvedValue(endpoint('Before', ['waitlist.signup']));
  mocks.rpc.mockResolvedValue({ data: { products_count: 2 } });
  mocks.update.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
  webhookEdit.value = { events: ['purchase.completed'] };
  const view = render(createElement(WebhooksPageContent));
  await act(async () => {});
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'edit Before' })); });
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
