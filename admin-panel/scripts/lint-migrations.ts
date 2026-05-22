#!/usr/bin/env bun
/**
 * Migration lint: every CREATE FUNCTION targeting seller_main or public
 * must have a matching REVOKE EXECUTE … FROM PUBLIC, anon, authenticated
 * in the same migration file. Catches the class of issue where a fresh
 * DROP + CREATE OR REPLACE silently restores default PUBLIC EXECUTE.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMAS = new Set(['seller_main', 'public']);
const CREATE_FUNCTION_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(\w+)\.)?(\w+)\s*\(/gi;
const DROP_FUNCTION_RE =
  /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:(\w+)\.)?(\w+)/gi;
const REVOKE_RE =
  /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+(?:(\w+)\.)?(\w+)/gi;

// 20260302000000_restrict_rpc_function_access.sql installs the catch-all
// REVOKE on public + seller_main and ALTER DEFAULT PRIVILEGES so any later
// migration's CREATE FUNCTION inherits the deny. Migrations dated at or
// before that timestamp are covered by the catch-all and do not need an
// inline REVOKE block.
const ENFORCE_FROM_TIMESTAMP = '20260302000001';

const ALLOW_LIST = new Set<string>([
  // Functions intentionally exposed to PUBLIC at the table-level. Empty for
  // now — extend only with code review.
]);

// Pre-existing migrations that DROP + CREATE OR REPLACE without an inline
// REVOKE. Tracked here so the lint surfaces them for backfill but does not
// fail CI for code that pre-dates the rule. New migrations MUST include
// matching REVOKE — do not extend this set.
const KNOWN_DROP_RECREATE_MIGRATIONS = new Set<string>([
  '20260306170242_add_rate_limit_to_grant_free_access.sql',
  '20260306180000_variant_group_pwyw_icon_fields.sql',
  '20260306190000_variant_groups_is_active.sql',
  '20260310175058_multi_order_bumps.sql',
  '20260310180000_proxy_functions.sql',
  '20260315222348_guest_purchase_advisory_lock.sql',
  '20260318120000_remove_custom_scripts_from_public_config.sql',
  '20260416120000_fix_existing_user_guest_checkout.sql',
  '20260508165000_fix_pwyw_line_item_amount.sql',
  '20260515110000_funnel_downsell_and_attribution.sql',
]);

export interface LintMissing {
  qualified: string;
  schema: string;
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');
}

function stripDollarQuotedBlocks(sql: string): string {
  const tagRe = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;
  let out = '';
  let i = 0;
  while (i < sql.length) {
    tagRe.lastIndex = i;
    const open = tagRe.exec(sql);
    if (!open) {
      out += sql.slice(i);
      break;
    }
    out += sql.slice(i, open.index);
    const tag = open[0];
    const closeIdx = sql.indexOf(tag, open.index + tag.length);
    if (closeIdx === -1) {
      // Unclosed quote — keep the rest verbatim so the file at least parses
      // through the lint pipeline.
      out += sql.slice(open.index);
      break;
    }
    i = closeIdx + tag.length;
  }
  return out;
}

const TOP_LEVEL_TXN_RE = /^\s*(BEGIN|COMMIT|ROLLBACK|END)\s*;\s*$/gim;

export function lintSqlForTopLevelTransaction(sql: string): string[] {
  const stripped = stripDollarQuotedBlocks(stripSqlComments(sql));
  const offenders: string[] = [];
  for (const m of stripped.matchAll(TOP_LEVEL_TXN_RE)) {
    offenders.push(m[1].toUpperCase());
  }
  return offenders;
}

const UNQUALIFIED_CREATE_RE =
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|TABLE|VIEW|MATERIALIZED\s+VIEW|INDEX|TYPE|SEQUENCE|TRIGGER|POLICY)\s+(?!IF\s+NOT\s+EXISTS\s+)(?!IF\s+EXISTS\s+)([^\s(]+)/gi;

export function lintSqlForUnqualifiedCreate(sql: string): string[] {
  const stripped = stripDollarQuotedBlocks(stripSqlComments(sql));
  const offenders: string[] = [];
  for (const m of stripped.matchAll(UNQUALIFIED_CREATE_RE)) {
    const kind = m[1].toUpperCase();
    const target = m[2];
    // POLICY targets follow `ON <schema>.<table>`, not <schema>.<policy>.
    // Skip — the policy itself is namespaced by the parent table.
    if (kind === 'POLICY') continue;
    // INDEX / TRIGGER / TYPE often use unqualified names and rely on the
    // parent table's schema or default search_path. Lint only the CREATE
    // forms that take a schema-qualified target.
    if (kind === 'INDEX' || kind === 'TRIGGER') continue;
    if (target.includes('.')) continue;
    offenders.push(`${kind} ${target}`);
  }
  return offenders;
}

export function lintSqlForMissingRevoke(_file: string, sql: string): LintMissing[] {
  // CREATE OR REPLACE FUNCTION without a prior DROP preserves existing grants
  // (which the catch-all in 20260302 set to REVOKE'd). Only the DROP+CREATE
  // pattern resets grants and therefore needs an inline REVOKE.
  const dropped = new Set<string>();
  for (const m of sql.matchAll(DROP_FUNCTION_RE)) {
    const schema = (m[1] ?? 'public').toLowerCase();
    if (!SCHEMAS.has(schema)) continue;
    const name = m[2];
    if (!name) continue;
    dropped.add(`${schema}.${name}`);
  }

  const created = new Map<string, string>();
  for (const m of sql.matchAll(CREATE_FUNCTION_RE)) {
    const schema = (m[1] ?? 'public').toLowerCase();
    if (!SCHEMAS.has(schema)) continue;
    const name = m[2];
    if (!name) continue;
    if (!dropped.has(`${schema}.${name}`)) continue;
    created.set(`${schema}.${name}`, schema);
  }

  const revoked = new Set<string>();
  for (const m of sql.matchAll(REVOKE_RE)) {
    const schema = (m[1] ?? 'public').toLowerCase();
    const name = m[2];
    revoked.add(`${schema}.${name}`);
  }

  const missing: LintMissing[] = [];
  for (const [qualified, schema] of created) {
    if (revoked.has(qualified)) continue;
    if (ALLOW_LIST.has(qualified)) continue;
    missing.push({ qualified, schema });
  }
  return missing;
}

function migrationTimestamp(filename: string): string | null {
  const match = filename.match(/^(\d{14})_/);
  return match ? match[1] : null;
}

// Legacy migrations applied via Management API before apply_migration RPC was the upgrade path.
const KNOWN_RPC_INCOMPAT_MIGRATIONS = new Set<string>([
  '20260318100000_fix_digest_schema_qualification.sql',
  '20260319000000_is_admin_service_role_bypass.sql',
]);

function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = resolve(scriptDir, '../../supabase/migrations');
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  let failures = 0;
  let skipped = 0;
  let knownDebt = 0;
  for (const file of files) {
    const ts = migrationTimestamp(file);
    if (!ts || ts < ENFORCE_FROM_TIMESTAMP) {
      skipped++;
      continue;
    }
    const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
    const missing = lintSqlForMissingRevoke(file, sql);
    if (missing.length > 0) {
      const list = missing.map((m) => m.qualified).join(', ');
      if (KNOWN_DROP_RECREATE_MIGRATIONS.has(file)) {
        knownDebt++;
        console.warn(`⚠ ${file}: missing REVOKE EXECUTE for ${list} (known debt)`);
      } else {
        failures++;
        console.error(`✖ ${file}: missing REVOKE EXECUTE for ${list}`);
      }
    }

    const txnOffenders = lintSqlForTopLevelTransaction(sql);
    if (txnOffenders.length > 0) {
      const list = [...new Set(txnOffenders)].join(', ');
      if (KNOWN_RPC_INCOMPAT_MIGRATIONS.has(file)) {
        knownDebt++;
        console.warn(`⚠ ${file}: top-level transaction commands (${list}) — incompatible with apply_migration RPC (known debt)`);
      } else {
        failures++;
        console.error(`✖ ${file}: top-level transaction commands (${list}) — apply_migration RPC executes via EXECUTE and rejects BEGIN/COMMIT/ROLLBACK with SQLSTATE 0A000`);
      }
    }

    const unqualOffenders = lintSqlForUnqualifiedCreate(sql);
    if (unqualOffenders.length > 0) {
      const list = unqualOffenders.join(', ');
      if (KNOWN_RPC_INCOMPAT_MIGRATIONS.has(file)) {
        knownDebt++;
        console.warn(`⚠ ${file}: unqualified CREATE (${list}) — incompatible with apply_migration RPC (known debt)`);
      } else {
        failures++;
        console.error(`✖ ${file}: unqualified CREATE (${list}) — apply_migration RPC runs with SET search_path = '' and rejects unqualified names with SQLSTATE 3F000`);
      }
    }
  }
  if (failures > 0) {
    console.error(`\nLint failed for ${failures} migration finding(s). New migrations must satisfy all lint rules.`);
    process.exit(1);
  }
  const summary = `Checked ${files.length - skipped} migrations (${skipped} grandfathered, ${knownDebt} legacy debt).`;
  console.log(`✓ ${summary}`);
}

if (import.meta.main) main();
