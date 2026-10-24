// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TemplateHistory from '@/components/storefront/TemplateHistory';
import { DEFAULT_CONFIG, D_CONFIG } from '@/lib/storefront-templates/fixtures';
import { validateConfig } from '@/lib/storefront-templates/registry';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

const mocks = vi.hoisted(() => ({ action: vi.fn(), offer: vi.fn() }));
vi.mock('@/components/storefront/TemplateHistory.module.css', () => ({ default: {} }));
vi.mock('@/lib/actions/storefront-templates', () => ({ storefrontTemplateAction: mocks.action, productOfferAction: mocks.offer }));
function historyView(locale = 'en', productId?: string) { return createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, createElement(TemplateHistory, { productId })); }
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('renders the initial pending state, then loads and refreshes history', async () => {
  let resolveRead!: (result: unknown) => void;
  const read = { success: true, data: { revision: 0, draft: null, published: {} } };
  mocks.action.mockImplementation(({ operation }: { operation: string }) => operation === 'read'
    ? new Promise(resolve => { resolveRead = resolve; })
    : Promise.resolve({ success: true, data: [] }));
  expect(renderToStaticMarkup(historyView())).toContain('aria-busy="true"');
  const { container } = render(historyView());
  expect(container.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
  expect((screen.getByRole('button', { name: 'Reload' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { resolveRead(read); });
  await waitFor(() => expect(container.querySelector('main')?.getAttribute('aria-busy')).toBe('false'));
  mocks.action.mockImplementation(({ operation }: { operation: string }) => Promise.resolve(operation === 'read' ? read : { success: true, data: [] }));
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(4));
  await waitFor(() => expect(container.querySelector('main')?.getAttribute('aria-busy')).toBe('false'));
});

it('loads and refreshes product history through its product action', async () => {
  const productId = '10000000-0000-4000-8000-000000000001';
  mocks.offer.mockImplementation(({ operation }: { operation: string }) => Promise.resolve(operation === 'read'
    ? { success: true, data: { revision: 0, draft: null, published: null, productName: 'Offer product' } }
    : { success: true, data: [] }));
  render(historyView('en', productId));
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Offer product'));
  expect(screen.getByRole('link', { name: new RegExp(`^← ${en.templatePreview.editor}$`) }).getAttribute('href')).toBe(`/dashboard/templates?product=${productId}`);
  expect(mocks.action).not.toHaveBeenCalled();
  expect(mocks.offer).toHaveBeenCalledWith({ operation: 'read', productId });
  expect(mocks.offer).toHaveBeenCalledWith({ operation: 'history', limit: 20, productId });
  fireEvent.click(screen.getByRole('button', { name: en.templatePreview.reload }));
  await waitFor(() => expect(mocks.offer).toHaveBeenCalledTimes(4));
});

function historyActions() {
  const draft = structuredClone(D_CONFIG);
  delete draft.settingsByTemplate.d!.closingProduct;
  const validation = validateConfig(draft);
  const rows = [3, 2, 0].map(revision => ({ revision, draft: revision ? draft : null, published: DEFAULT_CONFIG, created_at: '2026-10-17T10:00:00Z' }));
  mocks.action.mockImplementation(async (input: { operation: string; fromRevision?: number; toRevision?: number }) => {
    if (input.operation === 'read') return { success: true, data: { revision: 3, draft, published: DEFAULT_CONFIG } };
    if (input.operation === 'history') return { success: true, data: rows };
    if (input.operation === 'diff') return { success: true, data: { fromRevision: input.fromRevision, toRevision: input.toRevision, changes: [] } };
    const invalid = { ...validation, valid: false, errors: validation.warnings.filter(issue => issue.code === 'BINDING') };
    if (input.operation === 'validate') return { success: true, data: invalid };
    return { success: false, code: 'INVALID', validation: invalid };
  });
}
it.each(['en', 'pl'])('shows the publication problem and section link for current and older drafts in %s', async locale => {
  historyActions(); render(historyView(locale));
  const buttons = await screen.findAllByRole('button', { name: locale === 'pl' ? 'Opublikuj tę wersję' : 'Publish this version' });
  fireEvent.click(buttons[0]);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(locale === 'pl' ? 'Zaproszenie na koniec' : 'Final invitation');
  expect(alert.textContent).toContain(locale === 'pl' ? pl.storefrontEditor.missingOffer : en.storefrontEditor.missingOffer);
  expect(within(alert).getByRole('link').getAttribute('href')).toBe(`${locale === 'pl' ? '/pl' : ''}/dashboard/templates#closing`);
  fireEvent.click(buttons[1]);
  fireEvent.click(await screen.findByRole('button', { name: locale === 'pl' ? pl.templatePreview.confirmPublish : en.templatePreview.confirmPublish }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(locale === 'pl' ? 'Zaproszenie na koniec' : 'Final invitation'));
  expect(mocks.action.mock.calls.some(([input]) => input.operation === 'draft')).toBe(false);
});
it('compares every older row to the current revision and omits self comparison', async () => {
  historyActions(); render(historyView());
  const rows = await screen.findAllByRole('listitem');
  expect(within(rows[0]).queryByRole('button', { name: 'Compare' })).toBeNull();
  for (const [index, revision] of [[1, 2], [2, 0]]) {
    fireEvent.click(within(rows[index]).getByRole('button', { name: 'Compare' }));
    await waitFor(() => expect(mocks.action).toHaveBeenCalledWith({ operation: 'diff', fromRevision: revision, toRevision: 3 }));
    await waitFor(() => expect(within(rows[index]).getByRole('button', { name: 'Compare' })).toHaveProperty('disabled', false));
  }
});
it('requires confirmation before restoring a public version and supports cancelling', async () => {
  const rows = [3, 2, 1].map(revision => ({ revision, draft: null, published: DEFAULT_CONFIG, created_at: '2026-10-17T10:00:00Z' }));
  mocks.action.mockImplementation(async (input: { operation: string }) => input.operation === 'read'
    ? { success: true, data: { revision: 3, draft: null, published: DEFAULT_CONFIG } }
    : input.operation === 'history' ? { success: true, data: rows }
    : { success: true, data: { fromRevision: 3, toRevision: 2, changes: [] } });
  render(historyView());
  fireEvent.click((await screen.findAllByRole('button', { name: en.templatePreview.rollback }))[0]);
  await screen.findByRole('button', { name: en.templatePreview.rollbackConfirm });
  expect(screen.getByRole('dialog').textContent).toContain(en.templatePreview.rollbackHelp);
  expect(mocks.action.mock.calls.some(([input]) => input.operation === 'rollback')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: en.templatePreview.cancel }));
  expect(screen.queryByRole('button', { name: en.templatePreview.rollbackConfirm })).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: en.templatePreview.rollback })[0]);
  fireEvent.click(await screen.findByRole('button', { name: en.templatePreview.rollbackConfirm }));
  await waitFor(() => expect(mocks.action).toHaveBeenCalledWith({ operation: 'rollback', targetRevision: 2, expectedRevision: 3 }));
});
