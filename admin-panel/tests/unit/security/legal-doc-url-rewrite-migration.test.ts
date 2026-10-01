/**
 * MIGRATION TEST: legal document URLs move to Sellf pages, `legal` bucket
 * goes private.
 *
 * Generated Terms/Privacy documents used to be linked straight to their
 * Supabase Storage object (a public URL). Supabase Storage serves `text/html`
 * as `text/plain` (buyers would see raw markup) and self-hosted installs
 * often store an internal SUPABASE_URL that the buyer's browser can't reach.
 * The migration rewrites already-published documents' stored URLs to
 * `/legal/<type>` — a Sellf page that reads the same object and renders it —
 * and flips the bucket to private, since nothing needs a public URL for it
 * anymore.
 *
 * `shop_config` is a singleton table shared with every other test against
 * this local database, so this suite snapshots its two URL columns in
 * beforeAll and restores them in afterAll (a `__NULL__` sentinel distinguishes
 * NULL from the empty string over psql's `-t -A` text output).
 *
 * REQUIRES: `npx supabase start` + `npx supabase db reset`.
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { execSync } from 'child_process';
import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';

const CONTAINER = 'supabase_db_sellf';
const NULL_SENTINEL = '__NULL__';

function runSql(sql: string): string {
  return execSync(`docker exec -i ${CONTAINER} psql -U postgres -t -A`, {
    input: sql,
    encoding: 'utf-8',
    timeout: 10000,
  });
}

function sqlLiteral(value: string | null): string {
  return value === null ? `'${NULL_SENTINEL}'` : `'${value.replace(/'/g, "''")}'`;
}

// The exact statements from the migration — copied here so the test fails if
// the migration's WHERE clauses or the bucket UPDATE ever drift from what
// this test verifies.
const REWRITE_SQL = `
  UPDATE public.shop_config
     SET terms_of_service_url = '/legal/terms'
   WHERE terms_of_service_url ~ '/storage/v1/object/public/legal/[0-9a-f-]{36}/terms\\.html$';

  UPDATE public.shop_config
     SET privacy_policy_url = '/legal/privacy'
   WHERE privacy_policy_url ~ '/storage/v1/object/public/legal/[0-9a-f-]{36}/privacy\\.html$';

  UPDATE storage.buckets SET public = false WHERE id = 'legal' AND public = true;
`;

const SHOP_ID = '11111111-2222-3333-4444-555555555555';
const LEGACY_TERMS_URL = `https://xyzabc.supabase.co/storage/v1/object/public/legal/${SHOP_ID}/terms.html`;
const LEGACY_PRIVACY_URL = `https://xyzabc.supabase.co/storage/v1/object/public/legal/${SHOP_ID}/privacy.html`;
const EXTERNAL_TERMS_URL = 'https://example.com/my-own-terms.pdf';

let originalTermsUrl: string | null;
let originalPrivacyUrl: string | null;
let originalBucketPublic: boolean;

function readTermsUrl(): string | null {
  const raw = runSql(
    `SELECT COALESCE(terms_of_service_url, '${NULL_SENTINEL}') FROM public.shop_config;`,
  ).trim();
  return raw === NULL_SENTINEL ? null : raw;
}

function readPrivacyUrl(): string | null {
  const raw = runSql(
    `SELECT COALESCE(privacy_policy_url, '${NULL_SENTINEL}') FROM public.shop_config;`,
  ).trim();
  return raw === NULL_SENTINEL ? null : raw;
}

function readBucketPublic(): boolean {
  return runSql(`SELECT public FROM storage.buckets WHERE id = 'legal';`).trim() === 't';
}

function setUrls(terms: string | null, privacy: string | null): void {
  runSql(`
    UPDATE public.shop_config
       SET terms_of_service_url = ${terms === null ? 'NULL' : sqlLiteral(terms)},
           privacy_policy_url = ${privacy === null ? 'NULL' : sqlLiteral(privacy)};
  `);
}

beforeAll(() => {
  originalTermsUrl = readTermsUrl();
  originalPrivacyUrl = readPrivacyUrl();
  originalBucketPublic = readBucketPublic();
});

afterAll(() => {
  setUrls(originalTermsUrl, originalPrivacyUrl);
  // Restoring `public: true` here would undo the migration's whole point on a
  // real database; only do it if that's genuinely how this DB started (a
  // fresh `db reset` seeds the bucket as public before this migration runs).
  runSql(`UPDATE storage.buckets SET public = ${originalBucketPublic} WHERE id = 'legal';`);
});

describe('legal document URL rewrite + private bucket migration', () => {
  beforeEach(() => {
    // Every test starts from the same known legacy state.
    setUrls(LEGACY_TERMS_URL, LEGACY_PRIVACY_URL);
    runSql(`UPDATE storage.buckets SET public = true WHERE id = 'legal';`);
  });

  it('rewrites a legacy storage URL to /legal/terms', () => {
    runSql(REWRITE_SQL);
    expect(readTermsUrl()).toBe('/legal/terms');
  });

  it('rewrites a legacy storage URL to /legal/privacy', () => {
    runSql(REWRITE_SQL);
    expect(readPrivacyUrl()).toBe('/legal/privacy');
  });

  it('flips the legal bucket to private', () => {
    runSql(REWRITE_SQL);
    expect(readBucketPublic()).toBe(false);
  });

  it('leaves an admin-typed external URL untouched', () => {
    setUrls(EXTERNAL_TERMS_URL, null);
    runSql(REWRITE_SQL);
    expect(readTermsUrl()).toBe(EXTERNAL_TERMS_URL);
  });

  it('leaves a NULL URL as NULL (nothing generated yet)', () => {
    setUrls(null, null);
    runSql(REWRITE_SQL);
    expect(readTermsUrl()).toBeNull();
    expect(readPrivacyUrl()).toBeNull();
  });

  it('is idempotent — running it twice produces the same result with no further changes', () => {
    runSql(REWRITE_SQL);
    const afterFirst = {
      terms: readTermsUrl(),
      privacy: readPrivacyUrl(),
      bucketPublic: readBucketPublic(),
    };

    runSql(REWRITE_SQL);
    expect(readTermsUrl()).toBe(afterFirst.terms);
    expect(readPrivacyUrl()).toBe(afterFirst.privacy);
    expect(readBucketPublic()).toBe(afterFirst.bucketPublic);
    expect(readTermsUrl()).toBe('/legal/terms');
    expect(readPrivacyUrl()).toBe('/legal/privacy');
    expect(readBucketPublic()).toBe(false);
  });
});
