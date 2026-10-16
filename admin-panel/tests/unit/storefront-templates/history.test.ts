// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TemplateHistory from '@/components/storefront/TemplateHistory';

const mocks = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock('@/components/storefront/TemplateHistory.module.css', () => ({ default: {} }));
vi.mock('@/lib/actions/storefront-templates', () => ({ storefrontTemplateAction: mocks.action }));
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
