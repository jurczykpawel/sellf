/** Adding participants after payment: signed link, validation, mail and webhook outbox as seen by buyer and integrator. @J204 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const magic = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/magic-link/request', () => ({ sendTrustedMagicLink: magic }));
import { buildParticipantsLink, signParticipantsToken, verifyParticipantsToken } from '@/lib/orders/participants-token';
import { signTransferToken } from '@/lib/orders/transfer-token';
import { runParticipantsReminders, sendParticipantsNotice, submitParticipants } from '@/lib/orders/participants-service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const id = '10000000-0000-4000-8000-000000000001';
const people = [{ first_name: 'Jan', last_name: 'Nowak', email: 'jan@example.com' }, { first_name: 'Anna', last_name: 'Kowalska', email: 'anna@example.com' }];
beforeEach(() => { process.env.CHECKOUT_BINDING_SECRET = 'x'.repeat(40); process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'; magic.mockReset(); magic.mockResolvedValue({ ok: true }); });

describe('participants link', () => {
  it('verifies only for its own order, purpose and lifetime', () => {
    const token = signParticipantsToken(id, 1000);
    expect(verifyParticipantsToken(token, id, 1001)).toBe(true);
    expect(verifyParticipantsToken(token, '10000000-0000-4000-8000-000000000002', 1001)).toBe(false);
    expect(verifyParticipantsToken(token, id, 1000 + 400 * 86400)).toBe(false);
    expect(verifyParticipantsToken(signTransferToken(id), id)).toBe(false);
    expect(verifyParticipantsToken(undefined, id)).toBe(false);
  });
  it('builds a localized page URL', () => {
    expect(buildParticipantsLink(id, 'pl', 'https://shop.example').url).toMatch(/^https:\/\/shop\.example\/pl\/order\/[0-9a-f-]{36}\/participants\?token=\d+\.[A-Za-z0-9_-]{43}$/);
  });
});

describe('submitParticipants', () => {
  const db = (result: unknown) => ({ rpc: vi.fn(async () => ({ data: result, error: null })) }) as unknown as SupabaseClient<Database> & { rpc: ReturnType<typeof vi.fn> };
  it('validates the list against the quantity before touching the database', async () => {
    const client = db({ ok: true });
    expect(await submitParticipants(client, id, 2, [people[0]])).toEqual({ ok: false, code: 'participant_count' });
    expect(await submitParticipants(client, id, 2, [people[0], { ...people[1], email: 'JAN@example.com' }])).toMatchObject({ ok: false, code: 'duplicate_email' });
    expect(await submitParticipants(client, id, 2, [people[0], { ...people[1], email: 'bad' }])).toMatchObject({ ok: false });
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it('stores a valid list through the single atomic function', async () => {
    const client = db({ ok: true });
    expect(await submitParticipants(client, id, 2, people)).toEqual({ ok: true });
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('submit_order_participants', { p_order_id: id, p_people: people });
  });
  it.each(['not_paid', 'not_allowed', 'already_complete', 'participant_count', 'not_found'])('passes the database refusal %s back', async code => {
    expect(await submitParticipants(db({ ok: false, code }), id, 2, people)).toEqual({ ok: false, code });
  });
});

describe('participants mail', () => {
  function client(tx: Record<string, unknown> | null, product = { slug: 'seats', name: 'Seats' }) {
    const updates: unknown[] = [];
    const chain = (data: unknown) => { const q: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'is', 'update']) q[m] = (...a: unknown[]) => { if (m === 'update') updates.push(a[0]); return q; }; q.single = async () => ({ data, error: null }); q.then = (r: (v: unknown) => unknown) => r({ data: null, error: null }); return q; };
    const from = vi.fn((table: string) => chain(table === 'products' ? product : tx));
    return { db: { from } as unknown as SupabaseClient<Database>, updates };
  }
  const paid = { id, status: 'completed', customer_email: 'buyer@example.com', product_id: 'p', metadata: { locale: 'pl' }, participants_mail_sent_at: null, order_number: 7, amount: 12300, currency: 'PLN' };
  it('sends one mail with the signed participants link and records delivery', async () => {
    const { db, updates } = client(paid);
    await sendParticipantsNotice(db, id);
    expect(magic).toHaveBeenCalledOnce();
    const data = magic.mock.calls[0][0].data;
    expect(data).toMatchObject({ mail_kind: 'participants_needed', locale: 'pl', purchase_product: 'Seats' });
    expect(data.participants_url).toMatch(/\/pl\/order\/[0-9a-f-]{36}\/participants\?token=/);
    expect(updates).toEqual([{ participants_mail_sent_at: expect.any(String) }]);
  });
  it('does not repeat a delivered mail, nor mail an unpaid order', async () => {
    await sendParticipantsNotice(client({ ...paid, participants_mail_sent_at: '2026-01-01T00:00:00Z' }).db, id);
    await sendParticipantsNotice(client({ ...paid, status: 'awaiting_payment' }).db, id);
    expect(magic).not.toHaveBeenCalled();
  });
  it('leaves a failed delivery pending for the next run', async () => {
    magic.mockResolvedValue({ ok: false });
    const { db, updates } = client(paid);
    await sendParticipantsNotice(db, id);
    expect(updates).toEqual([]);
  });
  it('the reminder job mails every order the database lists as missing participants', async () => {
    const rpc = vi.fn(async () => ({ data: [{ id }], error: null }));
    const { db } = client(paid);
    const result = await runParticipantsReminders(Object.assign(db, { rpc }) as unknown as SupabaseClient<Database>);
    expect(rpc).toHaveBeenCalledWith('list_orders_missing_participants', { p_unsent_only: true, p_limit: 50 });
    expect(result).toEqual({ processed: 1, errors: 0 });
    expect(magic).toHaveBeenCalledOnce();
  });
});

describe('order.participants_updated webhook registration', () => {
  it('is a registered, documented, testable event whose sample carries the list', async () => {
    const { WEBHOOK_EVENTS } = await import('@/types/webhooks');
    const { validateEventTypes } = await import('@/lib/validations/webhook');
    const { WEBHOOK_MOCK_PAYLOADS } = await import('@/lib/webhooks/mock-payloads');
    const en = (await import('@/messages/en.json')).default, pl = (await import('@/messages/pl.json')).default;
    expect(WEBHOOK_EVENTS.some(entry => entry.value === 'order.participants_updated')).toBe(true);
    expect(validateEventTypes(['order.participants_updated']).valid).toBe(true);
    const sample = WEBHOOK_MOCK_PAYLOADS['order.participants_updated'];
    expect(sample.orderDetails.participants.people).toHaveLength(sample.orderDetails.quantity.value);
    expect(sample.order).toMatchObject({ orderId: expect.any(String), orderNumber: expect.any(Number) });
    for (const messages of [en, pl]) expect(JSON.stringify(messages).match(/"order_participants_updated":/g)).toHaveLength(2);
  });
});
