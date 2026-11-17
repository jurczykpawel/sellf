import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ requireAdminApi: vi.fn() }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: mocks.requireAdminApi }));
import { POST as replay } from '@/app/api/v1/webhooks/logs/[logId]/replay/route';
import { POST as retry } from '@/app/api/v1/webhooks/logs/[logId]/retry/route';
import { POST as forceRetry } from '@/app/api/v1/webhooks/logs/[logId]/force-retry/route';
import { POST as retryEvent } from '@/app/api/v1/webhooks/events/[eventId]/retry/route';

it.each([replay, retry, forceRetry, retryEvent])('requires the admin session for manual delivery operations', async handler => {
  const response = await handler(new NextRequest('http://localhost/api/v1/webhooks/logs/00000000-0000-4000-8000-000000000001/replay', {
    method: 'POST', headers: { Authorization: `Bearer sf_test_${'a'.repeat(64)}` },
  }), { params: Promise.resolve({ logId: '00000000-0000-4000-8000-000000000001', eventId: '00000000-0000-4000-8000-000000000001' }) });
  expect(response.status).toBe(403);
  expect(mocks.requireAdminApi).not.toHaveBeenCalled();
});
