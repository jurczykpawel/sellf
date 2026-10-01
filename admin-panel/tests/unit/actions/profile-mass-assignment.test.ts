import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateMock = vi.fn();
const getUserMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: () => ({ update: updateMock }),
  })),
}));

vi.mock('@/lib/demo-guard', () => ({
  isDemoMode: () => false,
  DEMO_MODE_ERROR: 'demo',
}));

import { updateProfile } from '@/lib/actions/profile';

beforeEach(() => {
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  updateMock.mockReset();
  updateMock.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
});

describe('updateProfile — mass assignment', () => {
  it('accepts a normal profile update', async () => {
    const result = await updateProfile({ first_name: 'Ada' });
    expect(result).toEqual({ success: true });
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('saves the full profile row the form sends, writing only editable columns', async () => {
    const result = await updateProfile({
      first_name: 'Ada',
      // The form submits the whole profile row it loaded.
      // @ts-expect-error — row columns that are not editable
      id: 'someone-else',
      avatar_url: 'https://example.com/a.png',
      created_at: '2020-01-01T00:00:00Z',
      is_admin: true,
    });
    expect(result).toEqual({ success: true });
    const written = updateMock.mock.calls[0][0];
    expect(written.first_name).toBe('Ada');
    expect(written).not.toHaveProperty('id');
    expect(written).not.toHaveProperty('is_admin');
    expect(written).not.toHaveProperty('created_at');
    expect(written).not.toHaveProperty('avatar_url');
  });
});
