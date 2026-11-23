import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fixtures from '../../fixtures/stripe/buyer-delivery-logs.json';
import { storeBuyerPayload } from '@/lib/webhooks/buyer-payload-storage';
const mocks=vi.hoisted(()=>({authenticate:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/api',async actual=>({...await actual<typeof import('@/lib/api')>(),authenticate:mocks.authenticate}));
import { GET } from '@/app/api/v1/webhooks/logs/route';

beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('APP_ENCRYPTION_KEY',Buffer.alloc(32,7).toString('base64'));});
afterEach(()=>vi.unstubAllEnvs());
it.each(fixtures)('returns a readable $event delivery log',async payload=>{
  const stored=await storeBuyerPayload(payload.event,payload);
  const log={id:payload.id,event_type:payload.event,payload:stored,created_at:payload.timestamp};
  const query={select:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn(async()=>({data:[log],error:null}))};
  mocks.from.mockReturnValue(query);mocks.authenticate.mockResolvedValue({supabase:{from:mocks.from}});
  const response=await GET(new NextRequest('http://localhost/api/v1/webhooks/logs'));
  expect(response.status).toBe(200);
  const shown=(await response.json()).data[0].payload;
  expect(shown).toMatchObject({id:payload.id,event:payload.event,data:expect.any(Object)});
  const text=JSON.stringify(shown);
  expect(text).not.toContain('fixture-credential');
  expect(text).not.toMatch(/sellf:buyer-payload|encrypted_key|encryption_iv|encryption_tag/);
  expect(text).not.toContain('https://shop.example.test/order/');
  function check(value:unknown):void {
    if (!value||typeof value!=='object') return;
    for (const [key,item] of Object.entries(value)) {
      if (['token','licenseKey','participantsUrl','payUrl'].includes(key)&&typeof item==='string') expect(item).toBe('[REDACTED]');
      else check(item);
    }
  }
  check(shown);
});
