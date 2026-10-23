import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerWebhooksTools } from '../../../src/tools/webhooks.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
describe('transfer webhook subscriptions', () => {
  it('allows each transfer event for create and update', () => {
    const schemas = new Map<string, Record<string, z.ZodType>>();
    registerWebhooksTools({ tool: (name: string, _description: string, schema: Record<string, z.ZodType>) => schemas.set(name, schema) } as unknown as McpServer);
    for (const tool of ['create_webhook', 'update_webhook']) {
      for (const event of ['order.placed', 'order.cancelled', 'order.overdue']) expect(schemas.get(tool)!.events.safeParse([event]).success).toBe(true);
    }
  });
});
