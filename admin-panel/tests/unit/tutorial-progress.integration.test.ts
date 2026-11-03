import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? '';
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
const admin = createClient(url, service);

async function signedIn(email: string) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (error) throw error;
  return client;
}

describe('tutorial_progress row level security', () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emails = [`tour-a-${stamp}@example.com`, `tour-b-${stamp}@example.com`];
  const ids: string[] = [];

  beforeAll(async () => {
    for (const email of emails) {
      const { data, error } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true });
      if (error || !data.user) throw error ?? new Error('user missing');
      ids.push(data.user.id);
    }
  });
  afterAll(async () => {
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  });

  it('lets a user record and read only their own seen tutorials', async () => {
    const a = await signedIn(emails[0]);
    const b = await signedIn(emails[1]);
    expect((await a.from('tutorial_progress').insert({ user_id: ids[0], tutorial_id: 'storefront-templates' })).error).toBeNull();
    expect((await b.from('tutorial_progress').insert({ user_id: ids[1], tutorial_id: 'offer-page' })).error).toBeNull();
    const seenByA = await a.from('tutorial_progress').select('tutorial_id');
    expect(seenByA.data).toEqual([{ tutorial_id: 'storefront-templates' }]);
    const seenByB = await b.from('tutorial_progress').select('tutorial_id');
    expect(seenByB.data).toEqual([{ tutorial_id: 'offer-page' }]);
  });

  it('rejects a row written on behalf of another user', async () => {
    const a = await signedIn(emails[0]);
    const { error } = await a.from('tutorial_progress').insert({ user_id: ids[1], tutorial_id: 'events' });
    expect(error).not.toBeNull();
    const { data } = await admin.from('tutorial_progress').select('tutorial_id').eq('user_id', ids[1]);
    expect(data).toEqual([{ tutorial_id: 'offer-page' }]);
  });

  it('keeps the same tutorial recorded once per user', async () => {
    const a = await signedIn(emails[0]);
    const again = await a.from('tutorial_progress').insert({ user_id: ids[0], tutorial_id: 'storefront-templates' });
    expect(again.error?.code).toBe('23505');
  });

  it('rejects malformed tutorial identifiers', async () => {
    const { error } = await admin.from('tutorial_progress').insert({ user_id: ids[0], tutorial_id: 'Not A Slug' });
    expect(error).not.toBeNull();
  });

  it('hides progress from anonymous visitors', async () => {
    const anonymous = createClient(url, anonKey);
    const { data } = await anonymous.from('tutorial_progress').select('tutorial_id');
    expect(data ?? []).toEqual([]);
  });

  it('removes progress together with the account', async () => {
    const { data: created } = await admin.auth.admin.createUser({ email: `tour-c-${stamp}@example.com`, password: 'password123', email_confirm: true });
    const userId = created.user!.id;
    await admin.from('tutorial_progress').insert({ user_id: userId, tutorial_id: 'licenses' });
    await admin.auth.admin.deleteUser(userId);
    const { data } = await admin.from('tutorial_progress').select('tutorial_id').eq('user_id', userId);
    expect(data).toEqual([]);
  });
});
