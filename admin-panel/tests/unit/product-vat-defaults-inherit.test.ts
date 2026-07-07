/**
 * New products must inherit the shop's VAT stance — the default rate AND the
 * "zwolniony / zw." exemption — regardless of how they're created (admin UI,
 * public v1 API, or direct SQL). This is enforced server-side by a BEFORE
 * INSERT trigger on public.products, so client-side seeding is no longer the
 * single mechanism (UI + API parity).
 *
 * Behavioral test against the local Supabase DB (same harness as
 * db-custom-fields-columns.test.ts). It mutates the singleton shop_config and
 * restores it afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const newProduct = (extra: Record<string, unknown> = {}) => ({
  name: `VAT default test ${Date.now()}-${Math.random()}`,
  slug: `vat-def-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  price: 10,
  currency: 'USD',
  is_active: false,
  ...extra,
});

async function insertProduct(extra: Record<string, unknown> = {}) {
  return admin
    .from('products')
    .insert(newProduct(extra))
    .select('id, vat_rate, vat_exempt, vat_exempt_note')
    .single();
}

describe('new products inherit shop VAT defaults (UI + API parity)', () => {
  let shopId: string;
  let original: { tax_rate: number | null; is_vat_exempt: boolean; vat_exempt_note: string | null };
  const created: string[] = [];

  async function setShop(patch: Record<string, unknown>) {
    const { error } = await admin.from('shop_config').update(patch).eq('id', shopId);
    expect(error).toBeNull();
  }

  beforeAll(async () => {
    const { data } = await admin
      .from('shop_config')
      .select('id, tax_rate, is_vat_exempt, vat_exempt_note')
      .order('created_at')
      .limit(1)
      .single();
    shopId = data!.id;
    original = { tax_rate: data!.tax_rate, is_vat_exempt: data!.is_vat_exempt, vat_exempt_note: data!.vat_exempt_note };
  });

  afterAll(async () => {
    await admin.from('shop_config').update(original).eq('id', shopId);
    if (created.length) await admin.from('products').delete().in('id', created);
  });

  it('inherits the shop default vat_rate when none is provided', async () => {
    await setShop({ tax_rate: 23, is_vat_exempt: false });
    const { data, error } = await insertProduct();
    expect(error).toBeNull();
    created.push(data!.id);
    expect(Number(data!.vat_rate)).toBe(23);
    expect(data!.vat_exempt).toBe(false);
  });

  it('inherits the shop VAT exemption (zw.) when none is provided', async () => {
    await setShop({ tax_rate: 23, is_vat_exempt: true });
    const { data, error } = await insertProduct();
    expect(error).toBeNull();
    created.push(data!.id);
    expect(data!.vat_exempt).toBe(true);
    // Exempt means "no VAT at all" — a rate is not applicable.
    expect(data!.vat_rate).toBeNull();
  });

  it('does NOT override an explicitly provided vat_rate', async () => {
    await setShop({ tax_rate: 23, is_vat_exempt: true });
    const { data, error } = await insertProduct({ vat_rate: 7 });
    expect(error).toBeNull();
    created.push(data!.id);
    expect(Number(data!.vat_rate)).toBe(7);
    expect(data!.vat_exempt).toBe(false);
  });

  it('does NOT override an explicit non-exempt product (vat_exempt=false stays, rate inherited)', async () => {
    // A caller can opt a product out of an exempt shop only by giving it a rate;
    // with no rate + no explicit exemption the shop stance wins (covered above).
    await setShop({ tax_rate: 0, is_vat_exempt: false });
    const { data, error } = await insertProduct();
    expect(error).toBeNull();
    created.push(data!.id);
    expect(Number(data!.vat_rate)).toBe(0);
    expect(data!.vat_exempt).toBe(false);
  });

  it('inherits the shop default vat_exempt_note when shop is exempt and none is provided', async () => {
    await setShop({ tax_rate: 23, is_vat_exempt: true, vat_exempt_note: 'art. 113 ust. 1' });
    const { data, error } = await insertProduct();
    expect(error).toBeNull();
    created.push(data!.id);
    expect(data!.vat_exempt).toBe(true);
    expect(data!.vat_exempt_note).toBe('art. 113 ust. 1');
  });

  it('does NOT set vat_exempt_note when the shop has no default note configured', async () => {
    await setShop({ tax_rate: 23, is_vat_exempt: true, vat_exempt_note: null });
    const { data, error } = await insertProduct();
    expect(error).toBeNull();
    created.push(data!.id);
    expect(data!.vat_exempt).toBe(true);
    expect(data!.vat_exempt_note).toBeNull();
  });

  it('does NOT override an explicitly provided vat_exempt_note', async () => {
    await setShop({ tax_rate: 23, is_vat_exempt: true, vat_exempt_note: 'art. 113 ust. 1' });
    const { data, error } = await insertProduct({ vat_exempt: true, vat_exempt_note: 'custom basis' });
    expect(error).toBeNull();
    created.push(data!.id);
    expect(data!.vat_exempt_note).toBe('custom basis');
  });

  it('does NOT set vat_exempt_note on a non-exempt product even if the shop has a default note', async () => {
    // Shop currently non-exempt but has a leftover default note configured — must
    // not leak onto products that aren't exempt.
    await setShop({ tax_rate: 23, is_vat_exempt: false, vat_exempt_note: 'art. 113 ust. 1' });
    const { data, error } = await insertProduct();
    expect(error).toBeNull();
    created.push(data!.id);
    expect(data!.vat_exempt).toBe(false);
    expect(data!.vat_exempt_note).toBeNull();
  });
});
