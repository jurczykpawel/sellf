/** Owned-stack offer persistence acceptance. @see supabase/tests/product-offers.sql */
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { readOfferConfig, readOfferHistory, readPublishedOffer } from '@/lib/storefront-templates/offer-repository';
import type { Database } from '@/types/database';
import { getTestDatabaseContainer } from '../../helpers/database-container';

it('reloads isolated product presentation through fresh clients @J131', async () => {
  const url = new URL(process.env.OFFER_TEST_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '');
  expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
  const serviceKey = process.env.OFFER_TEST_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw Error('Service key required');
  const container = process.env.SUPABASE_DB_CONTAINER ?? getTestDatabaseContainer();
  const apiPort = execFileSync('docker', ['port', container.replace('supabase_db_', 'supabase_kong_'), '8000/tcp'], { encoding: 'utf8' });
  expect(apiPort).toContain(`:${url.port}`);
  const fresh = () => createClient<Database>(url.href, serviceKey, { auth: { persistSession: false } });
  const client = fresh();
  const { data, error } = await client.from('product_offer_config').select('product_id').order('product_id');
  expect(error).toBeNull(); expect(data).toHaveLength(3);
  const states: unknown[] = [];
  for (const { product_id: id } of data!) {
    const first = await readOfferConfig(client, id);
    expect(first.success).toBe(true);
    expect(await readOfferConfig(fresh(), id)).toEqual(first);
    const history = await readOfferHistory(fresh(), id);
    expect(history.success).toBe(true);
    if (!first.success || !first.data || !history.success) throw Error('Offer snapshot unavailable');
    expect(history.data).toHaveLength(1);
    expect(history.data[0]).toMatchObject({ product_id: id, revision: 0, draft: first.data.draft, published: first.data.published });
    expect(await readPublishedOffer(fresh(), id)).toEqual({ success: true, data: null });
    states.push({ draft: first.data.draft, published: first.data.published });
  }
  expect(states).toEqual(expect.arrayContaining([
    { draft: null, published: null },
    { draft: null, published: expect.objectContaining({ enabled: false }) },
    { draft: expect.objectContaining({ enabled: true, content: expect.objectContaining({ 'offer.hero': expect.objectContaining({ en: expect.any(Object), pl: expect.any(Object) }) }) }), published: null },
  ]));
});
