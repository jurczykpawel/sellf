import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Guard: MySubscriptions uses translation keys under myPurchases.subscriptions
// and storefront uses product.subscription/subscribe. Missing keys render as
// raw paths in the UI ("myPurchases.subscriptions.cancelButton" etc.).

type MessagesShape = Record<string, unknown>;

function load(locale: 'pl' | 'en'): MessagesShape {
  return JSON.parse(
    readFileSync(resolve(__dirname, `../../src/messages/${locale}.json`), 'utf-8'),
  );
}

function get(obj: MessagesShape, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as MessagesShape)) {
      return (acc as MessagesShape)[key];
    }
    return undefined;
  }, obj);
}

const REQUIRED_KEYS = [
  // MySubscriptions
  'myPurchases.subscriptions.title',
  'myPurchases.subscriptions.loading',
  'myPurchases.subscriptions.loadError',
  'myPurchases.subscriptions.cancelButton',
  'myPurchases.subscriptions.cancelInProgress',
  'myPurchases.subscriptions.resumeButton',
  'myPurchases.subscriptions.resumeInProgress',
  'myPurchases.subscriptions.cancelScheduled',
  'myPurchases.subscriptions.resumed',
  'myPurchases.subscriptions.statusScheduledCancel',
  'myPurchases.subscriptions.endsAt',
  'myPurchases.subscriptions.renewsAt',
  'myPurchases.subscriptions.trialUntil',
  'myPurchases.subscriptions.status.active',
  'myPurchases.subscriptions.status.trialing',
  'myPurchases.subscriptions.status.past_due',
  'myPurchases.subscriptions.status.unpaid',
  'myPurchases.subscriptions.status.canceled',
  'myPurchases.subscriptions.interval.day',
  'myPurchases.subscriptions.interval.week',
  'myPurchases.subscriptions.interval.month',
  'myPurchases.subscriptions.interval.year',
  // Storefront badge + CTA
  'storefront.product.subscription',
  'storefront.product.subscribe',
];

describe('subscription translations coverage', () => {
  it.each(['pl', 'en'] as const)('%s has every required subscription key', (locale) => {
    const messages = load(locale);
    const missing = REQUIRED_KEYS.filter((key) => {
      const value = get(messages, key);
      return typeof value !== 'string' || value.length === 0;
    });
    expect(missing, `${locale} is missing keys: ${missing.join(', ')}`).toEqual([]);
  });
});
