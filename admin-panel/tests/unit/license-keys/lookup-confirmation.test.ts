/**
 * Guest license lookup follows the account's e-mail confirmation state.
 * @see src/lib/license-keys/lookup.ts
 */
import { describe, expect, it, vi } from 'vitest';

import { findIssuedLicense } from '@/lib/license-keys/lookup';

function makeAdmin(byUser: object | null, byEmail: object | null) {
  const from = vi.fn().mockImplementation(() => {
    let guest = false;
    const query = {
      select: () => query,
      eq: () => query,
      is: (column: string) => { if (column === 'user_id') guest = true; return query; },
      or: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: async () => ({ data: guest ? byEmail : byUser, error: null }),
    };
    return query;
  });
  return { from };
}

const token = { license_key: 'license-token', issued_at: '2026-10-03', expires_at: null };

describe('Guest license e-mail lookup', () => {
  it('waits for confirmation before looking up a guest license', async () => {
    const admin = makeAdmin(null, token);
    const result = await findIssuedLicense(admin as unknown as Parameters<typeof findIssuedLicense>[0], 'product', { id: 'buyer', email: 'buyer@example.com' });
    expect(result).toBeNull();
    expect(admin.from).toHaveBeenCalledTimes(2);
  });

  it('looks up a guest license for a confirmed address', async () => {
    const admin = makeAdmin(null, token);
    const result = await findIssuedLicense(admin as unknown as Parameters<typeof findIssuedLicense>[0], 'product', { id: 'buyer', email: 'buyer@example.com', email_confirmed_at: '2026-10-03' });
    expect(result).toEqual(token);
    expect(admin.from).toHaveBeenCalledTimes(2);
  });

  it('returns a license already assigned to the account', async () => {
    const admin = makeAdmin(token, null);
    const result = await findIssuedLicense(admin as unknown as Parameters<typeof findIssuedLicense>[0], 'product', { id: 'buyer' });
    expect(result).toEqual(token);
    expect(admin.from).toHaveBeenCalledTimes(1);
  });
});

it('leaves content available if license storage cannot be read', async () => {
  const admin = makeAdmin(null, null);
  const query = admin.from() as { maybeSingle: () => Promise<unknown> };
  query.maybeSingle = async () => ({ data: null, error: { message: 'unavailable' } });
  admin.from.mockReturnValue(query);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(findIssuedLicense(admin as unknown as Parameters<typeof findIssuedLicense>[0], 'product', { id: 'buyer' })).resolves.toBeNull();
  expect(log).toHaveBeenCalled();
  expect(admin.from).toHaveBeenCalledTimes(2);
  log.mockRestore();
});
