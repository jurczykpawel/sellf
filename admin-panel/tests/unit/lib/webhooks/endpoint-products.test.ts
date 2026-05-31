/**
 * Unit tests for setEndpointScoping — atomic mode+links write via RPC.
 * Fake Supabase client captures the rpc call (no DB).
 */

import { describe, it, expect } from 'vitest';
import { setEndpointScoping } from '@/lib/webhooks/endpoint-products';

function makeClient(error: unknown = null) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  return {
    calls,
    client: {
      rpc(fn: string, args: unknown) {
        calls.push({ fn, args });
        return {
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error }).then(resolve),
        };
      },
    },
  };
}

const EP = 'endpoint-1';

describe('setEndpointScoping', () => {
  it('calls the atomic RPC with mode and product ids', async () => {
    const { client, calls } = makeClient();
    await setEndpointScoping(client, EP, 'selected', ['p1', 'p2']);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('set_webhook_endpoint_scoping');
    expect(calls[0].args).toEqual({
      p_endpoint_id: EP,
      p_mode: 'selected',
      p_product_ids: ['p1', 'p2'],
    });
  });

  it('passes an empty product list for mode=all', async () => {
    const { client, calls } = makeClient();
    await setEndpointScoping(client, EP, 'all', []);
    expect(calls[0].args).toEqual({
      p_endpoint_id: EP,
      p_mode: 'all',
      p_product_ids: [],
    });
  });

  it('throws when the RPC returns an error', async () => {
    const { client } = makeClient({ message: 'boom' });
    await expect(setEndpointScoping(client, EP, 'selected', ['p1'])).rejects.toBeTruthy();
  });
});
