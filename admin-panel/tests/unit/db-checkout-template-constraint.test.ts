import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Migration <ts>_add_checkout_template_to_products.sql must:
//  - Add products.checkout_template TEXT NOT NULL DEFAULT 'default'
//  - CHECK (checkout_template IN ('default', 'tip-jar')) as defense-in-depth
//    alongside the zod whitelist at the API boundary.
//
// We assert the column exists, the default applies, and the CHECK rejects
// any slug not in the registry — so the DB stays a source of truth even if
// the API layer is bypassed (e.g. a future SQL action, a direct dump/restore).

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const insertProduct = (overrides: Record<string, unknown> = {}) =>
  admin
    .from('products')
    .insert({
      name: `Template Constraint Test ${Date.now()}-${Math.random()}`,
      slug: `template-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      price: 10,
      currency: 'USD',
      is_active: true,
      ...overrides,
    })
    .select('id, checkout_template')
    .single();

describe('products.checkout_template constraint', () => {
  it("defaults new rows to 'default' when the field is omitted", async () => {
    const { data, error } = await insertProduct();
    expect(error).toBeNull();
    expect(data?.checkout_template).toBe('default');
    if (data?.id) await admin.from('products').delete().eq('id', data.id);
  });

  it("accepts 'tip-jar' as a valid template slug", async () => {
    // tip-jar requires PWYW (allow_custom_price=true) per
    // products_tipjar_requires_pwyw CHECK — set both so the row is valid.
    const { data, error } = await insertProduct({
      checkout_template: 'tip-jar',
      allow_custom_price: true,
      price: 0,
      custom_price_min: 1,
    });
    expect(error).toBeNull();
    expect(data?.checkout_template).toBe('tip-jar');
    if (data?.id) await admin.from('products').delete().eq('id', data.id);
  });

  it('rejects any slug outside the registry via the CHECK constraint', async () => {
    const { data, error } = await insertProduct({ checkout_template: 'evil-template' });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    // Postgres surfaces check_violation through PGRST or as code 23514 — be loose.
    expect(error?.message?.toLowerCase()).toMatch(/check|constraint|violat/);
  });
});
