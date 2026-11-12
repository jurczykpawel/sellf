/** Release SQL consumers read their own source section after migration consolidation. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readMigrationSource, writeMigrationSource } from '../../../scripts/migration-source';

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
  it('keeps each SQL file and its actual legacy jq payload under the argument limits', () => {
    const directory = new URL('../../../../supabase/migrations/', import.meta.url);
    for (const file of readdirSync(directory).filter(file => /^2026111023590[0-7]_/.test(file))) {
      const sql = readFileSync(new URL(file, directory), 'utf8');
      expect(Buffer.byteLength(sql), file).toBeLessThanOrEqual(120000);
      const payload = execFileSync('jq', ['-n', '--arg', 'v', file.slice(0, -4), '--arg', 's', sql.replace(/\n+$/, ''), '--arg', 'c', '0'.repeat(64),
        '{migration_version: $v, migration_sql: $s, content_checksum: $c}']);
      expect(payload.length, file).toBeLessThanOrEqual(128000);
    }
  });
  it('reads a continued section and updates a generated statement without moving file boundaries', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sellf-sources-'));
    const directory = pathToFileURL(`${dir}/`);
    const a = path.join(dir, '20261110235900_fixture.sql');
    const b = path.join(dir, '20261110235901_fixture.sql');
    const first = '-- ===== Source: example.sql =====\nSELECT 1;';
    const second = '\nSELECT 2;\n-- ===== Source: next.sql =====\nSELECT 3;';
    try {
      writeFileSync(a, first);
      writeFileSync(b, second);
      expect(readMigrationSource('example.sql', directory)).toBe('SELECT 1;\nSELECT 2;');
      writeMigrationSource('example.sql', 'SELECT 1;\nSELECT 22;', directory);
      expect(readFileSync(a, 'utf8')).toBe(first);
      expect(readFileSync(b, 'utf8')).toBe(second.replace('SELECT 2;', 'SELECT 22;'));
      expect(() => writeMigrationSource('example.sql', 'SELECT 11;\nSELECT 222;', directory)).toThrow('crosses migration boundaries');
      expect(readMigrationSource('next.sql', directory)).toBe('SELECT 3;');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
