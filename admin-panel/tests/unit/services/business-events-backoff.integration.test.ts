/**
 * Business events that keep failing must not starve new ones. Scenario:
 * 120 events that always fail (license.issued without its license row) and one new event, worker
 * ticks every 62 s (an external cron that runs a little late). Time is advanced by moving these
 * events' timestamps back 62 s between ticks, which is what the queue sees when 62 s pass.
 * Also: abandonment after the last attempt, the admin listing and retry of abandoned events.
 * Real local database; nothing in the queue is stubbed.
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql
 * @see src/lib/services/business-events.ts
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', async original => {
  const api = await original<typeof import('@/lib/api')>();
  return { ...api, authenticate: async () => ({ method: 'api_key', apiKey: { id: randomUUID() }, admin: { userId: randomUUID() }, scopes: [api.API_SCOPES.WEBHOOKS_READ, api.API_SCOPES.WEBHOOKS_WRITE], supabase: createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) }) };
});

vi.mock('@/lib/auth-server', () => ({ requireAdminApi: async () => ({ user: { id: 'admin' }, role: 'platform_admin' }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));

import { GET as listEvents } from '@/app/api/v1/webhooks/events/route';
import { POST as retryEvent } from '@/app/api/v1/webhooks/events/[eventId]/retry/route';
import { runBusinessEvents } from '@/lib/services/business-events';
import { getTestDatabaseContainer } from '../../helpers/database-container';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const tag = randomUUID();
const sql = (input: string) => execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' }).trim();

/** Inserts events of this file (business_events accepts no inserts from the API roles). */
function insertEvents(count: number, type: string, payload: object, ageSeconds: number): string[] {
  return sql(`INSERT INTO public.business_events(event_type, product_id, payload, created_at)
    SELECT '${type}', NULL, '${JSON.stringify({ ...payload, _test: tag })}'::jsonb, clock_timestamp() - make_interval(secs => ${ageSeconds}) + make_interval(secs => i * 0.001)
    FROM generate_series(1, ${count}) i RETURNING id;`).split('\n').filter(Boolean);
}
/** As if `seconds` passed for this file's events: every stored time moves back (works before and after the backoff columns exist). */
function advance(seconds: number) {
  sql(`DO $$ BEGIN
    UPDATE public.business_events SET created_at = created_at - make_interval(secs => ${seconds}), leased_until = leased_until - make_interval(secs => ${seconds}) WHERE payload->>'_test' = '${tag}';
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business_events' AND column_name = 'next_attempt_at') THEN
      EXECUTE 'UPDATE public.business_events SET next_attempt_at = next_attempt_at - make_interval(secs => ${seconds}) WHERE payload->>''_test'' = ''${tag}''';
    END IF;
  END $$;`);
}
const failing = { licenseRow: null };
const isDispatched = async (id: string) => Boolean((await db.from('business_events').select('dispatched_at').eq('id', id).single()).data?.dispatched_at);

beforeAll(async () => {
  // Earlier suites may leave committed history pending; this queue measurement starts empty.
  await db.from('business_events').update({ dispatched_at: new Date().toISOString(), leased_until: null }).is('dispatched_at', null);
});
beforeEach(() => { sql(`DELETE FROM public.business_events WHERE payload->>'_test' = '${tag}';`); });
afterAll(() => { sql(`DELETE FROM public.business_events WHERE payload->>'_test' = '${tag}';`); });

it('dispatches a new event by the second 62 s tick despite 120 permanently failing older events', async () => {
  insertEvents(120, 'license.issued', failing, 600);
  const [fresh] = insertEvents(1, 'access.granted', { customer: { email: null } }, 0);
  const ticks: { processed: number; errors: number }[] = [];
  for (let tick = 1; tick <= 4 && !(await isDispatched(fresh)); tick++) {
    if (tick > 1) advance(62);
    ticks.push(await runBusinessEvents(db));
  }
  expect(await isDispatched(fresh)).toBe(true);
  expect(ticks.length).toBeLessThanOrEqual(2);
  expect(ticks[0]).toEqual({ processed: 0, errors: 100 });
}, 60_000);

