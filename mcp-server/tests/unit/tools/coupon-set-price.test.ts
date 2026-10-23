import { expect, it } from 'vitest';
import { z } from 'zod';
import { registerCouponsTools } from '../../../src/tools/coupons.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
it('exposes set_price including zero for creation and updates', () => {
  const schemas = new Map<string, Record<string, z.ZodType>>();
  registerCouponsTools({ tool: (name: string, _description: string, schema: Record<string, z.ZodType>) => schemas.set(name, schema) } as unknown as McpServer);
  for (const name of ['create_coupon', 'update_coupon']) {
    expect(schemas.get(name)!.discount_type.safeParse('set_price').success).toBe(true);
    expect(schemas.get(name)!.discount_value.safeParse(0).success).toBe(true);
    expect(schemas.get(name)!.discount_type.safeParse('unknown').success).toBe(false);
  }
});

it('accepts the documented B2B cart profile in product creation', async () => {
  const { productCreateShape } = await import('../../../src/tools/product-schema.js');
  expect(productCreateShape.checkout_profile.safeParse({ v: 1, modules: [
    { id: 'buyer', types: ['organization'], gus: false, bank_transfer_for: ['organization'] },
    { id: 'recipient', for: ['organization'] }, { id: 'phone', required: true },
    { id: 'quantity', min: 1, max: 50, mode: 'product_page' },
    { id: 'participants', required: true, prefill_from_buyer: true },
  ] }).success).toBe(true);
});
