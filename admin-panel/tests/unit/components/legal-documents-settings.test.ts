// @vitest-environment happy-dom
import { createElement, StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LegalDocumentsSettings from '@/components/settings/LegalDocumentsSettings';
import { getMyLegalDocsSource, getMyShopConfig, updateShopConfig } from '@/lib/actions/shop-config';
import { resolveLegalDocsSource } from '@/lib/legal/legal-docs-source';
import type { ShopConfig } from '@/lib/actions/shop-config';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/actions/shop-config', () => ({ getMyShopConfig: vi.fn(), getMyLegalDocsSource: vi.fn(), updateShopConfig: vi.fn() }));
vi.mock('@/lib/gus/lookup', () => ({ lookupCompanyByNip: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const config = { id: 'shop', country: 'PL', terms_of_service_url: 'https://example.com/terms' } as ShopConfig;
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getMyShopConfig).mockResolvedValue(config);
  vi.mocked(getMyLegalDocsSource).mockResolvedValue(resolveLegalDocsSource(config, {}));
  vi.mocked(updateShopConfig).mockResolvedValue(true);
});

it.each([config, null])('loads document sources once after shop settings settle: %j', async value => {
  let finish!: (value: ShopConfig | null) => void;
  vi.mocked(getMyShopConfig).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(createElement(StrictMode, null, createElement(LegalDocumentsSettings)));
  expect(getMyLegalDocsSource).not.toHaveBeenCalled();
  await act(async () => { finish(value); });
  expect(getMyLegalDocsSource).toHaveBeenCalledOnce();
  view.rerender(createElement(StrictMode, null, createElement(LegalDocumentsSettings)));
  await act(async () => {});
  expect(getMyLegalDocsSource).toHaveBeenCalledOnce();
});

it('refreshes document sources after saving the URLs', async () => {
  vi.mocked(getMyShopConfig).mockResolvedValueOnce(config).mockResolvedValue({ ...config, terms_of_service_url: 'https://example.com/new-terms' });
  render(createElement(LegalDocumentsSettings));
  await act(async () => {});
  expect(getMyLegalDocsSource).toHaveBeenCalledOnce();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'saveButton' })); });
  expect(updateShopConfig).toHaveBeenCalledOnce();
  expect(getMyLegalDocsSource).toHaveBeenCalledTimes(2);
});
