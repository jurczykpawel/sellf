/**
 * TEMP throwaway — configures two real local products for an embed demo:
 *   captions-basic (free, tier=basic, issues license)  ← exercises the lead.captured patch
 *   captions-premium (paid, tier=premium, issues license)
 * plus a seller signing keypair and an embed allowlist for http://localhost:3000.
 * Run: bun scripts/setup-embed-demo.ts
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { generateSellerKeypair, storeSellerKey, loadActiveSellerKey } from '@/lib/license-keys/keys';
import type { Database } from '@/types/database';

type ProductPatch = Database['public']['Tables']['products']['Update'];

const SELLER_ID = 'dddddddd-0000-4000-a000-000000000000'; // demo@sellf.app (admin)
const ORIGIN = 'http://localhost:3000';
const admin = createAdminClient();

// 1 · seller signing keypair
const existing = await loadActiveSellerKey(admin, SELLER_ID);
if (existing) {
  console.log('✓ keypair exists, kid=', existing.kid);
} else {
  const kp = generateSellerKeypair();
  const { kid } = await storeSellerKey(admin, {
    sellerId: SELLER_ID,
    publicKeyPem: kp.publicKeyPem,
    privateKeyPem: kp.privateKeyPem,
    custody: 'managed',
  });
  console.log('✓ keypair generated, kid=', kid);
}

// 2 · configure two products (reuse existing seed slugs)
async function cfg(slug: string, patch: ProductPatch) {
  const { data, error } = await admin
    .from('products')
    .update(patch)
    .eq('slug', slug)
    .select('slug, price, embed_enabled, issue_license_on_purchase, license_tier, seller_id')
    .maybeSingle();
  console.log(error ? `✗ ${slug}: ${error.message}` : `✓ ${slug}:`, error ? '' : data);
}

await cfg('free-tutorial', {
  seller_id: SELLER_ID, embed_enabled: true, issue_license_on_purchase: true,
  license_tier: 'basic', price: 0, is_active: true,
});
await cfg('premium-course', {
  seller_id: SELLER_ID, embed_enabled: true, issue_license_on_purchase: true,
  license_tier: 'premium', is_active: true,
});

// 3 · embed allowlist
const up = await admin
  .from('seller_embed_settings')
  .upsert({ seller_id: SELLER_ID, allowed_embed_origins: [ORIGIN] }, { onConflict: 'seller_id' })
  .select('seller_id, allowed_embed_origins')
  .maybeSingle();
console.log(up.error ? `✗ embed settings: ${up.error.message}` : '✓ embed allowlist:', up.error ? '' : up.data);

console.log('\nDone. Products: free-tutorial (basic) + premium-course (premium).');
process.exit(0);
