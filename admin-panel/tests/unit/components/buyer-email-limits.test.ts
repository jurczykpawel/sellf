// @vitest-environment happy-dom
/**
 * Buyer email settings explain the Supabase Auth mail limits, the automatic retry and how to raise them.
 * Facts: https://supabase.com/docs/guides/auth/rate-limits, https://supabase.com/docs/guides/auth/auth-smtp,
 * https://github.com/supabase/auth (GOTRUE_RATE_LIMIT_EMAIL_SENT, GOTRUE_SMTP_MAX_FREQUENCY).
 * @see src/components/settings/BuyerEmailSettings.tsx
 */
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/actions/shop-config', () => ({ getMyShopConfig: async () => ({ supabase_buyer_emails: true }), updateShopConfig: vi.fn() }));
import BuyerEmailSettings from '@/components/settings/BuyerEmailSettings';

afterEach(cleanup);
const view = (locale: 'pl' | 'en') => render(createElement(NextIntlClientProvider, { locale, messages: locale === 'pl' ? pl : en }, createElement(BuyerEmailSettings)));

it('explains the Supabase Auth limits, the automatic retry and where to raise the limits (PL)', () => {
  view('pl');
  const text = screen.getByRole('region', { name: 'Limity maili Supabase Auth' }).textContent ?? '';
  expect(text).toContain('2 maile na godzinę');
  expect(text).toContain('30 maili na godzinę');
  expect(text).toContain('60 s');
  expect(text).toContain('Authentication → Rate Limits');
  expect(text).toContain('GOTRUE_RATE_LIMIT_EMAIL_SENT');
  expect(text).toContain('GOTRUE_SMTP_MAX_FREQUENCY');
  expect(text).toContain('ponawia');
  expect(text).toContain('Mailstack');
  expect(screen.getByRole('link', { name: 'Limity w dokumentacji Supabase' }).getAttribute('href')).toBe('https://supabase.com/docs/guides/auth/rate-limits');
});

it('has the same explanation in English', () => {
  view('en');
  const text = screen.getByRole('region', { name: 'Supabase Auth email limits' }).textContent ?? '';
  for (const fact of ['2 emails per hour', '30 emails per hour', '60 s', 'Authentication → Rate Limits', 'GOTRUE_RATE_LIMIT_EMAIL_SENT', 'GOTRUE_SMTP_MAX_FREQUENCY', 'retries', 'Mailstack']) expect(text).toContain(fact);
});

it('places the per-recipient interval in Authentication → Rate Limits, where Supabase Studio shows it', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  // Supabase Studio: SMTP_MAX_FREQUENCY is a field of Auth/RateLimits/RateLimits.tsx, not of the SMTP form.
  expect(pl.settings.buyerEmails.limitsRecipient).toContain('Authentication → Rate Limits');
  expect(en.settings.buyerEmails.limitsRecipient).toContain('Authentication → Rate Limits');
  for (const messages of [pl, en]) expect(messages.settings.buyerEmails.limitsRecipient).not.toMatch(/SMTP/);
  for (const doc of ['email-setup.md', 'pl/email-setup.md']) {
    const text = readFileSync(path.resolve(import.meta.dirname, '../../../../docs-site/src/content/docs', doc), 'utf8');
    const sentence = text.split('\n').find(line => line.includes('Minimum interval per user')) ?? '';
    expect(sentence, doc).toMatch(/Minimum interval per user\*\*[^.]*Authentication → Rate Limits|Authentication → Rate Limits\*\*[^.]*Minimum interval per user/);
    expect(sentence, doc).not.toMatch(/SMTP form|Formularz SMTP/);
  }
});
