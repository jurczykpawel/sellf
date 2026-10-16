/** Storefront read contract. @see supabase/tests/storefront-config.sql */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, D_CONFIG } from '@/lib/storefront-templates/fixtures';
import { readPublishedConfig, readStorefrontConfig, readStorefrontHistory } from '@/lib/storefront-templates/repository';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const query = {
  select: vi.fn(), eq: vi.fn(), single: vi.fn(), order: vi.fn(), limit: vi.fn(), lt: vi.fn(),
};
const client = { from: vi.fn(() => query) };
const db = client as unknown as SupabaseClient<Database>;
const snapshot = { revision: 0, published: DEFAULT_CONFIG, draft: D_CONFIG, updated_at: '2026-10-15T00:00:00Z', updated_by: null };
const history = { revision: 0, operation: 'legacy-import', published: DEFAULT_CONFIG, draft: null, actor_id: null, created_at: snapshot.updated_at, restored_from: null };

beforeEach(() => {
  vi.resetAllMocks();
  client.from.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.lt.mockReturnValue(query);
  query.single.mockResolvedValue({ data: snapshot, error: null });
  query.limit.mockResolvedValue({ data: [history], error: null });
});

describe('storefront reads', () => {
  it('projects only the published config for trusted public rendering', async () => {
    query.single.mockResolvedValue({ data: { published: DEFAULT_CONFIG, draft: D_CONFIG, updated_by: 'private' }, error: null });
    expect(await readPublishedConfig(db)).toEqual({ success: true, data: DEFAULT_CONFIG });
    expect(query.select).toHaveBeenCalledWith('published');
    expect(query.eq).toHaveBeenCalledWith('id', true);
  });

  it('reads the private draft and published pair with a bounded revision', async () => {
    expect(await readStorefrontConfig(db)).toEqual({ success: true, data: snapshot });
    expect(client.from).toHaveBeenCalledWith('storefront_config');
    query.single.mockResolvedValue({ data: { ...snapshot, revision: '9007199254740991' }, error: null });
    expect(await readStorefrontConfig(db)).toMatchObject({ success: true, data: { revision: Number.MAX_SAFE_INTEGER } });
  });

  it.each([-1, 1.5, 9007199254740992, '9007199254740992', '1e3', '01', null])('rejects stored revision %s', async revision => {
    query.single.mockResolvedValue({ data: { ...snapshot, revision }, error: null });
    expect(await readStorefrontConfig(db)).toEqual({ success: false, error: 'Invalid stored storefront config' });
  });

  it('validates retained draft and published content using the shared validator', async () => {
    for (const field of ['draft', 'published']) {
      query.single.mockResolvedValue({ data: { ...snapshot, [field]: { ...DEFAULT_CONFIG, extra: true } }, error: null });
      expect(await readStorefrontConfig(db)).toMatchObject({ success: false });
    }
    query.single.mockResolvedValue({ data: { published: { ...DEFAULT_CONFIG, extra: true } }, error: null });
    expect(await readPublishedConfig(db)).toMatchObject({ success: false });
  });

  it('returns generic failures for absent rows, query errors and transport failures', async () => {
    query.single.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    expect(await readPublishedConfig(db)).toEqual({ success: false, error: 'Unable to read published storefront config' });
    expect(await readStorefrontConfig(db)).toEqual({ success: false, error: 'Unable to read storefront config' });
    query.single.mockRejectedValue(new Error('private transport detail'));
    expect(await readPublishedConfig(db)).toMatchObject({ success: false });
    expect(await readStorefrontConfig(db)).toMatchObject({ success: false });
    query.limit.mockRejectedValue(new Error('private transport detail'));
    expect(await readStorefrontHistory(db)).toEqual({ success: false, error: 'Unable to read storefront history' });
  });

  it('reads descending history with a bounded keyset page', async () => {
    expect(await readStorefrontHistory(db, { beforeRevision: 12, limit: 5 })).toEqual({ success: true, data: [history] });
    expect(client.from).toHaveBeenCalledWith('storefront_config_history');
    expect(query.order).toHaveBeenCalledWith('revision', { ascending: false });
    expect(query.lt).toHaveBeenCalledWith('revision', 12);
    expect(query.limit).toHaveBeenCalledWith(5);
    await readStorefrontHistory(db);
    expect(query.limit).toHaveBeenLastCalledWith(20);
    await readStorefrontHistory(db, { beforeRevision: 0 });
    expect(query.lt).toHaveBeenLastCalledWith('revision', 0);
  });

  it.each([{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { beforeRevision: -1 }, { beforeRevision: 9007199254740992 }])('rejects invalid history options %j before querying', async options => {
    expect(await readStorefrontHistory(db, options)).toEqual({ success: false, error: 'Invalid history page' });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('validates history revisions, links and snapshots without dropping bad rows', async () => {
    for (const change of [{ revision: '9007199254740992' }, { restored_from: -1 }, { published: {} }, { draft: {} }]) {
      query.limit.mockResolvedValue({ data: [{ ...history, ...change }], error: null });
      expect(await readStorefrontHistory(db)).toEqual({ success: false, error: 'Invalid stored storefront history' });
    }
    query.limit.mockResolvedValue({ data: [{ ...history, revision: '2', restored_from: '0' }], error: null });
    expect(await readStorefrontHistory(db)).toMatchObject({ success: true, data: [{ revision: 2, restored_from: 0 }] });
    query.limit.mockResolvedValue({ data: [], error: null });
    expect(await readStorefrontHistory(db)).toEqual({ success: true, data: [] });
  });
});
