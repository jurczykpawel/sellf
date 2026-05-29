/**
 * Unit tests for replaceEndpointProducts — write-side junction maintenance with
 * replace semantics. Uses a thenable fake Supabase client (no DB).
 */

import { describe, it, expect } from 'vitest';
import { replaceEndpointProducts } from '@/lib/webhooks/endpoint-products';

function makeClient() {
  const ops: { deletedFor: string[]; inserted: Array<{ webhook_endpoint_id: string; product_id: string }> } = {
    deletedFor: [],
    inserted: [],
  };

  return {
    client: {
      from(table: string) {
        if (table !== 'webhook_endpoint_products') throw new Error(`unexpected table ${table}`);
        const b: Record<string, unknown> = {};
        b.delete = () => b;
        b.eq = (_col: string, val: string) => {
          ops.deletedFor.push(val);
          return b;
        };
        b.insert = (rows: Array<{ webhook_endpoint_id: string; product_id: string }>) => {
          ops.inserted.push(...rows);
          return b;
        };
        b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
        return b;
      },
    },
    ops,
  };
}

const EP = 'endpoint-1';

describe('replaceEndpointProducts', () => {
  it('clears existing links then inserts the new set', async () => {
    const { client, ops } = makeClient();
    await replaceEndpointProducts(client, EP, ['p1', 'p2']);
    expect(ops.deletedFor).toEqual([EP]);
    expect(ops.inserted).toEqual([
      { webhook_endpoint_id: EP, product_id: 'p1' },
      { webhook_endpoint_id: EP, product_id: 'p2' },
    ]);
  });

  it('only deletes (no insert) when the new set is empty', async () => {
    const { client, ops } = makeClient();
    await replaceEndpointProducts(client, EP, []);
    expect(ops.deletedFor).toEqual([EP]);
    expect(ops.inserted).toEqual([]);
  });

  it('deduplicates product ids before inserting', async () => {
    const { client, ops } = makeClient();
    await replaceEndpointProducts(client, EP, ['p1', 'p1', 'p2']);
    expect(ops.inserted).toEqual([
      { webhook_endpoint_id: EP, product_id: 'p1' },
      { webhook_endpoint_id: EP, product_id: 'p2' },
    ]);
  });
});