it('delivers a claimed event even when an expiry detection step fails, instead of using up its attempts', async () => {
  // Only capture_expired_access fails; every other RPC and the queue run for real.
  const detectionDown = new Proxy(db, {
    get(target, key, receiver) {
      if (key !== 'rpc') return Reflect.get(target, key, receiver);
      return (name: string, ...rest: unknown[]) => name === 'capture_expired_access'
        ? Promise.resolve({ data: null, error: { message: 'detection unavailable' } })
        : (target.rpc as (...args: unknown[]) => unknown).call(target, name, ...rest);
    },
  });
  const [event] = insertEvents(1, 'access.granted', { customer: { email: null } }, 0);
  for (let cycle = 1; cycle <= 9 && !(await isDispatched(event)); cycle++) {
    if (cycle > 1) advance(61); // the previous one-minute lease has run out
    await runBusinessEvents(detectionDown);
  }
  const row = (await db.from('business_events').select('dispatched_at,abandoned_at,attempts,last_error').eq('id', event).single()).data!;
  expect(row).toMatchObject({ abandoned_at: null, attempts: 1, last_error: null });
  expect(row.dispatched_at).not.toBeNull();
}, 60_000);

it('abandons an event after eight failed attempts with growing intervals and lets an admin retry it', async () => {
  const [stuck] = insertEvents(1, 'license.issued', failing, 60);
  const waits: number[] = [];
  for (let attempt = 1; attempt <= 8; attempt++) {
    expect(await runBusinessEvents(db)).toEqual({ processed: 0, errors: 1 });
    const row = (await db.from('business_events').select('attempts,next_attempt_at,abandoned_at,last_error').eq('id', stuck).single()).data!;
    expect(row.attempts).toBe(attempt);
    expect(row.last_error).toBeTruthy();
    if (attempt < 8) {
      expect(row.abandoned_at).toBeNull();
      waits.push(Math.round((Date.parse(row.next_attempt_at) - Date.now()) / 60_000));
      // Not due before its interval has passed.
      expect(await runBusinessEvents(db)).toEqual({ processed: 0, errors: 0 });
      advance((waits.at(-1)! + 1) * 60);
    } else expect(row.abandoned_at).not.toBeNull();
  }
  expect(waits).toEqual([1, 5, 15, 30, 60, 120, 240]);
  advance(24 * 3600);
  expect(await runBusinessEvents(db)).toEqual({ processed: 0, errors: 0 });

  const listed = await listEvents(new NextRequest('http://localhost/api/v1/webhooks/events?status=abandoned'));
  expect(listed.status).toBe(200);
  const body = await listed.json() as { data: { id: string; event_type: string; attempts: number; last_error: string; abandoned_at: string }[] };
  expect(body.data.find(event => event.id === stuck)).toMatchObject({ event_type: 'license.issued', attempts: 8 });
  expect(JSON.stringify(body)).not.toContain(tag); // the payload is not exposed

  const retried = await retryEvent(new NextRequest(`http://localhost/api/v1/webhooks/events/${stuck}/retry`, { method: 'POST' }), { params: Promise.resolve({ eventId: stuck }) });
  expect(retried.status).toBe(200);
  expect((await db.from('business_events').select('attempts,abandoned_at,next_attempt_at').eq('id', stuck).single()).data).toMatchObject({ attempts: 0, abandoned_at: null });
  expect(await runBusinessEvents(db)).toEqual({ processed: 0, errors: 1 });
  const again = await retryEvent(new NextRequest(`http://localhost/api/v1/webhooks/events/${stuck}/retry`, { method: 'POST' }), { params: Promise.resolve({ eventId: stuck }) });
  expect(again.status).toBe(409); // only an abandoned event can be retried
}, 60_000);
