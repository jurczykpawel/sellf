/**
 * W223c: order details are measured the way the database limits them (octet_length(details::text),
 * 65 536 bytes), so a checkout route can refuse them before its first write.
 * Expected strings are PostgreSQL's own jsonb::text output (measured on the local stack).
 * @see src/lib/checkout-modules/order-details.ts
 */
import { describe, expect, it } from 'vitest';
import { ORDER_DETAILS_MAX_BYTES, orderDetailsByteLength } from '@/lib/checkout-modules/order-details';

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe('order details size as PostgreSQL measures it @J623', () => {
  it('matches jsonb::text: ", " and ": " separators, UTF-8, escapes, empty containers', () => {
    const value = { a: 1, b: [1, 2, { x: null }], c: {}, d: 'ż"\n\u0001/', e: [], t: true, skipped: undefined };
    expect(orderDetailsByteLength(value)).toBe(bytes('{"a": 1, "b": [1, 2, {"x": null}], "c": {}, "d": "ż\\"\\n\\u0001/", "e": [], "t": true}'));
  });

  it('uses the database limit', () => {
    expect(ORDER_DETAILS_MAX_BYTES).toBe(65536);
  });
});
