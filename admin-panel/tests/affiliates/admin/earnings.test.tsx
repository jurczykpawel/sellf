// @vitest-environment happy-dom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
const choices = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/dashboard/affiliates/earnings' }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => en.affiliates[key as keyof typeof en.affiliates] }));
vi.mock('@/lib/affiliates/payouts/reads', () => ({ getPayoutChoices: choices }));
import PartnerSelection from '@/components/affiliates/PartnerSelection';
afterEach(cleanup);
it('explains earnings and guides the seller before a partner is selected', async () => {
  choices.mockResolvedValue({ success: true, data: { programConfigured: true, members: [] } });
  render(<PartnerSelection locale="en" />);
  expect(screen.getByRole('heading', { name: 'Partner earnings' })).toBeTruthy();
  expect(screen.getByText(/Choose a partner to review/)).toBeTruthy();
  expect(await screen.findByText(/No partner applications yet/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Manage applications' }).getAttribute('href')).toBe('/dashboard/affiliates');
});
