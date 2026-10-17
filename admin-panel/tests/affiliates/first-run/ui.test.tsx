// @vitest-environment happy-dom
/** First-run affiliate navigation. @see components/affiliates/PartnerSelection.tsx */
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
const mocks = vi.hoisted(() => ({ choices: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/dashboard/affiliates/earnings' }));
vi.mock('@/lib/affiliates/payouts/reads', () => ({ getPayoutChoices: mocks.choices, previewPayout: vi.fn() }));
vi.mock('@/lib/affiliates/payouts/actions', () => ({ reservePayout: vi.fn(), markPayoutPaid: vi.fn(), cancelPayout: vi.fn(), adjustCommission: vi.fn() }));
import PartnerSelection from '@/components/affiliates/PartnerSelection';
import PayoutPanel from '@/components/affiliates/payouts/PayoutPanel';
afterEach(cleanup);
it.each(['en', 'pl'] as const)('shows setup guidance on earnings and payouts in %s', async locale => {
  mocks.choices.mockResolvedValue({ success: true, data: { programConfigured: false, members: [], currencies: ['PLN'], payouts: [], commissions: [] } });
  for (const view of [<PartnerSelection key="earnings" locale={locale} />, <PayoutPanel key="payouts" locale={locale} download={() => {}} />]) {
    render(<NextIntlClientProvider locale={locale} messages={locale === 'pl' ? pl : en}>{view}</NextIntlClientProvider>);
    expect(await screen.findByText(locale === 'pl' ? 'Program partnerski nie został jeszcze skonfigurowany.' : 'The affiliate program has not been set up yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: locale === 'pl' ? 'Przejdź do ustawień programu' : 'Go to program settings' }).getAttribute('href')).toBe(`${locale === 'pl' ? '/pl' : ''}/dashboard/affiliates`);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    cleanup();
  }
});

it.each(['en', 'pl'] as const)('keeps a failed program read distinct from setup guidance in %s', async locale => {
  mocks.choices.mockResolvedValue({ success: false, error: 'unavailable', errorCode: '422' });
  for (const view of [<PartnerSelection key="earnings" locale={locale} />, <PayoutPanel key="payouts" locale={locale} download={() => {}} />]) {
    render(<NextIntlClientProvider locale={locale} messages={locale === 'pl' ? pl : en}>{view}</NextIntlClientProvider>);
    const messages = (locale === 'pl' ? pl : en).affiliates;
    expect(await screen.findByText(view.key === 'earnings' ? messages.unavailable : messages.payouts.error)).toBeTruthy();
    expect(screen.queryByRole('link', { name: locale === 'pl' ? 'Przejdź do ustawień programu' : 'Go to program settings' })).toBeNull();
    cleanup();
  }
});
