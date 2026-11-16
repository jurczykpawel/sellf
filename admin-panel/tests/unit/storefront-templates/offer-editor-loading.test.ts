// @vitest-environment happy-dom
import { createElement, StrictMode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import OfferEditor from '@/components/storefront-editor/OfferEditor';

const mocks = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock('@/lib/actions/storefront-templates', () => ({ productOfferAction: mocks.action }));
vi.mock('@/components/storefront-editor/BindingPicker', () => ({ default: () => null }));
vi.mock('@/components/storefront-editor/SlotEditor', () => ({ default: () => null, editorButton: '', editorControl: '' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('starts pending for a selected product and offers retry when its read fails', async () => {
  let rejectRead!: (error: Error) => void;
  mocks.action.mockImplementation(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
  const productId = '10000000-0000-4000-8000-000000000001';
  expect(renderToStaticMarkup(createElement(OfferEditor, { initialProductId: productId }))).toContain('disabled=""');
  render(createElement(OfferEditor, { initialProductId: productId }));
  expect((screen.getByRole('button', { name: 'loading' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { rejectRead(new Error('Read failed')); });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('failure'));
  mocks.action.mockResolvedValue({ success: true, data: { productName: 'Recovered offer', revision: 0, draft: null, published: null } });
  fireEvent.click(screen.getByRole('button', { name: 'reload' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Recovered offer' })).toBeTruthy());
  expect(mocks.action).toHaveBeenCalledTimes(2);
  expect(mocks.action).toHaveBeenLastCalledWith({ operation: 'read', productId });
});

it('waits for a product selection before loading', () => {
  render(createElement(OfferEditor));
  expect(mocks.action).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'loading' })).toBeNull();
});

it.each(['success', 'failure'])('retains edits when an earlier initial read completes with %s', async completion => {
  const reads: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  mocks.action.mockImplementation(() => new Promise((resolve, reject) => reads.push({ resolve, reject })));
  render(createElement(StrictMode, null, createElement(OfferEditor, { initialProductId: '10000000-0000-4000-8000-000000000001' })));
  expect(reads).toHaveLength(2);
  const response = { success: true, data: { productName: 'Current offer', revision: 0, draft: null, published: null } };
  await act(async () => { reads[1].resolve(response); });
  fireEvent.click(screen.getByRole('checkbox', { name: 'enabled' }));
  expect((screen.getByRole('checkbox', { name: 'enabled' }) as HTMLInputElement).checked).toBe(true);
  await act(async () => {
    if (completion === 'success') reads[0].resolve(response);
    else reads[0].reject(new Error('Earlier read failed'));
  });
  expect((screen.getByRole('checkbox', { name: 'enabled' }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByRole('button', { name: 'save', exact: true }) as HTMLButtonElement).disabled).toBe(false);
});

it('links a published offer to its public address', async () => {
  const published = { enabled: true, content: {}, settings: { density: 'comfortable' }, tokens: null };
  mocks.action.mockResolvedValue({ success: true, data: { productName: 'Live offer', productSlug: 'live-offer', revision: 3, draft: null, published } });
  render(createElement(OfferEditor, { initialProductId: '10000000-0000-4000-8000-000000000001' }));
  const link = await screen.findByRole('link', { name: 'openPublished' });
  expect(link.getAttribute('href')).toBe('/offer/live-offer');
  expect(link.getAttribute('target')).toBe('_blank');
});
it('offers no public address before the offer is published', async () => {
  mocks.action.mockResolvedValue({ success: true, data: { productName: 'Draft offer', productSlug: 'draft-offer', revision: 1, draft: null, published: null } });
  render(createElement(OfferEditor, { initialProductId: '10000000-0000-4000-8000-000000000001' }));
  await screen.findByRole('heading', { name: 'Draft offer' });
  expect(screen.queryByRole('link', { name: 'openPublished' })).toBeNull();
});
