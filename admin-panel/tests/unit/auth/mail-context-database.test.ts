/** Existing account email context uses the same fields as signup. */
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';

it('refreshes locale and purchase data and clears the previous mail context', async () => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `mail-context-${crypto.randomUUID()}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  expect(error).toBeNull();
  const id = data.user!.id;
  try {
    expect((await db.rpc('prepare_event_mail', { p_email: email, p_data: { locale: 'pl', purchase_product: 'Warsztat', purchase_amount: '67 zł', event_date: '10 gru 2026' } })).error).toBeNull();
    let user = (await db.auth.admin.getUserById(id)).data.user!;
    expect(user.user_metadata).toMatchObject({ locale: 'pl', purchase_product: 'Warsztat', purchase_amount: '67 zł' });
    expect((await db.rpc('prepare_event_mail', { p_email: email, p_data: { locale: 'en' } })).error).toBeNull();
    user = (await db.auth.admin.getUserById(id)).data.user!;
    expect(user.user_metadata.locale).toBe('en');
    for (const key of ['purchase_product', 'purchase_amount', 'event_date']) expect(user.user_metadata).not.toHaveProperty(key);
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
    expect((await anon.rpc('prepare_event_mail', { p_email: email, p_data: {} })).error).not.toBeNull();
  } finally { await db.auth.admin.deleteUser(id); }
});
