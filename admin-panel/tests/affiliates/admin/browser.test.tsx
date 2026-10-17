// @vitest-environment happy-dom
/** Affiliate screen layout contract. @see components/affiliates/admin/SyncWorkPanel.tsx */
import { readFileSync } from 'node:fs';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import AxeBuilder from '@axe-core/playwright';
import { expect, it, vi } from 'vitest';
const actions = vi.hoisted(() => ({ getAffiliateSyncOverview: vi.fn(), retryAffiliateWork: vi.fn(), getAdminOverview: vi.fn(), updateProgram: vi.fn(), updateMember: vi.fn(), getAcceptedTerms: vi.fn(), applyToProgram: vi.fn(), getPayoutChoices: vi.fn(), previewPayout: vi.fn() }));
vi.mock('@/lib/affiliates/admin/actions', () => actions);
vi.mock('@/lib/affiliates/payouts/reads', () => actions);
vi.mock('@/lib/affiliates/payouts/actions', () => ({ reservePayout: vi.fn(), markPayoutPaid: vi.fn(), cancelPayout: vi.fn(), adjustCommission: vi.fn() }));
vi.mock('@/components/captcha/CaptchaWidget', () => ({ default: () => null }));
import { AffiliateAdmin } from '@/components/affiliates/admin/AffiliateAdmin';
import AffiliatePortal from '@/components/affiliates/portal/AffiliatePortal';
import PayoutPanel from '@/components/affiliates/payouts/PayoutPanel';
import styles from '@/components/affiliates/portal/AffiliatePortal.module.css';
import { affiliateAdminMessages } from '@/components/affiliates/admin/messages';
import { fixture } from '../portal/fixtures';

it('keeps recovery, payouts and portal usable at desktop and mobile sizes in EN/PL', async () => {
  const id = 'aaaaaaaa-0000-4000-a000-000000000001';
  const program = { id, version: '1', enabled: true, hold_days: 30, buffer_days: 2, terms_version: 'v1', terms: { en: 'Terms', pl: 'Regulamin' }, thresholds: { CHF: '1000' } };
  const payout = { id, member_id: id, currency: 'CHF', earnings_minor: '1234', version: '1', status: 'reserved', needs_review: false, payee_reference: 'Anna' };
  actions.getAffiliateSyncOverview.mockResolvedValue({ success: true, data: { work: [{ payment_id: id, requested_generation: '9007199254740993', attempts: 10, last_error_code: 'net_unavailable', payment: { created_at: '2026-10-01T09:00:00Z', product: { name: 'Automation Masterclass' } } }], next_cursor: null, oldest_pending_at: '2026-10-01T09:00:00Z' } });
  actions.getPayoutChoices.mockResolvedValue({ success: true, data: { programConfigured: true, members: [{ id, display_name: 'Anna Kowalska', code: 'anna', status: 'approved' }], currencies: ['CHF'], payouts: [payout], commissions: [] } });
  actions.previewPayout.mockResolvedValue({ success: true, data: { earnings_minor: '1234', held_minor: '0', debt_offset_minor: '0', payable_minor: '1234' } });
  let portalCss = readFileSync('src/components/affiliates/portal/AffiliatePortal.module.css', 'utf8').replace(/:global\(([^)]+)\)/g, '$1');
  for (const [name, generated] of Object.entries(styles)) portalCss = portalCss.replace(new RegExp(`\\.${name}(?![\\w-])`, 'g'), `.${generated}`);
  const css = (await postcss([tailwind()]).process(readFileSync('src/app/globals.css', 'utf8'), { from: 'src/app/globals.css' })).css + portalCss;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const locale of ['en', 'pl'] as const) for (const name of ['admin', 'payouts', 'portal'] as const) {
      const view = render(name === 'admin' ? <AffiliateAdmin locale={locale} initial={{ program, members: [], next_cursor: null }} /> : name === 'payouts' ? <PayoutPanel locale={locale} initialPayout={payout} download={() => {}} /> : <AffiliatePortal locale={locale} data={fixture} />);
      if (name === 'admin') await screen.findByText(affiliateAdminMessages[locale].syncNet);
      if (name === 'payouts') await waitFor(() => expect((screen.getByRole('combobox', { name: 'Partner' }) as HTMLInputElement).value).toBe('Anna Kowalska'));
      for (const input of view.container.querySelectorAll('input')) input.setAttribute('value', input.value);
      for (const width of [1440, 390]) for (const dark of [false, true]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.setContent(`<!doctype html><html lang="${locale}" class="${dark ? 'dark' : ''}"><head><title>Sellf</title><style>${css}</style></head><body style="background:var(--sf-bg-deep);font:16px system-ui"><main style="max-width:1200px;margin:24px auto;padding:16px">${view.container.innerHTML}</main></body></html>`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
        if (!dark) await page.screenshot({ path: `/tmp/aff-fix-b-${name}-${locale}-${width}.png`, fullPage: true });
        if (name === 'admin') {
          await page.getByLabel(affiliateAdminMessages[locale].syncReason).focus();
          await page.keyboard.press('Tab');
          expect(await page.getByRole('button', { name: affiliateAdminMessages[locale].syncRetry, exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
          await page.getByText(affiliateAdminMessages[locale].syncTechnical, { exact: true }).click();
          await page.setViewportSize({ width: 320, height: 1000 });
          await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
      }
      cleanup();
    }
  } finally { cleanup(); await browser.close(); }
}, 120000);
