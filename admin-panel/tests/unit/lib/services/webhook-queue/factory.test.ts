import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn(), rpc: vi.fn() })),
}));

describe('getWebhookQueue factory', () => {
  const originalDriver = process.env.WEBHOOK_QUEUE_DRIVER;

  afterEach(() => {
    if (originalDriver === undefined) {
      delete process.env.WEBHOOK_QUEUE_DRIVER;
    } else {
      process.env.WEBHOOK_QUEUE_DRIVER = originalDriver;
    }
    vi.resetModules();
  });

  it('defaults to SupabaseWebhookQueue when no env var is set', async () => {
    delete process.env.WEBHOOK_QUEUE_DRIVER;
    const { getWebhookQueue } = await import('@/lib/services/webhook-queue');
    const { SupabaseWebhookQueue } = await import('@/lib/services/webhook-queue/supabase-queue');
    expect(getWebhookQueue()).toBeInstanceOf(SupabaseWebhookQueue);
  });

  it('returns SupabaseWebhookQueue when WEBHOOK_QUEUE_DRIVER=supabase', async () => {
    process.env.WEBHOOK_QUEUE_DRIVER = 'supabase';
    const { getWebhookQueue } = await import('@/lib/services/webhook-queue');
    const { SupabaseWebhookQueue } = await import('@/lib/services/webhook-queue/supabase-queue');
    expect(getWebhookQueue()).toBeInstanceOf(SupabaseWebhookQueue);
  });

  it('returns SqsWebhookQueue stub when WEBHOOK_QUEUE_DRIVER=sqs', async () => {
    process.env.WEBHOOK_QUEUE_DRIVER = 'sqs';
    const { getWebhookQueue } = await import('@/lib/services/webhook-queue');
    const { SqsWebhookQueue } = await import('@/lib/services/webhook-queue/sqs-queue');
    expect(getWebhookQueue()).toBeInstanceOf(SqsWebhookQueue);
  });

  it('SqsWebhookQueue methods throw NotImplemented', async () => {
    process.env.WEBHOOK_QUEUE_DRIVER = 'sqs';
    const { getWebhookQueue } = await import('@/lib/services/webhook-queue');
    const queue = getWebhookQueue();
    await expect(queue.pickDue(10)).rejects.toThrow(/not implemented/i);
    await expect(queue.replay('id')).rejects.toThrow(/not implemented/i);
  });

  it('throws on unknown driver', async () => {
    process.env.WEBHOOK_QUEUE_DRIVER = 'banana';
    const { getWebhookQueue } = await import('@/lib/services/webhook-queue');
    expect(() => getWebhookQueue()).toThrow(/Unknown WEBHOOK_QUEUE_DRIVER/i);
  });
});
