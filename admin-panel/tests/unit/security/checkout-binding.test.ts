import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  signCheckoutBinding,
  verifyCheckoutBinding,
} from '@/lib/security/checkout-binding';

const SAVED_SECRET = process.env.CHECKOUT_BINDING_SECRET;

beforeEach(() => {
  process.env.CHECKOUT_BINDING_SECRET = 'test-secret-32-bytes-base64-stub-zzzzzzzz';
});

afterEach(() => {
  if (SAVED_SECRET === undefined) delete process.env.CHECKOUT_BINDING_SECRET;
  else process.env.CHECKOUT_BINDING_SECRET = SAVED_SECRET;
});

describe('checkout binding helper', () => {
  it('produces a token that verifies for the same payload', () => {
    const token = signCheckoutBinding({
      stripeObjectId: 'pi_abc',
      userId: 'u1',
      productId: 'p1',
    });
    expect(typeof token).toBe('string');
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(
      verifyCheckoutBinding(token, { stripeObjectId: 'pi_abc', userId: 'u1', productId: 'p1' }),
    ).toBe(true);
  });

  it('rejects when stripe object id differs', () => {
    const token = signCheckoutBinding({
      stripeObjectId: 'pi_abc',
      userId: 'u1',
      productId: 'p1',
    });
    expect(
      verifyCheckoutBinding(token, { stripeObjectId: 'pi_xyz', userId: 'u1', productId: 'p1' }),
    ).toBe(false);
  });

  it('rejects when user id differs', () => {
    const token = signCheckoutBinding({
      stripeObjectId: 'pi_abc',
      userId: 'u1',
      productId: 'p1',
    });
    expect(
      verifyCheckoutBinding(token, { stripeObjectId: 'pi_abc', userId: 'u2', productId: 'p1' }),
    ).toBe(false);
  });

  it('rejects when product id differs', () => {
    const token = signCheckoutBinding({
      stripeObjectId: 'pi_abc',
      userId: 'u1',
      productId: 'p1',
    });
    expect(
      verifyCheckoutBinding(token, { stripeObjectId: 'pi_abc', userId: 'u1', productId: 'p2' }),
    ).toBe(false);
  });

  it('treats null userId as distinct from empty string', () => {
    const guestToken = signCheckoutBinding({
      stripeObjectId: 'pi_abc',
      userId: null,
      productId: 'p1',
    });
    expect(
      verifyCheckoutBinding(guestToken, { stripeObjectId: 'pi_abc', userId: null, productId: 'p1' }),
    ).toBe(true);
  });

  it('returns false for empty / malformed tokens', () => {
    expect(verifyCheckoutBinding(null, { stripeObjectId: 'pi_abc', userId: 'u1', productId: 'p1' })).toBe(false);
    expect(verifyCheckoutBinding('', { stripeObjectId: 'pi_abc', userId: 'u1', productId: 'p1' })).toBe(false);
    expect(verifyCheckoutBinding('!!!not-base64!!!', { stripeObjectId: 'pi_abc', userId: 'u1', productId: 'p1' })).toBe(false);
  });

  it('rejects when secret rotates', () => {
    const token = signCheckoutBinding({
      stripeObjectId: 'pi_abc',
      userId: 'u1',
      productId: 'p1',
    });
    process.env.CHECKOUT_BINDING_SECRET = 'a-different-secret-after-rotation-zzzzzz';
    expect(
      verifyCheckoutBinding(token, { stripeObjectId: 'pi_abc', userId: 'u1', productId: 'p1' }),
    ).toBe(false);
  });

  it('signCheckoutBinding throws when secret is unset', () => {
    delete process.env.CHECKOUT_BINDING_SECRET;
    expect(() =>
      signCheckoutBinding({ stripeObjectId: 'pi_abc', userId: 'u1', productId: 'p1' }),
    ).toThrow(/CHECKOUT_BINDING_SECRET/);
  });
});
