/**
 * Checkout CTA i18n contract
 *
 * Subscription products show "Subskrybuj/Subscribe {amount}" while one-time
 * products show "Zapłać/Pay {amount}". Both keys must exist in every locale
 * and the {amount} placeholder must be present so the runtime can substitute it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

type Messages = Record<string, Record<string, unknown>>;

function loadLocale(locale: 'en' | 'pl'): Messages {
  return JSON.parse(
    readFileSync(
      resolve(__dirname, `../../src/messages/${locale}.json`),
      'utf-8',
    ),
  );
}

const customPaymentFormSource = readFileSync(
  resolve(
    __dirname,
    '../../src/app/[locale]/checkout/[slug]/components/CustomPaymentForm.tsx',
  ),
  'utf-8',
);

describe('checkout button i18n', () => {
  it.each(['en', 'pl'] as const)(
    'declares payButton and subscribeButton in %s.json with {amount} placeholder',
    (locale) => {
      const messages = loadLocale(locale);
      const checkout = messages.checkout as Record<string, string>;
      expect(checkout).toBeDefined();
      expect(checkout.payButton).toBeTypeOf('string');
      expect(checkout.subscribeButton).toBeTypeOf('string');
      expect(checkout.payButton).toContain('{amount}');
      expect(checkout.subscribeButton).toContain('{amount}');
    },
  );

  it('uses distinct verbs for subscribe vs pay so users understand the recurrence', () => {
    const pl = loadLocale('pl').checkout as Record<string, string>;
    const en = loadLocale('en').checkout as Record<string, string>;
    expect(pl.payButton).not.toBe(pl.subscribeButton);
    expect(en.payButton).not.toBe(en.subscribeButton);
    // pl uses "Subskrybuj" — guard against accidental copy from payButton.
    expect(pl.subscribeButton.toLowerCase()).toContain('subskryb');
    expect(en.subscribeButton.toLowerCase()).toMatch(/subscribe/);
  });

  it('wires subscribeButton only on the isSubscription branch in CustomPaymentForm', () => {
    // Sanity: source still has the branch logic.
    expect(customPaymentFormSource).toMatch(
      /isSubscription && intervalLabel[\s\S]+?t\('subscribeButton'/,
    );
    // The plain payButton branch comes after subscribeButton (one-time path).
    const subIdx = customPaymentFormSource.indexOf("'subscribeButton'");
    const payIdx = customPaymentFormSource.indexOf("'payButton'");
    expect(subIdx).toBeGreaterThan(-1);
    expect(payIdx).toBeGreaterThan(-1);
    expect(subIdx).toBeLessThan(payIdx);
  });
});
