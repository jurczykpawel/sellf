// @vitest-environment happy-dom
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AttributionSettings from '@/components/settings/AttributionSettings';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
vi.mock('@/lib/actions/attribution', () => ({ getAttributionConfig: async () => ({ data: { click_id_retention_days: 90, rules: [] } }), saveAttributionConfig: vi.fn() }));
vi.mock('@/components/tutorials/TutorialTrigger', () => ({ default: () => null }));
afterEach(cleanup);
it.each(['en', 'pl'] as const)('shows rule examples and tells the seller where to find results in %s', async locale => {
  render(React.createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, React.createElement(AttributionSettings)));
  await screen.findByRole('table');
  expect(screen.getByText(/Facebook.*organic_social/)).toBeTruthy();
  expect(screen.getByText(locale === 'pl' ? /priorytecie 10.*20/ : /priority 10.*20/)).toBeTruthy();
  expect(screen.getByText(locale === 'pl' ? /Brak źródła.*direct/ : /No source.*direct/)).toBeTruthy();
  expect(screen.getByText(locale === 'pl' ? /szczegółach.*Źródło/ : /payment details.*Source/)).toBeTruthy();
});
