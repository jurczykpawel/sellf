// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ locale: 'en', save: vi.fn() }));
vi.mock('next-intl', () => ({ useLocale: () => state.locale }));
vi.mock('@/lib/affiliates/products/actions', () => ({
  getAffiliateProduct: async () => ({ success: true, data: { product: { product_type: 'one_time', currency: 'PLN' }, rule: { revision: 7, percentage_bps: 2000, enabled: true } } }),
  createAffiliateRule: state.save,
}));
vi.mock('@/components/ProductFormModal/sections', () => Object.fromEntries(['SalePriceSection', 'AvailabilitySection', 'AccessSection', 'LicenseSection', 'EmbedSection', 'PostPurchaseSection', 'RefundSection', 'AdvancedSection', 'BadgeGeneratorSection', 'CustomCheckoutFieldsSection', 'FeaturedToggle'].map(name => [name, () => null])));
import { StepSalesSettings } from '@/components/ProductFormModal/wizard/steps/StepSalesSettings';
import { AffiliateRuleEditor } from '@/components/affiliates/products/Settings';
import { productAffiliateMessages } from '@/components/affiliates/products/messages';
import type { ComponentProps } from 'react';
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); state.locale = 'en'; state.save.mockResolvedValue({ success: true }); });
it.each([
  ['en', 'Affiliate commission', 'Separate save', 'Save commission now', 'Changes take effect immediately. Update product does not save this section.'],
  ['pl', 'Prowizja partnerska', 'Osobny zapis', 'Zapisz prowizję teraz', 'Zmiany obowiązują od razu. Przycisk Aktualizuj produkt nie zapisuje tej sekcji.'],
])('identifies the independent commission action in %s', async (locale, title, badge, action, description) => {
  state.locale = locale;
  render(createElement(AffiliateRuleEditor, { productId: 'product' }));
  const region = screen.getByRole('region', { name: title });
  expect(within(region).getByText(badge)).toBeDefined();
  const button = within(region).getByRole('button', { name: action });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  expect(button.getAttribute('type')).toBe('button');
  const hint = document.getElementById(button.getAttribute('aria-describedby')!);
  expect(hint?.textContent).toBe(description);
  expect(button.parentElement?.contains(hint)).toBe(true);
});
it('retains the commission draft and its expected revision after a conflict', async () => {
  state.save.mockResolvedValue({ success: false, errorCode: 'CONFLICT' });
  render(createElement(AffiliateRuleEditor, { productId: 'product' }));
  const amount = await screen.findByLabelText('Commission (%)');
  const button = screen.getByRole('button', { name: 'Save commission now' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(amount, { target: { value: '25' } });
  fireEvent.click(button);
  await screen.findByText(/Changed elsewhere/);
  expect((amount as HTMLInputElement).value).toBe('25');
  expect(state.save).toHaveBeenCalledWith({ product_id: 'product', expected_revision: 7, enabled: true, rule: { percentage_bps: 2500 } });
  expect(screen.queryByText(/Commission saved/)).toBeNull();
});

it('shows commission outside the collapsible product settings', async () => {
  const props = { formData: {}, setFormData: vi.fn(), t: (key: string) => key, salePriceDisplayValue: '', setSalePriceDisplayValue: vi.fn(), omnibusEnabled: false, hasWaitlistWebhook: false, products: [], loadingProducts: false, currentProductId: 'product', oto: {}, setOto: vi.fn() } as ComponentProps<typeof StepSalesSettings>;
  render(createElement(StepSalesSettings, props));
  const heading = screen.getByRole('heading', { name: 'Affiliate commission' });
  expect(heading.closest('[data-step3-group]')).toBeNull();
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save commission now' }) as HTMLButtonElement).disabled).toBe(false));
});

it('keeps the separate commission action readable on mobile and desktop in both themes', async () => {
  const css = (await postcss([tailwind()]).process(readFileSync('src/app/globals.css', 'utf8'), { from: 'src/app/globals.css' })).css;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const locale of ['en', 'pl'] as const) {
      state.locale = locale;
      const t = productAffiliateMessages[locale];
      const view = render(createElement(AffiliateRuleEditor, { productId: 'product' }));
      await waitFor(() => expect((screen.getByRole('button', { name: t.ruleSave }) as HTMLButtonElement).disabled).toBe(false));
      for (const input of view.container.querySelectorAll('input')) {
        input.setAttribute('value', input.value);
        input.toggleAttribute('checked', input.checked);
      }
      for (const width of [390, 1366]) for (const dark of [false, true]) {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(`<!doctype html><html lang="${locale}" class="${dark ? 'dark' : ''}"><head><title>Sellf</title><style>${css}</style></head><body style="background:var(--sf-bg-deep);font:16px system-ui"><main style="max-width:800px;margin:24px auto;padding:16px">${view.container.innerHTML}</main></body></html>`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const button = page.getByRole('button', { name: t.ruleSave });
        expect(await button.isVisible()).toBe(true);
        expect(await page.getByText(t.ruleSaveLabel, { exact: true }).isVisible()).toBe(true);
        expect(await page.getByText(t.ruleSaveHint, { exact: true }).isVisible()).toBe(true);
        const bounds = await button.boundingBox();
        expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width).toBe(true);
        await page.screenshot({ path: `/private/tmp/rcr2-commission-${locale}-${width}-${dark ? 'dark' : 'light'}.png`, fullPage: true });
      }
      cleanup();
    }
  } finally { await browser.close(); }
}, 30000);
