/** Read original SQL sections across statement-aligned release file boundaries.
 * @see scripts/generate-storefront-schema.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);

export interface MigrationSource {
  content: string;
  start: number;
  end: number;
  files: MigrationSourceFile[];
}

interface MigrationSourceFile {
  path: string;
  start: number;
  end: number;
}

export function findMigrationSource(name: string, directory: URL = MIGRATIONS): MigrationSource {
  const marker = `-- ===== Source: ${name} =====\n`;
  let content = '';
  const files = readdirSync(directory).filter(file => /^2026111023590[0-7]_.*\.sql$/.test(file)).sort().map(file => {
    const path = fileURLToPath(new URL(file, directory));
    const start = content.length;
    content += readFileSync(path, 'utf8');
    return { path, start, end: content.length };
  });
  const index = content.indexOf(marker);
  if (index >= 0) {
    const start = index + marker.length;
    const next = content.indexOf('\n-- ===== Source:', start);
    return { content, start, end: next < 0 ? content.length : next, files };
  }
  throw new Error(`Migration source not found: ${name}`);
}

export function readMigrationSource(name: string, directory: URL = MIGRATIONS): string {
  const { content, start, end } = findMigrationSource(name, directory);
  return content.slice(start, end);
}

export function writeMigrationSource(name: string, sql: string, directory: URL = MIGRATIONS): void {
  const { files, content, start, end } = findMigrationSource(name, directory);
  const previous = content.slice(start, end);
  if (previous === sql) return;
  // Generated blocks are whole SQL statements in one file. Keep every other
  // byte and boundary intact, including a section's continuation in the next file.
  let prefix = 0;
  while (prefix < previous.length && prefix < sql.length && previous[prefix] === sql[prefix]) prefix++;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < sql.length - prefix && previous[previous.length - suffix - 1] === sql[sql.length - suffix - 1]) suffix++;
  const from = start + prefix;
  const to = end - suffix;
  const file = files.find(file => from >= file.start && to <= file.end);
  if (!file) throw new Error(`Schema update crosses migration boundaries: ${name}; repack at statement boundaries first`);
  writeFileSync(file.path, content.slice(file.start, from) + sql.slice(prefix, sql.length - suffix) + content.slice(to, file.end));
}
