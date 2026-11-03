import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUserMock, upsertMock, selectMock } = vi.hoisted(() => ({ getUserMock: vi.fn(), upsertMock: vi.fn(), selectMock: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: () => ({ upsert: upsertMock, select: selectMock }),
  })),
}));

import { getSeenTutorials, markTutorialSeen } from '@/lib/actions/tutorial-progress';

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  upsertMock.mockReset().mockResolvedValue({ error: null });
  selectMock.mockReset().mockResolvedValue({ data: [{ tutorial_id: 'events' }, { tutorial_id: 'retired-tutorial' }], error: null });
});

describe('tutorial progress actions', () => {
  it('refuses identifiers that are not in the registry without touching the database', async () => {
    expect(await markTutorialSeen('made-up')).toEqual({ success: false, error: 'Unknown tutorial' });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('refuses anonymous callers', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    expect(await markTutorialSeen('events')).toEqual({ success: false, error: 'Not authenticated' });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('records the tutorial for the signed-in user once', async () => {
    expect(await markTutorialSeen('events')).toEqual({ success: true });
    expect(upsertMock).toHaveBeenCalledWith({ user_id: 'user-1', tutorial_id: 'events' }, { onConflict: 'user_id,tutorial_id', ignoreDuplicates: true });
  });

  it('returns a result object instead of throwing when the database fails', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'down' } });
    expect(await markTutorialSeen('events')).toEqual({ success: false, error: 'Could not save tutorial progress' });
  });

  it('lists only seen tutorials that still exist', async () => {
    expect(await getSeenTutorials()).toEqual(['events']);
  });

  it('lists nothing for anonymous callers or when the read fails', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getSeenTutorials()).toEqual([]);
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    selectMock.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect(await getSeenTutorials()).toEqual([]);
  });
});
