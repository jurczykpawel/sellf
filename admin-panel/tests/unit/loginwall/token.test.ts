import { describe, it, expect } from 'vitest';

import {
  signLoginwallToken,
  signGateToken,
  verifyGateToken,
  parseGatePayload,
} from '@/lib/loginwall/token';

const SECRET = 'a'.repeat(64);
const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-05-21T12:00:00Z');

describe('signLoginwallToken', () => {
  it('returns a token, nonce, and expiresAt', () => {
    const result = signLoginwallToken({
      productId: PRODUCT_ID,
      userId: USER_ID,
      secret: SECRET,
      now: NOW,
    });
    expect(result.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(result.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(result.expiresAt.getTime()).toBe(NOW.getTime() + 30 * 60 * 1000);
  });

  it('produces a different nonce each call (randomness)', () => {
    const a = signLoginwallToken({ productId: PRODUCT_ID, userId: USER_ID, secret: SECRET, now: NOW });
    const b = signLoginwallToken({ productId: PRODUCT_ID, userId: USER_ID, secret: SECRET, now: NOW });
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.token).not.toBe(b.token);
  });

  it('honours a custom ttlSeconds', () => {
    const result = signLoginwallToken({
      productId: PRODUCT_ID,
      userId: USER_ID,
      secret: SECRET,
      ttlSeconds: 60,
      now: NOW,
    });
    expect(result.expiresAt.getTime()).toBe(NOW.getTime() + 60_000);
  });
});

describe('gate token v2', () => {
  const base = {
    userId: USER_ID,
    authenticated: true,
    requested: ['a', 'b'],
    owned: ['a'],
    secret: SECRET,
  };

  it('round-trips sign -> verify', () => {
    const { token } = signGateToken({ ...base, now: NOW });
    const r = verifyGateToken(token, { secret: SECRET, now: NOW });
    expect(r).toMatchObject({ valid: true, uid: USER_ID, auth: true, req: ['a', 'b'], owned: ['a'] });
  });

  it('parseGatePayload reads payload without secret', () => {
    const { token } = signGateToken({ ...base, now: NOW });
    expect(parseGatePayload(token)).toMatchObject({ v: 2, auth: true, owned: ['a'], req: ['a', 'b'] });
  });

  it('rejects a modified payload', () => {
    const { token } = signGateToken({ ...base, now: NOW });
    const sig = token.split('.')[1];
    const altered = Buffer.from(
      JSON.stringify({ v: 2, uid: USER_ID, auth: true, req: ['a', 'b'], owned: ['a', 'b'], exp: 9999999999, nonce: 'x' }),
    ).toString('base64url');
    expect(verifyGateToken(`${altered}.${sig}`, { secret: SECRET, now: NOW })).toEqual({ valid: false, reason: 'signature' });
  });

  it('rejects expired', () => {
    const { token } = signGateToken({ ...base, ttlSeconds: -1, now: NOW });
    expect(verifyGateToken(token, { secret: SECRET, now: NOW })).toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects malformed', () => {
    expect(verifyGateToken('garbage', { secret: SECRET, now: NOW })).toEqual({ valid: false, reason: 'malformed' });
    expect(parseGatePayload('garbage')).toBeNull();
  });

  it('unauthenticated token has empty owned', () => {
    const { token } = signGateToken({ ...base, authenticated: false, owned: [], now: NOW });
    expect(verifyGateToken(token, { secret: SECRET, now: NOW })).toMatchObject({ valid: true, auth: false, owned: [] });
  });
});
