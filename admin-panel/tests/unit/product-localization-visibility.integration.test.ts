/**
 * Translated product text reaches a buyer only for products the product read rules let them see
 * (publication window, inactive, archive). Real local database and row level security; only the
 * cookie-based session client is replaced by a signed-in supabase-js client.
 * @see src/lib/actions/product-localization.ts
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => session.client }));

import { getProductLocalizations } from '@/lib/actions/product-localization';

const url = process.env.SUPABASE_URL!;
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const run = crypto.randomUUID().slice(0, 8);
const email = `l10n-${run}@example.com`;
const ids = { visible: crypto.randomUUID(), future: crypto.randomUUID(), ended: crypto.randomUUID(), inactiveOwned: crypto.randomUUID(), archivedOwned: crypto.randomUUID() };
let userId = '';

const localized = (name: string) => ({ localized: { pl: { name, description: `${name} opis`, image_alt: `${name} okładka` } } });
const product = (id: string, name: string, extra: Record<string, unknown>) =>
  ({ id, name: `${name} canonical`, slug: `l10n-${name.toLowerCase()}-${run}`, description: 'canonical', price: 10, currency: 'PLN', is_listed: true, enable_waitlist: false, available_from: null, available_until: null, content_config: localized(name), ...extra });

beforeAll(async () => {
  const created = await db.auth.admin.createUser({ email, password: 'password123', email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error('user missing');
  userId = created.data.user.id;
  const insert = await db.from('products').insert([
    product(ids.visible, 'Visible', { is_active: true }),
    product(ids.future, 'Future', { is_active: true, available_from: '2099-01-01T00:00:00Z' }),
    product(ids.ended, 'Ended', { is_active: true, available_until: '2001-01-01T00:00:00Z' }),
    product(ids.inactiveOwned, 'Inactive', { is_active: false }),
    product(ids.archivedOwned, 'Archived', { is_active: false }),
  ]);
  if (insert.error) throw insert.error;
  const archived = await db.from('products').update({ archived_at: new Date().toISOString() }).eq('id', ids.archivedOwned);
  if (archived.error) throw archived.error;
  const grants = await db.from('user_product_access').insert([ids.inactiveOwned, ids.archivedOwned, ids.ended].map(product_id => ({ user_id: userId, product_id })));
  if (grants.error) throw grants.error;
  const client: SupabaseClient = createClient(url, process.env.SUPABASE_ANON_KEY!);
  const signIn = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (signIn.error) throw signIn.error;
  session.client = client;
});

afterAll(async () => {
  await db.from('user_product_access').delete().eq('user_id', userId);
  await db.from('products').delete().in('id', Object.values(ids));
  if (userId) await db.auth.admin.deleteUser(userId);
});

it('returns translations only for products the buyer may read (publication window, inactive, archive)', async () => {
  const result = await getProductLocalizations(Object.values(ids), 'pl');
  expect(result[ids.visible]).toEqual({ name: 'Visible', description: 'Visible opis', imageAlt: 'Visible okładka' });
  expect(result[ids.archivedOwned]?.name).toBe('Archived');
  expect(result[ids.future]).toBeUndefined();
  expect(result[ids.ended]).toBeUndefined();
  expect(result[ids.inactiveOwned]).toBeUndefined();
  expect(Object.keys(result).sort()).toEqual([ids.visible, ids.archivedOwned].sort());
});
