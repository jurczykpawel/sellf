import { describe, it, expect } from 'vitest';
import { assertStripeObjectOwnership } from '@/lib/api/ownership';

describe('assertStripeObjectOwnership', () => {
  it('returns null when metadata user and caller match', () => {
    expect(assertStripeObjectOwnership({ user_id: 'u1' }, 'u1')).toBeNull();
  });

  it('returns 403 when metadata user differs from caller', async () => {
    const res = assertStripeObjectOwnership({ user_id: 'u1' }, 'u2');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body).toEqual({ success: false, error: 'Forbidden' });
  });

  it('returns 403 when metadata has no user but caller is authenticated', () => {
    expect(assertStripeObjectOwnership({}, 'u1')?.status).toBe(403);
  });

  it('returns 403 when metadata has user but caller is anonymous', () => {
    expect(assertStripeObjectOwnership({ user_id: 'u1' }, null)?.status).toBe(403);
  });

  it('returns null for guest path (no metadata user, no caller)', () => {
    expect(assertStripeObjectOwnership(null, null)).toBeNull();
    expect(assertStripeObjectOwnership({}, null)).toBeNull();
  });

  it('treats empty string user_id as missing', () => {
    expect(assertStripeObjectOwnership({ user_id: '' }, null)).toBeNull();
  });
});
