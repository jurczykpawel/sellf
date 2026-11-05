import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { assertStripeTransport } from '../helpers/stripe-transport';

function setup() {
  const page = new EventEmitter();
  assertStripeTransport(page as unknown as Page);
  return (url: string, errorText: string) => page.emit('requestfailed', {
    url: () => url,
    failure: () => ({ errorText }),
  });
}

describe('Stripe checkout transport', () => {
  it.each([
    'https://js.stripe.com/v3/',
    'https://api.stripe.com/v1/payment_pages/session/confirm?key=private',
    'https://checkout.stripe.com/c/pay/session',
  ])('reports a failed checkout request to %s immediately', url => {
    const fail = setup();
    expect(() => fail(url, 'net::ERR_NETWORK_CHANGED')).toThrow('Stripe checkout transport: net::ERR_NETWORK_CHANGED');
    expect(() => fail(url, 'net::ERR_NETWORK_CHANGED')).not.toThrow(/key=private/);
  });

  it.each([
    ['https://r.stripe.com/b', 'net::ERR_NETWORK_CHANGED'],
    ['https://example.com/file', 'net::ERR_NETWORK_CHANGED'],
    ['https://js.stripe.com.example.com/v3/', 'net::ERR_NETWORK_CHANGED'],
    ['https://js.stripe.com/v3/', 'net::ERR_ABORTED'],
  ])('leaves unrelated or cancelled requests to %s alone', (url, error) => {
    expect(() => setup()(url, error)).not.toThrow();
  });
});
