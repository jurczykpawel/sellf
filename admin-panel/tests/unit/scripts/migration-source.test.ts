/** Release SQL consumers read their own source section after migration consolidation. */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readMigrationSource } from '../../../scripts/migration-source';

describe('release migration sources', () => {
  it('ships eight ordered release files with each of the 76 original sections exactly once', () => {
    const directory = new URL('../../../../supabase/migrations/', import.meta.url);
    const files = readdirSync(directory).filter(file => file.endsWith('.sql') && file >= '20261016000000').sort();
    expect(files).toHaveLength(8);
    expect(files.every(file => /^2026111023590[0-7]_release_2026_11_0_[a-z_]+\.sql$/.test(file))).toBe(true);
    expect(new Set(files.map(file => file.split('_')[0])).size).toBe(8);
    const sources = files.flatMap(file => [...readFileSync(new URL(file, directory), 'utf8').matchAll(/^-- ===== Source: (.+) =====$/gm)].map(match => match[1]));
    expect(sources).toHaveLength(76);
    expect(new Set(sources).size).toBe(76);
  });
  it('isolates the content repair from other fulfillment changes', () => {
    const sql = readMigrationSource('20261108170000_product_content_url_cleanup.sql');
    expect(sql).toContain('WITH repaired AS');
    expect(sql).not.toContain('CREATE TABLE public.payment_disputes');
    expect(sql).not.toContain('-- ===== Source:');
  });
  it('keeps the successive storefront schema snapshots distinct', () => {
    const a = readMigrationSource('20261016223736_storefront_a_contract.sql');
    const c = readMigrationSource('20261017030527_storefront_c_contract.sql');
    expect([...a.matchAll(/AS \$schema\$ SELECT/g)]).toHaveLength(1);
    expect([...c.matchAll(/AS \$schema\$ SELECT/g)]).toHaveLength(1);
    expect(a).not.toEqual(c);
  });
  it('reports a missing source instead of returning an entire release file', () => {
    expect(() => readMigrationSource('20261111000000_absent.sql')).toThrow('Migration source not found');
  });
});
