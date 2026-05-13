import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// user_product_access.access_expires_at is null for subscription access — the
// source of truth is subscriptions.current_period_end joined via subscription_id.
// my-products page must surface that date so subscribers see when their access
// ends or renews (the one-time path already shows access_expires_at).

const source = readFileSync(
  resolve(__dirname, '../../src/app/[locale]/my-products/page.tsx'),
  'utf-8',
);

describe('my-products joins subscription state to show access window', () => {
  it('selects subscription fields via the subscription_id FK in the user_product_access query', () => {
    expect(source).toMatch(
      /subscription:subscriptions\s*\(\s*[\s\S]+?status[\s\S]+?cancel_at_period_end[\s\S]+?current_period_end[\s\S]+?\)/,
    );
  });

  it('renders an "Expires" line when subscription is scheduled to cancel', () => {
    expect(source).toMatch(/cancel_at_period_end[\s\S]+?current_period_end/);
    expect(source).toMatch(/subEndsAt[\s\S]+?accessExpires/);
  });

  it('renders a "Renews" line when subscription is active without scheduled cancel', () => {
    expect(source).toMatch(/!subscription!\.cancel_at_period_end[\s\S]+?current_period_end/);
    expect(source).toMatch(/subRenewsAt[\s\S]+?accessRenews/);
  });

  it('treats only active|trialing subscriptions as still granting access', () => {
    expect(source).toMatch(/status === ['"]active['"][\s\S]+?status === ['"]trialing['"]/);
  });
});

describe('i18n keys for subscription access window exist in both locales', () => {
  const REQUIRED_KEYS = [
    'myProducts.accessExpires',
    'myProducts.accessRenews',
    'myProducts.accessSince',
  ];
  type Messages = Record<string, unknown>;
  const get = (obj: Messages, path: string): unknown =>
    path.split('.').reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object' && key in (acc as Messages)
          ? (acc as Messages)[key]
          : undefined,
      obj,
    );

  it.each(['pl', 'en'] as const)('%s has every required myProducts key', (locale) => {
    const messages: Messages = JSON.parse(
      readFileSync(resolve(__dirname, `../../src/messages/${locale}.json`), 'utf-8'),
    );
    const missing = REQUIRED_KEYS.filter((key) => typeof get(messages, key) !== 'string');
    expect(missing, `${locale} missing: ${missing.join(', ')}`).toEqual([]);
  });
});
