/**
 * Unit tests for reading webhook_endpoint_products links (single + batch).
 * Thenable fake Supabase client, no DB.
 */

import { describe, it, expect } from 'vitest';
import { getEndpointProductIds, getEndpointProductIdsMap } from '@/lib/webhooks/endpoint-products';

interface Row {
  webhook_endpoint_id: string;
  product_id: string;
}

function makeClient(rows: Row[]) {
  const captured: { eq?: string; inVals?: string[] } = {};
  return {
    from(table: string) {
      if (table !== 'webhook_endpoint_products') throw new Error(`unexpected table ${table}`);
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (_c: string, v: string) => {
        captured.eq = v;
        return b;
      };
      b.in = (_c: string, v: string[]) => {
        captured.inVals = v;
        return b;
      };
      b.then = (resolve: (x: unknown) => unknown) => {
        let data = rows;
        if (captured.eq !== undefined) data = rows.filter((r) => r.webhook_endpoint_id === captured.eq);
        if (captured.inVals !== undefined) data = rows.filter((r) => captured.inVals!.includes(r.webhook_endpoint_id));
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return b;
    },
  };
}

const ROWS: Row[] = [
  { webhook_endpoint_id: 'e1', product_id: 'p1' },
  { webhook_endpoint_id: 'e1', product_id: 'p2' },
  { webhook_endpoint_id: 'e2', product_id: 'p3' },
];

describe('getEndpointProductIds', () => {
  it('returns the product ids linked to one endpoint', async () => {
    const ids = await getEndpointProductIds(makeClient(ROWS), 'e1');
    expect(ids.sort()).toEqual(['p1', 'p2']);
  });

  it('returns an empty array when the endpoint has no links', async () => {
    expect(await getEndpointProductIds(makeClient(ROWS), 'none')).toEqual([]);
  });
});

describe('getEndpointProductIdsMap', () => {
  it('groups product ids per endpoint', async () => {
    const map = await getEndpointProductIdsMap(makeClient(ROWS), ['e1', 'e2']);
    expect(map['e1'].sort()).toEqual(['p1', 'p2']);
    expect(map['e2']).toEqual(['p3']);
  });

  it('returns an empty object and skips the query for an empty id list', async () => {
    const map = await getEndpointProductIdsMap(makeClient(ROWS), []);
    expect(map).toEqual({});
  });
});
