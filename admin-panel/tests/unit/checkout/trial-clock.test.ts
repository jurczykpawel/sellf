/** Trial dates retain elapsed provider days in the buyer's timezone. */
import { expect, it } from 'vitest';
import { formatTrialDate, getTrialDays, trialEndFromStart, trialMailAmount } from '@/lib/checkout/trial-display';
import period from '../../fixtures/stripe/trial-display-period.json';
it('matches the recorded seven-day Stripe trial period', () => {
  expect(period.livemode).toBe(false);
  expect(trialEndFromStart(period.trial_start, 7)).toBe(period.trial_end);
});
it('uses elapsed seconds across the spring timezone change instead of local calendar arithmetic', () => {
  const start = Date.parse('2026-03-22T23:30:00Z') / 1000;
  const end = trialEndFromStart(start, 7);
  expect(new Date(end * 1000).toISOString()).toBe('2026-03-29T23:30:00.000Z');
  expect(formatTrialDate(end, 'pl', 'Europe/Warsaw')).toBe('30 marca 2026');
  expect(formatTrialDate(end, 'en', 'America/Los_Angeles')).toBe('March 29, 2026');
});
it('handles the autumn clock change and opposite date boundaries', () => {
  const end = trialEndFromStart(Date.parse('2026-10-18T23:30:00Z') / 1000, 7);
  expect(formatTrialDate(end, 'pl', 'Europe/Warsaw')).toBe('26 października 2026');
  expect(formatTrialDate(end, 'en', 'Pacific/Honolulu')).toBe('October 25, 2026');
});
it.each([null, 0, -1])('does not advertise a trial for days=%s', days => {
  expect(getTrialDays({ product_type: 'subscription', trial_days: days, allow_custom_price: false })).toBeNull();
});
it('quotes trials only for the fixed-price checkout that applies them', () => {
  expect(getTrialDays({ product_type: 'subscription', trial_days: 7, allow_custom_price: false })).toBe(7);
  expect(getTrialDays({ product_type: 'subscription', trial_days: 7, allow_custom_price: true })).toBeNull();
  expect(getTrialDays({ product_type: 'one_time', trial_days: 7, allow_custom_price: false })).toBeNull();
});
it.each(['pl', 'en'])('keeps the first-mail details within the unchanged Auth contract in %s', locale => {
  const text = trialMailAmount('0,00 zł', new Date(period.trial_start * 1000).toISOString(), new Date(period.trial_end * 1000).toISOString(), locale);
  expect(text).toContain('7'); expect(text).toContain('2026'); expect(text).toContain('UTC'); expect(text.length).toBeLessThanOrEqual(100);
  expect(trialMailAmount('0,00 zł', null, null, locale)).toBe('0,00 zł');
});
