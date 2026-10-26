/** API key presentation follows the verification lifecycle. */
import { describe, expect, it } from 'vitest';
import { getApiKeyStatus } from '@/lib/api/api-key-status';

const now = Date.parse('2026-01-01T12:00:00Z');
const key = { is_active: false, revoked_at: null, expires_at: null, rotation_grace_until: '2026-01-01T13:00:00Z' };

describe('API key status', () => {
  it('reports a retired key as usable during its grace period', () => {
    expect(getApiKeyStatus(key, now)).toBe('grace');
  });
  it('ends the grace period at its deadline', () => {
    expect(getApiKeyStatus(key, Date.parse(key.rotation_grace_until))).toBe('expired');
  });
  it('prioritizes revocation and expiry over grace', () => {
    expect(getApiKeyStatus({ ...key, revoked_at: '2026-01-01T11:00:00Z' }, now)).toBe('revoked');
    expect(getApiKeyStatus({ ...key, expires_at: '2026-01-01T11:00:00Z' }, now)).toBe('expired');
  });
  it('distinguishes active and disabled keys without a grace period', () => {
    expect(getApiKeyStatus({ ...key, rotation_grace_until: null }, now)).toBe('inactive');
    expect(getApiKeyStatus({ ...key, rotation_grace_until: null, is_active: true }, now)).toBe('active');
  });
});
