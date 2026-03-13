/**
 * ============================================================================
 * SECURITY TEST: Marketplace Tenant Isolation — Area 7
 * ============================================================================
 *
 * Verifies the security properties of the marketplace multi-tenancy layer:
 *
 *   1. isValidSellerSchema()    — rejects invalid/dangerous schema names
 *   2. extractSellerSlug()      — URL path extraction is injection-safe
 *   3. normalizeSchemaName()    — sanitization matches SQL provision logic
 *   4. createSellerAdminClient()— throws on invalid schema (schema injection guard)
 *   5. provision_seller_schema()— SQL function has slug injection hardening
 *   6. Tenant isolation         — schema names in migration use %I (identifier quoting)
 *   7. Reserved slug blocking   — system schemas are blocked at both TS and SQL layers
 *
 * Tests are purely static (no DB, no network).
 *
 * @see AREA 7 in priv/SECURITY-AUDIT-PROMPT.md
 * @see admin-panel/src/lib/marketplace/tenant.ts
 * @see admin-panel/src/lib/marketplace/seller-client.ts
 * @see supabase/migrations/20260311000001_marketplace_sellers.sql
 * ============================================================================
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

import {
  isValidSellerSchema,
  extractSellerSlug,
  normalizeSchemaName,
  isSellerRoute,
  extractSellerSubpath,
} from '../../../src/lib/marketplace/tenant';

const MIGRATION_PATH = join(
  __dirname,
  '../../../../supabase/migrations/20260311000001_marketplace_sellers.sql'
);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, 'utf-8');

const SELLER_CLIENT_PATH = join(
  __dirname,
  '../../../src/lib/marketplace/seller-client.ts'
);
const SELLER_CLIENT_SOURCE = readFileSync(SELLER_CLIENT_PATH, 'utf-8');

// ============================================================================
// 1. isValidSellerSchema — schema name whitelist
// ============================================================================

describe('Area 7: isValidSellerSchema()', () => {
  it('accepts valid seller schema names', () => {
    expect(isValidSellerSchema('seller_nick')).toBe(true);
    expect(isValidSellerSchema('seller_ab')).toBe(true);
    expect(isValidSellerSchema('seller_nick_greenawalt')).toBe(true);
    expect(isValidSellerSchema('seller_abc123')).toBe(true);
    expect(isValidSellerSchema('seller_a1_b2_c3')).toBe(true);
  });

  it('rejects names without seller_ prefix', () => {
    expect(isValidSellerSchema('public')).toBe(false);
    expect(isValidSellerSchema('nick')).toBe(false);
    expect(isValidSellerSchema('_nick')).toBe(false);
    expect(isValidSellerSchema('admin')).toBe(false);
    expect(isValidSellerSchema('seller')).toBe(false);
  });

  it('rejects seller_main (owner schema, not a marketplace tenant)', () => {
    expect(isValidSellerSchema('seller_main')).toBe(false);
  });

  it('rejects uppercase / mixed-case schema names', () => {
    expect(isValidSellerSchema('seller_Nick')).toBe(false);
    expect(isValidSellerSchema('SELLER_NICK')).toBe(false);
    expect(isValidSellerSchema('seller_Nick_Greenawalt')).toBe(false);
  });

  it('rejects names with dangerous characters (SQL injection surface)', () => {
    expect(isValidSellerSchema("seller_ni'ck")).toBe(false);
    expect(isValidSellerSchema('seller_ni"ck')).toBe(false);
    expect(isValidSellerSchema('seller_ni;ck')).toBe(false);
    expect(isValidSellerSchema('seller_ni--ck')).toBe(false);
    expect(isValidSellerSchema('seller_ni ck')).toBe(false);
    expect(isValidSellerSchema('seller_ni/ck')).toBe(false);
    expect(isValidSellerSchema('seller_ni\\ck')).toBe(false);
    expect(isValidSellerSchema('seller_ni\x00ck')).toBe(false);
  });

  it('rejects too-short sub-name (after seller_ prefix)', () => {
    expect(isValidSellerSchema('seller_a')).toBe(false);
    expect(isValidSellerSchema('seller_')).toBe(false);
  });

  it('rejects too-long schema names (> 58 chars total)', () => {
    // seller_ (7) + 51 chars = 58 chars — should fail (regex: {2,50})
    const tooLong = 'seller_' + 'a'.repeat(51);
    expect(isValidSellerSchema(tooLong)).toBe(false);
  });

  it('rejects empty / null-like inputs', () => {
    expect(isValidSellerSchema('')).toBe(false);
  });
});

// ============================================================================
// 2. extractSellerSlug — URL parsing safety
// ============================================================================

describe('Area 7: extractSellerSlug()', () => {
  it('extracts slug from /s/{slug}', () => {
    expect(extractSellerSlug('/s/nick')).toBe('nick');
    expect(extractSellerSlug('/s/my-shop')).toBe('my-shop');
    expect(extractSellerSlug('/s/my-shop/product-1')).toBe('my-shop');
  });

  it('extracts slug from /{locale}/s/{slug}', () => {
    expect(extractSellerSlug('/en/s/nick')).toBe('nick');
    expect(extractSellerSlug('/pl/s/my-shop')).toBe('my-shop');
    expect(extractSellerSlug('/en/s/nick/my-product')).toBe('nick');
  });

  it('returns null for non-seller routes', () => {
    expect(extractSellerSlug('/p/product')).toBeNull();
    expect(extractSellerSlug('/admin/products')).toBeNull();
    expect(extractSellerSlug('/api/access')).toBeNull();
    expect(extractSellerSlug('/')).toBeNull();
  });

  it('blocks reserved slugs', () => {
    expect(extractSellerSlug('/s/admin')).toBeNull();
    expect(extractSellerSlug('/s/api')).toBeNull();
    expect(extractSellerSlug('/s/auth')).toBeNull();
    expect(extractSellerSlug('/s/public')).toBeNull();
    expect(extractSellerSlug('/s/system')).toBeNull();
    expect(extractSellerSlug('/s/platform')).toBeNull();
  });

  it('rejects slugs with path traversal attempts', () => {
    expect(extractSellerSlug('/s/../admin')).toBeNull();
    expect(extractSellerSlug('/s/../../etc')).toBeNull();
    // These would be caught by the slug regex which only allows [a-z0-9][a-z0-9_-]
    expect(extractSellerSlug('/s/foo bar')).toBeNull();
    expect(extractSellerSlug('/s/FOO')).toBeNull();
  });
});

// ============================================================================
// 3. normalizeSchemaName — sanitization mirrors SQL logic
// ============================================================================

describe('Area 7: normalizeSchemaName()', () => {
  it('produces seller_<sanitized> names', () => {
    expect(normalizeSchemaName('nick')).toBe('seller_nick');
    expect(normalizeSchemaName('my-shop')).toBe('seller_my_shop');
    expect(normalizeSchemaName('Nick Greenawalt')).toBe('seller_nick_greenawalt');
  });

  it('collapses multiple non-alnum chars to single underscore', () => {
    expect(normalizeSchemaName('foo---bar')).toBe('seller_foo_bar');
    expect(normalizeSchemaName('foo  bar')).toBe('seller_foo_bar');
    expect(normalizeSchemaName('foo..bar')).toBe('seller_foo_bar');
  });

  it('strips leading/trailing underscores', () => {
    expect(normalizeSchemaName('-foo-')).toBe('seller_foo');
    expect(normalizeSchemaName('--foo--')).toBe('seller_foo');
  });

  it('returns null for slugs that produce too-short clean names', () => {
    expect(normalizeSchemaName('a')).toBeNull();
    expect(normalizeSchemaName('-')).toBeNull();
    expect(normalizeSchemaName('')).toBeNull();
  });

  it('returns null for reserved slugs', () => {
    expect(normalizeSchemaName('admin')).toBeNull();
    expect(normalizeSchemaName('public')).toBeNull();
  });

  it('produces output that passes isValidSellerSchema()', () => {
    const slugs = ['nick', 'my-shop', 'my.shop', 'great_store_2024'];
    for (const slug of slugs) {
      const schema = normalizeSchemaName(slug);
      if (schema !== null) {
        expect(isValidSellerSchema(schema)).toBe(true);
      }
    }
  });
});

// ============================================================================
// 4. createSellerAdminClient — validation before service_role connection
// ============================================================================

describe('Area 7: createSellerAdminClient() throws on invalid schema', () => {
  it('validates schema name before creating client (static source check)', () => {
    // The function MUST call isValidSellerSchema before creating a client.
    // We verify this by static source analysis — the guard must precede createSupabaseClient.
    const validationCallIdx = SELLER_CLIENT_SOURCE.indexOf('isValidSellerSchema(schemaName)');
    const clientCallIdx = SELLER_CLIENT_SOURCE.indexOf('createSupabaseClient(supabaseUrl');

    expect(validationCallIdx, 'isValidSellerSchema must be called in createSellerAdminClient').toBeGreaterThan(-1);
    expect(clientCallIdx, 'createSupabaseClient must be called in createSellerAdminClient').toBeGreaterThan(-1);
    expect(
      validationCallIdx,
      'isValidSellerSchema must be called BEFORE createSupabaseClient to guard service_role creation'
    ).toBeLessThan(clientCallIdx);
  });

  it('throws (via new Error) on every invalid schema — confirmed by source guard pattern', () => {
    // The static check above confirms validation precedes client creation.
    // Here we verify the throw message is descriptive enough to catch in logs.
    const throwPattern = /throw new Error\(`Invalid seller schema name/;
    expect(
      SELLER_CLIENT_SOURCE,
      'createSellerAdminClient must throw with descriptive message on invalid schema'
    ).toMatch(throwPattern);

    // Also confirm the guard covers seller_main explicitly (most dangerous bypass)
    expect(SELLER_CLIENT_SOURCE).toMatch(/seller_main/);
  });
});

// ============================================================================
// 5. SQL provision_seller_schema — injection hardening in migration
// ============================================================================

describe('Area 7: provision_seller_schema SQL injection hardening', () => {
  it('uses %I (identifier quoting) for all EXECUTE format statements', () => {
    // Extract the provision_seller_schema function body
    const fnStart = MIGRATION_SQL.indexOf('CREATE OR REPLACE FUNCTION public.provision_seller_schema');
    const fnEnd = MIGRATION_SQL.indexOf('$$;', fnStart) + 3;
    const fnBody = MIGRATION_SQL.slice(fnStart, fnEnd);

    // Every EXECUTE format() that uses the schema name variable must use %I
    // not %s (which would allow injection)
    const executeStatements = fnBody.match(/EXECUTE\s+format\([^;]+\)/g) || [];

    expect(executeStatements.length, 'provision_seller_schema should have EXECUTE format() statements').toBeGreaterThan(0);

    for (const stmt of executeStatements) {
      expect(stmt, `EXECUTE format() must use %I not %s:\n${stmt}`).not.toMatch(/%s/);
      expect(stmt, `EXECUTE format() should use %I for schema names:\n${stmt}`).toMatch(/%I/);
    }
  });

  it('sanitizes slug with regexp_replace before building schema name', () => {
    // The function must sanitize before using the slug in a schema name
    const fnStart = MIGRATION_SQL.indexOf('CREATE OR REPLACE FUNCTION public.provision_seller_schema');
    const fnEnd = MIGRATION_SQL.indexOf('$$;', fnStart) + 3;
    const fnBody = MIGRATION_SQL.slice(fnStart, fnEnd);

    expect(fnBody).toMatch(/regexp_replace.*[^a-z0-9]/);
    // Schema name must be built from the sanitized variable, not the raw input
    expect(fnBody).toMatch(/v_schema_name\s*:=\s*'seller_'\s*\|\|/);
    expect(fnBody).not.toMatch(/p_slug\s*\|\|/); // raw slug must not be concatenated
  });

  it('checks for reserved slugs before provisioning', () => {
    const fnStart = MIGRATION_SQL.indexOf('CREATE OR REPLACE FUNCTION public.provision_seller_schema');
    const fnEnd = MIGRATION_SQL.indexOf('$$;', fnStart) + 3;
    const fnBody = MIGRATION_SQL.slice(fnStart, fnEnd);

    // Must have a reserved slug check before executing CREATE SCHEMA
    const reservedCheckIdx = fnBody.indexOf('reserved');
    const schemaCreateIdx = fnBody.indexOf('clone_schema');
    expect(reservedCheckIdx).toBeGreaterThan(-1);
    expect(schemaCreateIdx).toBeGreaterThan(-1);
    expect(reservedCheckIdx).toBeLessThan(schemaCreateIdx);
  });

  it('function is restricted to service_role only (not public/anon/authenticated)', () => {
    expect(MIGRATION_SQL).toMatch(/REVOKE ALL ON FUNCTION public\.provision_seller_schema FROM PUBLIC/);
    expect(MIGRATION_SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.provision_seller_schema TO service_role/);
    // Must not grant to anon or authenticated
    expect(MIGRATION_SQL).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.provision_seller_schema TO (anon|authenticated)/
    );
  });
});

// ============================================================================
// 6. isSellerRoute + extractSellerSubpath — routing safety
// ============================================================================

describe('Area 7: seller route resolution', () => {
  it('isSellerRoute identifies seller paths correctly', () => {
    expect(isSellerRoute('/s/nick')).toBe(true);
    expect(isSellerRoute('/en/s/nick')).toBe(true);
    expect(isSellerRoute('/pl/s/nick/product')).toBe(true);

    expect(isSellerRoute('/p/product')).toBe(false);
    expect(isSellerRoute('/admin/products')).toBe(false);
    expect(isSellerRoute('/s')).toBe(false);
  });

  it('extractSellerSubpath strips slug and locale prefix', () => {
    expect(extractSellerSubpath('/s/nick/my-product')).toBe('my-product');
    expect(extractSellerSubpath('/en/s/nick/my-product')).toBe('my-product');
    expect(extractSellerSubpath('/s/nick')).toBe('');
    expect(extractSellerSubpath('/s/nick/checkout')).toBe('checkout');
  });
});
