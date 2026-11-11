/** Read or update an original SQL section inside the consolidated release migrations. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);

export interface MigrationSource {
  path: string;
  content: string;
  start: number;
  end: number;
}

export function findMigrationSource(name: string): MigrationSource {
  const marker = `-- ===== Source: ${name} =====\n`;
  for (const file of readdirSync(MIGRATIONS).filter(file => /^2026111023590[0-7]_.*\.sql$/.test(file)).sort()) {
    const path = fileURLToPath(new URL(file, MIGRATIONS));
    const content = readFileSync(path, 'utf8');
    const index = content.indexOf(marker);
    if (index < 0) continue;
    const start = index + marker.length;
    const next = content.indexOf('\n-- ===== Source:', start);
    return { path, content, start, end: next < 0 ? content.length : next };
  }
  throw new Error(`Migration source not found: ${name}`);
}

export function readMigrationSource(name: string): string {
  const { content, start, end } = findMigrationSource(name);
  return content.slice(start, end);
}

export function writeMigrationSource(name: string, sql: string): void {
  const { path, content, start, end } = findMigrationSource(name);
  writeFileSync(path, content.slice(0, start) + sql + content.slice(end));
}
