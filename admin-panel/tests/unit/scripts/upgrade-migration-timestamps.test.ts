/**
 * Keeps migration timestamps unique for upgrade.sh's applied-status matching.
 * @see admin-panel/scripts/upgrade.sh
 */
import { readdirSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../supabase/migrations');

describe('upgrade migration timestamps', () => {
  it('gives every SQL migration a unique timestamp prefix', () => {
    const filesByTimestamp = new Map<string, string[]>();
    for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
      const timestamp = entry.name.split('_')[0];
      const files = filesByTimestamp.get(timestamp) ?? [];
      files.push(entry.name);
      filesByTimestamp.set(timestamp, files);
    }

    const duplicates = [...filesByTimestamp.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([timestamp, files]) => ({ timestamp, files: files.sort() }));
    expect(duplicates).toEqual([]);
  });
});
