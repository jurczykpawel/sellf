import { describe, it, expect, vi } from 'vitest';
import { intersectProductIdsByMembership } from '@/lib/api/filters';

function makeMockClient(rows: Array<Record<string, unknown>>) {
  const fromSpy = vi.fn(() => ({
    select: vi.fn(() => ({
      in: vi.fn().mockResolvedValue({ data: rows, error: null }),
    })),
  }));
  return { client: { from: fromSpy } as unknown as Parameters<typeof intersectProductIdsByMembership>[0], fromSpy };
}

describe('intersectProductIdsByMembership', () => {
  it('issues exactly one .from() call regardless of input length', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const { client, fromSpy } = makeMockClient([
      { product_id: 'p1', category_id: 'a' },
      { product_id: 'p1', category_id: 'b' },
      { product_id: 'p1', category_id: 'c' },
      { product_id: 'p1', category_id: 'd' },
      { product_id: 'p1', category_id: 'e' },
      { product_id: 'p2', category_id: 'a' },
    ]);

    await intersectProductIdsByMembership(client, ids, {
      junctionTable: 'product_categories',
      fkColumn: 'category_id',
    });

    expect(fromSpy).toHaveBeenCalledTimes(1);
    expect(fromSpy).toHaveBeenCalledWith('product_categories');
  });

  it('returns only product ids that match every filter id', async () => {
    const ids = ['a', 'b'];
    const { client } = makeMockClient([
      { product_id: 'p1', tag_id: 'a' },
      { product_id: 'p1', tag_id: 'b' },
      { product_id: 'p2', tag_id: 'a' },
    ]);

    const result = await intersectProductIdsByMembership(client, ids, {
      junctionTable: 'product_tags',
      fkColumn: 'tag_id',
    });

    expect(result).toEqual(['p1']);
  });

  it('returns null when no filter ids supplied (no query at all)', async () => {
    const { client, fromSpy } = makeMockClient([]);
    const result = await intersectProductIdsByMembership(client, [], {
      junctionTable: 'product_categories',
      fkColumn: 'category_id',
    });
    expect(result).toBeNull();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('returns [] when no product matches every filter id', async () => {
    const { client } = makeMockClient([
      { product_id: 'p1', category_id: 'a' },
      { product_id: 'p2', category_id: 'b' },
    ]);
    const result = await intersectProductIdsByMembership(client, ['a', 'b'], {
      junctionTable: 'product_categories',
      fkColumn: 'category_id',
    });
    expect(result).toEqual([]);
  });
});
