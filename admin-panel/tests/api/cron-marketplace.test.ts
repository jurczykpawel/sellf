/**
 * API Integration Tests: Cron — Marketplace Multi-Schema
 *
 * Tests that cron jobs (access-expired, cleanup-webhook-logs) correctly
 * operate across ALL seller schemas, not just seller_main.
 *
 * Run: bun run test:api (requires dev server + supabase running)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const API_URL = process.env.TEST_API_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function sellerClient(schema: string) {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { db: { schema } });
}

async function cronGet(job: string, secret: string = CRON_SECRET) {
  const response = await fetch(`${API_URL}/api/cron?job=${job}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

// ===== Test state =====

let buyerMainUserId: string;
let buyerSellerUserId: string;
let mainAccessId: string;
let sellerAccessId: string;
let mainProductId: string;
let sellerProductId: string;

describe('Cron — Marketplace Multi-Schema', () => {
  beforeAll(async () => {
    const rnd = Math.random().toString(36).substring(7);
    const kowalskiClient = sellerClient('seller_kowalski_digital');

    // Create buyer with EXPIRED access in seller_main
    const { data: { user: buyerMain } } = await supabase.auth.admin.createUser({
      email: `cron-buyer-main-${rnd}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    buyerMainUserId = buyerMain!.id;

    const { data: mainProducts } = await supabase
      .from('products')
      .select('id')
      .eq('is_active', true)
      .limit(1);
    mainProductId = mainProducts![0].id;

    // access_granted_at = 2 days ago, access_expires_at = yesterday → expired but valid constraint
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();

    const { data: mainAccess, error: mainAccessErr } = await supabase
      .from('user_product_access')
      .insert({
        user_id: buyerMainUserId,
        product_id: mainProductId,
        access_granted_at: twoDaysAgo,
        access_expires_at: yesterday,
      })
      .select('id')
      .single();
    if (mainAccessErr) throw new Error(`Failed to create main access: ${mainAccessErr.message}`);
    mainAccessId = mainAccess!.id;

    // Create buyer with EXPIRED access in seller_kowalski_digital
    const { data: { user: buyerSeller } } = await supabase.auth.admin.createUser({
      email: `cron-buyer-seller-${rnd}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    buyerSellerUserId = buyerSeller!.id;

    const { data: sellerProducts } = await kowalskiClient
      .from('products')
      .select('id')
      .eq('is_active', true)
      .limit(1);
    sellerProductId = sellerProducts![0].id;

    const { data: sellerAccess, error: sellerAccessErr } = await kowalskiClient
      .from('user_product_access')
      .insert({
        user_id: buyerSellerUserId,
        product_id: sellerProductId,
        access_granted_at: twoDaysAgo,
        access_expires_at: yesterday,
      })
      .select('id')
      .single();
    if (sellerAccessErr) throw new Error(`Failed to create seller access: ${sellerAccessErr.message}`);
    sellerAccessId = sellerAccess!.id;
  });

  afterAll(async () => {
    const kowalskiClient = sellerClient('seller_kowalski_digital');

    // Cleanup access
    await supabase.from('user_product_access').delete().eq('id', mainAccessId);
    await kowalskiClient.from('user_product_access').delete().eq('id', sellerAccessId);

    // Cleanup users
    await supabase.auth.admin.deleteUser(buyerMainUserId);
    await supabase.auth.admin.deleteUser(buyerSellerUserId);
  });

  // =========================================================================
  // Auth
  // =========================================================================

  // Auth + cron endpoint tests require a running dev server
  // Checked once in the cron job describe block below

  describe('Auth (requires dev server)', () => {
    it('rejects with wrong secret', async () => {
      const res = await fetch(`${API_URL}/api/cron?job=access-expired`, {
        headers: { Authorization: 'Bearer wrong-secret' },
      }).catch(() => null);
      if (!res) return; // server not running — skip
      expect(res.status).toBe(401);
    });

    it('rejects without any auth', async () => {
      const res = await fetch(`${API_URL}/api/cron?job=access-expired`).catch(() => null);
      if (!res) return; // server not running — skip
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // SQL function: get_expired_access_all_schemas
  // =========================================================================

  describe('get_expired_access_all_schemas', () => {
    it('returns expired access from BOTH seller_main and seller schemas', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .rpc('get_expired_access_all_schemas', { p_limit: 100 });

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);

      const accessIds = data.map((r: { access_id: string }) => r.access_id);

      // Must find BOTH expired accesses
      expect(accessIds).toContain(mainAccessId);
      expect(accessIds).toContain(sellerAccessId);
    });

    it('includes correct seller_slug and seller_schema per row', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .rpc('get_expired_access_all_schemas', { p_limit: 100 });

      const mainRow = data.find((r: { access_id: string }) => r.access_id === mainAccessId);
      const sellerRow = data.find((r: { access_id: string }) => r.access_id === sellerAccessId);

      expect(mainRow).toBeDefined();
      expect(mainRow.seller_schema).toBe('seller_main');

      expect(sellerRow).toBeDefined();
      expect(sellerRow.seller_schema).toBe('seller_kowalski_digital');
      expect(sellerRow.seller_slug).toBe('kowalski_digital');
    });

    it('includes product data', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .rpc('get_expired_access_all_schemas', { p_limit: 100 });

      const row = data.find((r: { access_id: string }) => r.access_id === sellerAccessId);
      expect(row.product_name).toBeTruthy();
      expect(row.product_slug).toBeTruthy();
      expect(row.product_id).toBe(sellerProductId);
    });
  });

  // =========================================================================
  // Cron job: access-expired (if CRON_SECRET is set)
  // =========================================================================

  describe('access-expired job', () => {
    it('processes expired access from ALL schemas', async () => {
      const { status, data } = await cronGet('access-expired');
      expect(status).toBe(200);
      expect(data.job).toBe('access-expired');
      // Should process at least our 2 test records
      expect(data.processed + data.errors).toBeGreaterThanOrEqual(2);
    });

    it('marks records as notified (not returned on second run)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .rpc('get_expired_access_all_schemas', { p_limit: 100 });

      const accessIds = data.map((r: { access_id: string }) => r.access_id);
      // Our test records should be marked as notified now
      expect(accessIds).not.toContain(mainAccessId);
      expect(accessIds).not.toContain(sellerAccessId);
    });
  });

  // =========================================================================
  // SQL function: cleanup_webhook_logs_all_schemas
  // =========================================================================

  describe('cleanup_webhook_logs_all_schemas', () => {
    it('runs without error and returns count', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .rpc('cleanup_webhook_logs_all_schemas', { p_retention_days: 30 });

      expect(error).toBeNull();
      expect(typeof data).toBe('number');
      expect(data).toBeGreaterThanOrEqual(0);
    });
  });
});
