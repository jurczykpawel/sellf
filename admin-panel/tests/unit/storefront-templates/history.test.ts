// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TemplateHistory from '@/components/storefront/TemplateHistory';

const mocks = vi.hoisted(() => ({ action: vi.fn(), offer: vi.fn() }));
vi.mock('@/components/storefront/TemplateHistory.module.css', () => ({ default: {} }));
vi.mock('@/lib/actions/storefront-templates', () => ({ storefrontTemplateAction: mocks.action, productOfferAction: mocks.offer }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => Object.assign((key: string) => key, { has: () => true }) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('renders the initial pending state, then loads and refreshes history', async () => {
  let resolveRead!: (result: unknown) => void;
  const read = { success: true, data: { revision: 0, draft: null, published: {} } };
  mocks.action.mockImplementation(({ operation }: { operation: string }) => operation === 'read'
    ? new Promise(resolve => { resolveRead = resolve; })
    : Promise.resolve({ success: true, data: [] }));
  expect(renderToStaticMarkup(createElement(TemplateHistory))).toContain('aria-busy="true"');
  const { container } = render(createElement(TemplateHistory));
  expect(container.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
  expect((screen.getByRole('button', { name: 'reload' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { resolveRead(read); });
  await waitFor(() => expect(container.querySelector('main')?.getAttribute('aria-busy')).toBe('false'));
  mocks.action.mockImplementation(({ operation }: { operation: string }) => Promise.resolve(operation === 'read' ? read : { success: true, data: [] }));
  fireEvent.click(screen.getByRole('button', { name: 'reload' }));
  await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(4));
  await waitFor(() => expect(container.querySelector('main')?.getAttribute('aria-busy')).toBe('false'));
});

it('loads and refreshes product history through its product action', async () => {
  const productId = '10000000-0000-4000-8000-000000000001';
  mocks.offer.mockImplementation(({ operation }: { operation: string }) => Promise.resolve(operation === 'read'
    ? { success: true, data: { revision: 0, draft: null, published: null, productName: 'Offer product' } }
    : { success: true, data: [] }));
  render(createElement(TemplateHistory, { productId }));
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Offer product'));
  expect(screen.getByRole('link', { name: '← editor' }).getAttribute('href')).toBe(`/dashboard/templates?product=${productId}`);
  expect(mocks.action).not.toHaveBeenCalled();
  expect(mocks.offer).toHaveBeenCalledWith({ operation: 'read', productId });
  expect(mocks.offer).toHaveBeenCalledWith({ operation: 'history', limit: 20, productId });
  fireEvent.click(screen.getByRole('button', { name: 'reload' }));
  await waitFor(() => expect(mocks.offer).toHaveBeenCalledTimes(4));
});
