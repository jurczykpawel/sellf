import { describe, it, expect } from 'vitest';
import { fetchEligibleEndpoints } from '@/lib/webhooks/endpoint-selection';

function fakeClient(rows: any[]) {
  return {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        contains() { return Promise.resolve({ data: rows, error: null }); },
      };
    },
  } as any;
}

describe('fetchEligibleEndpoints carries customization columns', () => {
  it('returns custom_headers_encrypted, custom_payload_fields, payload_field_selection', async () => {
    const rows = [{
      id: 'e1', url: 'https://x', secret: 's', product_filter_mode: 'all',
      custom_headers_encrypted: 'enc', custom_payload_fields: { brand: 'tsa' }, payload_field_selection: ['email'],
    }];
    const out = await fetchEligibleEndpoints(fakeClient(rows), 'purchase.completed');
    expect(out[0]).toMatchObject({
      id: 'e1', url: 'https://x', secret: 's',
      custom_headers_encrypted: 'enc', custom_payload_fields: { brand: 'tsa' }, payload_field_selection: ['email'],
    });
  });
});
