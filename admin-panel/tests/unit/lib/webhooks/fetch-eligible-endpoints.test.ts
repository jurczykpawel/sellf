/**
 * Unit tests for fetchEligibleEndpoints — the DB-backed endpoint selection used
 * by webhook dispatch. Uses a lightweight thenable fake of the Supabase client
 * so no database is required.
 */

import { describe, it, expect } from 'vitest';
import { fetchEligibleEndpoints } from '@/lib/webhooks/endpoint-selection';

interface Candidate {
  id: string;
  url: string;
  secret: string;
  product_filter_mode: 'all' | 'selected';
}
interface Link {
  webhook_endpoint_id: string;
  product_id: string;
}

function makeClient(candidates: Candidate[], links: Link[]) {
  const captured: { endpointIds?: string[]; productIds?: string[]; junctionQueried: boolean } = {
    junctionQueried: false,
  };

  function endpointsBuilder() {
    const b: Record<string, unknown> = {};
    const ret = () => b;
    b.select = ret;
    b.eq = ret;
    b.contains = ret;
    b.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: candidates, error: null }).then(resolve);
    return b;
  }

  function junctionBuilder() {
    captured.junctionQueried = true;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.in = (col: string, vals: string[]) => {
      if (col === 'webhook_endpoint_id') captured.endpointIds = vals;
      else captured.productIds = vals;
      return b;
    };
    b.then = (resolve: (v: unknown) => unknown) => {
      const filtered = links.filter(
        (l) =>
          (!captured.endpointIds || captured.endpointIds.includes(l.webhook_endpoint_id)) &&
          (!captured.productIds || captured.productIds.includes(l.product_id)),
      );
      return Promise.resolve({ data: filtered, error: null }).then(resolve);
    };
    return b;
  }

  return {
    client: {
      from(table: string) {
        if (table === 'webhook_endpoints') return endpointsBuilder();
        if (table === 'webhook_endpoint_products') return junctionBuilder();
        throw new Error(`unexpected table ${table}`);
      },
    },
    captured,
  };
}

const ALL = { id: 'all1', url: 'https://a', secret: 's1', product_filter_mode: 'all' as const };
const SELa = { id: 'sel-a', url: 'https://b', secret: 's2', product_filter_mode: 'selected' as const };
const SELb = { id: 'sel-b', url: 'https://c', secret: 's3', product_filter_mode: 'selected' as const };

describe('fetchEligibleEndpoints', () => {
  it('returns all matching endpoints and skips the junction when no product context', async () => {
    const { client, captured } = makeClient([ALL, SELa], []);
    const result = await fetchEligibleEndpoints(client, 'access.expired', undefined);
    expect(result.map((e) => e.id).sort()).toEqual(['all1', 'sel-a']);
    expect(captured.junctionQueried).toBe(false);
  });

  it('returns all-mode endpoints plus selected endpoints linked to the product', async () => {
    const links = [{ webhook_endpoint_id: 'sel-a', product_id: 'p1' }];
    const { client } = makeClient([ALL, SELa, SELb], links);
    const result = await fetchEligibleEndpoints(client, 'purchase.completed', 'p1');
    expect(result.map((e) => e.id).sort()).toEqual(['all1', 'sel-a']);
  });

  it('matches a selected endpoint when ANY of several products is linked (order bump)', async () => {
    const links = [{ webhook_endpoint_id: 'sel-b', product_id: 'bump' }];
    const { client, captured } = makeClient([ALL, SELa, SELb], links);
    const result = await fetchEligibleEndpoints(client, 'purchase.completed', ['main', 'bump']);
    expect(result.map((e) => e.id).sort()).toEqual(['all1', 'sel-b']);
    expect(captured.productIds).toEqual(['main', 'bump']);
  });

  it('returns the endpoint url and secret needed for dispatch', async () => {
    const { client } = makeClient([ALL], []);
    const result = await fetchEligibleEndpoints(client, 'access.expired', undefined);
    expect(result[0]).toMatchObject({ id: 'all1', url: 'https://a', secret: 's1' });
  });

  it('only includes all-mode endpoints when product has no linked selected endpoints', async () => {
    const { client } = makeClient([ALL, SELa], []);
    const result = await fetchEligibleEndpoints(client, 'purchase.completed', 'p-unknown');
    expect(result.map((e) => e.id)).toEqual(['all1']);
  });

  it('throws when the junction query errors instead of silently dropping deliveries', async () => {
    const client = {
      from(table: string) {
        const b: Record<string, unknown> = {};
        const ret = () => b;
        b.select = ret;
        b.eq = ret;
        b.contains = ret;
        b.in = ret;
        b.then = (resolve: (v: unknown) => unknown) => {
          if (table === 'webhook_endpoint_products') {
            return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve);
          }
          return Promise.resolve({ data: [ALL, SELa], error: null }).then(resolve);
        };
        return b;
      },
    };
    await expect(fetchEligibleEndpoints(client, 'purchase.completed', 'p1')).rejects.toBeTruthy();
  });
});
