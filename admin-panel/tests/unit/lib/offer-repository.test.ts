/** Offer snapshot reads. @see supabase/tests/product-offers.sql */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { beforeEach, expect, it, vi } from 'vitest';
import { CORE_TOKENS } from '@/lib/storefront-templates/public-theme';
import { readPublishedOffer, readOfferConfig, readOfferHistory } from '@/lib/storefront-templates/offer-repository';
import { offerConfigSchema, validatePhase2 } from '@/lib/storefront-templates/phase2-contracts';
import { storedJsonBytes } from '@/lib/storefront-templates/json';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
const license = vi.hoisted(() => ({ allowed: vi.fn() }));
vi.mock('@/lib/license/public-snapshot', () => ({ checkPublicFeature: license.allowed }));
const id = '11111111-1111-4111-a111-111111111111';
const config = { format: 1, enabled: true, templateId: 'offer-default', settings: { density: 'comfortable' }, content: {}, tokens: null };
const row = { product_id: id, revision: 2, draft: config, published: null, updated_at: '2026-10-17T00:00:00Z', updated_by: null };
const history = { product_id: id, revision: 2, operation: 'draft', draft: config, published: null, actor_id: null, created_at: row.updated_at, restored_from: null };
const q = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), order: vi.fn(), lt: vi.fn(), limit: vi.fn() };
const client = { from: vi.fn(() => q) };
const db = client as unknown as SupabaseClient<Database>;
beforeEach(() => {
  vi.resetAllMocks(); license.allowed.mockReturnValue(true); client.from.mockReturnValue(q);
  for (const method of ['select', 'eq', 'order', 'lt'] as const) q[method].mockReturnValue(q);
  q.maybeSingle.mockResolvedValue({ data: row, error: null });
  q.limit.mockResolvedValue({ data: [history], error: null });
});
it('reads only published presentation and respects opt-in', async () => {
  for (const published of [null, { ...config, enabled: false }, config]) {
    q.maybeSingle.mockResolvedValue({ data: { published, draft: config, price: 99, content_config: 'private' }, error: null });
    expect(await readPublishedOffer(db, id)).toEqual({ success: true, data: published?.enabled ? config : null });
  }
  expect(q.select).toHaveBeenCalledWith('published');
  expect(q.eq).toHaveBeenCalledWith('product_id', id);
});
it('supports absent rows without enabling an offer', async () => {
  q.maybeSingle.mockResolvedValue({ data: null, error: null });
  expect(await readPublishedOffer(db, id)).toEqual({ success: true, data: null });
  expect(await readOfferConfig(db, id)).toEqual({ success: true, data: null });
});
it('reads validated presentation pairs and exact bigint revisions', async () => {
  q.maybeSingle.mockResolvedValue({ data: { ...row, revision: '9007199254740991', price: 99 }, error: null });
  expect(await readOfferConfig(db, id)).toEqual({ success: true, data: { ...row, revision: Number.MAX_SAFE_INTEGER } });
  for (const change of [{ revision: '9007199254740992' }, { revision: '01' }, { draft: {} }, { published: {} }, { product_id: 'other' }]) {
    q.maybeSingle.mockResolvedValue({ data: { ...row, ...change }, error: null });
    expect(await readOfferConfig(db, id)).toMatchObject({ success: false });
  }
});
it('scopes and bounds descending history by product and revision', async () => {
  expect(await readOfferHistory(db, id, { beforeRevision: 3, limit: 1 })).toEqual({ success: true, data: [history] });
  expect(q.eq).toHaveBeenCalledWith('product_id', id);
  expect(q.lt).toHaveBeenCalledWith('revision', 3);
  expect(q.order).toHaveBeenCalledWith('revision', { ascending: false });
  expect(q.limit).toHaveBeenCalledWith(1);
  for (const change of [{ restored_from: -1 }, { product_id: 'other' }, { published: {} }, { revision: '9007199254740992' }]) {
    q.limit.mockResolvedValue({ data: [{ ...history, ...change }], error: null });
    expect(await readOfferHistory(db, id)).toMatchObject({ success: false });
  }
});
it('validates identifiers and page options before querying', async () => {
  expect(await readPublishedOffer(db, 'other')).toMatchObject({ success: false });
  expect(await readOfferConfig(db, 'other')).toMatchObject({ success: false });
  for (const page of [{ limit: 0 }, { limit: 51 }, { beforeRevision: -1 }, { beforeRevision: 2 ** 53 }, { extra: true }])
    expect(await readOfferHistory(db, id, page)).toMatchObject({ success: false });
  expect(client.from).not.toHaveBeenCalled();
});
it('returns generic query failures and validates public data', async () => {
  q.maybeSingle.mockResolvedValue({ data: { published: { ...config, price: 99 } }, error: null });
  expect(await readPublishedOffer(db, id)).toMatchObject({ success: false });
  q.maybeSingle.mockRejectedValue(new Error('private'));
  q.limit.mockRejectedValue(new Error('private'));
  for (const result of [await readPublishedOffer(db, id), await readOfferConfig(db, id), await readOfferHistory(db, id)]) {
    expect(result).toMatchObject({ success: false }); expect(JSON.stringify(result)).not.toContain('private');
  }
});
it.each([102399, 102400, 102401])('checks the %i stored UTF-8 boundary', bytes => {
  const value = { ...config, content: { 'offer.faq': { sourceLocale: 'en', en: { kind: 'faq', items: Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, question: 'Q', answer: 'ą'.repeat(3000) })) } } } };
  const items = value.content['offer.faq'].en.items;
  const initial = storedJsonBytes(value)!;
  // Distribute bounded plain text across FAQ answers.
  let remove = initial - bytes;
  for (const item of items) { const count = Math.min(item.answer.length, Math.ceil(remove / 2)); item.answer = item.answer.slice(count); remove -= count * 2; if (remove <= 0) break; }
  if (remove === -1) items[0].answer += 'x';
  expect(storedJsonBytes(value)).toBe(bytes);
  expect(validatePhase2(value, 'offer-config').valid).toBe(bytes <= 102400);
});

it('keeps the stored structural schema aligned with the frozen offer contract', () => {
  const sql = readFileSync(new URL('../../../../supabase/migrations/20261016232157_product_offer_snapshots.sql', import.meta.url), 'utf8');
  const match = sql.match(/AS \$schema\$ SELECT '([\s\S]*?)'::json; \$schema\$;/);
  expect(match).not.toBeNull();
  expect(JSON.parse(match![1].replaceAll("''", "'"))).toEqual(z.toJSONSchema(offerConfigSchema));
});

it('keeps an enabled free offer and its copy after custom appearance rights expire', async () => {
  const published = { ...config, tokens: CORE_TOKENS };
  q.maybeSingle.mockResolvedValue({ data: { published }, error: null });
  expect(await readPublishedOffer(db, id)).toMatchObject({ success: true, data: { enabled: true, tokens: CORE_TOKENS } });
  license.allowed.mockReturnValue(false);
  expect(await readPublishedOffer(db, id)).toEqual({ success: true, data: { ...published, tokens: null } });
  expect(published.tokens).toEqual(CORE_TOKENS);
  expect(license.allowed).toHaveBeenCalledWith('theme-customization');
});
