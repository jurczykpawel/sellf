/**
 * DB TEST: indexes backing the admin list/search endpoints.
 *
 * The payments, coupons and products admin list endpoints filter and search
 * on the server (customer_email/session_id/stripe_payment_intent_id ILIKE,
 * status + date_from, coupon type/expiry, name/description ILIKE). Without a
 * matching index those queries fall back to a full table scan once the
 * table grows past a handful of rows. This locks in that the indexes exist.
 *
 * REQUIRES: `npx supabase start` + `npx supabase db reset`.
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { execSync } from 'child_process';
import { describe, it, expect } from 'vitest';

const CONTAINER = 'supabase_db_sellf';

function queryRows(sql: string): string[] {
  const out = execSync(`docker exec -i ${CONTAINER} psql -U postgres -t -A`, {
    input: sql,
    encoding: 'utf-8',
    timeout: 10000,
  });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function indexExists(table: string, index: string): boolean {
  const rows = queryRows(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = '${table}' AND indexname = '${index}';
  `);
  return rows.includes(index);
}

describe('pg_trgm extension is installed', () => {
  it('pg_trgm exists (installer may put it in `extensions` or another schema, e.g. `public`)', () => {
    const rows = queryRows(`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
    `);
    expect(rows).toEqual(['pg_trgm']);
  });
});

describe('payment_transactions: indexes for GET /api/v1/payments filters', () => {
  it('has trigram indexes for the leading-wildcard search fields', () => {
    expect(indexExists('payment_transactions', 'idx_payment_transactions_customer_email_trgm')).toBe(true);
    expect(indexExists('payment_transactions', 'idx_payment_transactions_session_id_trgm')).toBe(true);
    expect(indexExists('payment_transactions', 'idx_payment_transactions_stripe_payment_intent_id_trgm')).toBe(true);
  });

  it('has a (status, created_at) index covering the statuses the other partial indexes leave out', () => {
    expect(indexExists('payment_transactions', 'idx_payment_transactions_status_created_uncovered')).toBe(true);

    const rows = queryRows(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'payment_transactions'
        AND indexname = 'idx_payment_transactions_status_created_uncovered';
    `);
    expect(rows[0]).toContain("'completed'");
    expect(rows[0]).toContain("'partially_refunded'");
  });
});

describe('coupons: indexes for GET /api/v1/coupons default order, filters and search', () => {
  it('has a (created_at, id) index for the default list order', () => {
    expect(indexExists('coupons', 'idx_coupons_created_at')).toBe(true);
  });

  it('has a partial index for is_oto_coupon = false (the existing one only covers = true)', () => {
    expect(indexExists('coupons', 'idx_coupons_not_oto')).toBe(true);
  });

  it('has a partial index for expires_at across all coupons, not only OTO ones', () => {
    expect(indexExists('coupons', 'idx_coupons_expires_at')).toBe(true);
  });

  it('has trigram indexes for code/name search', () => {
    expect(indexExists('coupons', 'idx_coupons_code_trgm')).toBe(true);
    expect(indexExists('coupons', 'idx_coupons_name_trgm')).toBe(true);
  });
});

describe('products: indexes for GET /api/v1/products search', () => {
  it('has trigram indexes for name/description search', () => {
    expect(indexExists('products', 'idx_products_name_trgm')).toBe(true);
    expect(indexExists('products', 'idx_products_description_trgm')).toBe(true);
  });
});

describe('refund_requests: index for GET /api/v1/refund-requests product_id filter', () => {
  it('has a product_id index', () => {
    expect(indexExists('refund_requests', 'idx_refund_requests_product_id')).toBe(true);
  });
});
