import { describe, it, expect } from 'vitest';
import {
  decideProductAccessOutcome,
  type ProductAccessInput,
} from '@/lib/payment/product-access-decision';

const FIXED_NOW = new Date('2026-05-14T12:00:00Z');

function input(overrides: Partial<ProductAccessInput>): ProductAccessInput {
  return {
    user: null,
    product: {
      id: 'p1',
      is_active: true,
      available_from: null,
      available_until: null,
    },
    userAccess: null,
    now: FIXED_NOW,
    ...overrides,
  };
}

describe('decideProductAccessOutcome', () => {
  describe('inactive product', () => {
    it('returns render-inactive regardless of user', () => {
      expect(
        decideProductAccessOutcome(
          input({ product: { id: 'p1', is_active: false, available_from: null, available_until: null } }),
        ),
      ).toEqual({ kind: 'render-inactive' });
      expect(
        decideProductAccessOutcome(
          input({
            user: { id: 'u1' },
            product: { id: 'p1', is_active: false, available_from: null, available_until: null },
          }),
        ),
      ).toEqual({ kind: 'render-inactive' });
    });
  });

  describe('temporal window', () => {
    it('returns render-temporal when available_from is in the future (guest)', () => {
      expect(
        decideProductAccessOutcome(
          input({
            product: {
              id: 'p1',
              is_active: true,
              available_from: '2026-06-01T00:00:00Z',
              available_until: null,
            },
          }),
        ),
      ).toEqual({ kind: 'render-temporal' });
    });

    it('returns render-temporal when available_until has passed (guest)', () => {
      expect(
        decideProductAccessOutcome(
          input({
            product: {
              id: 'p1',
              is_active: true,
              available_from: null,
              available_until: '2026-05-01T00:00:00Z',
            },
          }),
        ),
      ).toEqual({ kind: 'render-temporal' });
    });

    it('does NOT block existing users with active access when window has passed', () => {
      // A user who bought during the active window should keep their content.
      expect(
        decideProductAccessOutcome(
          input({
            user: { id: 'u1' },
            product: {
              id: 'p1',
              is_active: true,
              available_from: null,
              available_until: '2026-05-01T00:00:00Z',
            },
            userAccess: { access_expires_at: null, access_duration_days: null, granted_at: '2026-04-01T00:00:00Z' },
          }),
        ),
      ).toEqual({
        kind: 'render-content',
        userAccess: { access_expires_at: null, access_duration_days: null, granted_at: '2026-04-01T00:00:00Z' },
      });
    });
  });

  describe('guest (no user)', () => {
    it('redirects to checkout when product is active and within window', () => {
      expect(decideProductAccessOutcome(input({}))).toEqual({ kind: 'redirect-checkout' });
    });
  });

  describe('authenticated user', () => {
    it('redirects to checkout when no access record exists', () => {
      expect(
        decideProductAccessOutcome(input({ user: { id: 'u1' } })),
      ).toEqual({ kind: 'redirect-checkout' });
    });

    it('renders content when access has no expiry', () => {
      expect(
        decideProductAccessOutcome(
          input({
            user: { id: 'u1' },
            userAccess: { access_expires_at: null, access_duration_days: null, granted_at: '2026-04-01T00:00:00Z' },
          }),
        ),
      ).toEqual({
        kind: 'render-content',
        userAccess: { access_expires_at: null, access_duration_days: null, granted_at: '2026-04-01T00:00:00Z' },
      });
    });

    it('renders content when access has future expiry', () => {
      expect(
        decideProductAccessOutcome(
          input({
            user: { id: 'u1' },
            userAccess: { access_expires_at: '2026-06-01T00:00:00Z', access_duration_days: 30, granted_at: '2026-04-01T00:00:00Z' },
          }),
        ),
      ).toEqual({
        kind: 'render-content',
        userAccess: { access_expires_at: '2026-06-01T00:00:00Z', access_duration_days: 30, granted_at: '2026-04-01T00:00:00Z' },
      });
    });

    it('renders expired when access_expires_at is in the past', () => {
      expect(
        decideProductAccessOutcome(
          input({
            user: { id: 'u1' },
            userAccess: { access_expires_at: '2026-04-01T00:00:00Z', access_duration_days: 30, granted_at: '2026-03-01T00:00:00Z' },
          }),
        ),
      ).toEqual({
        kind: 'render-expired',
        userAccess: { access_expires_at: '2026-04-01T00:00:00Z', access_duration_days: 30, granted_at: '2026-03-01T00:00:00Z' },
      });
    });
  });

  describe('preview mode short-circuit', () => {
    it('grants content for admin preview regardless of access state', () => {
      expect(
        decideProductAccessOutcome(input({ previewMode: true })),
      ).toEqual({ kind: 'render-content', userAccess: null, preview: true });
      expect(
        decideProductAccessOutcome(
          input({
            previewMode: true,
            product: { id: 'p1', is_active: false, available_from: null, available_until: null },
          }),
        ),
      ).toEqual({ kind: 'render-content', userAccess: null, preview: true });
    });
  });
});
