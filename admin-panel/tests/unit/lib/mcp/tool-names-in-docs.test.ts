/**
 * Every MCP tool name the repository tells people or agents to call must exist in the tool list
 * generated from the OpenAPI registry (W221br P3). Covers docs-site, skills/, docs/, README,
 * FEATURES, BACKLOG and both llms.txt files.
 *
 * A token counts as a tool name when it is
 * - the `"name"` of a `{"name": …, "arguments": …}` call,
 * - a snake_case cell in a markdown table column headed "tool" / "narzędzie",
 * - a backticked snake_case span that starts with an operation verb (`get_`, `list_`, `create_`…, the
 *   first words of generated and removed tool names), except database identifiers (any word of
 *   supabase/schema.snapshot.sql), SQL-style calls (`public.fn`, `fn(`) and NOT_TOOLS,
 * - or a name of the removed hand-written server (`mcp-server/`) that the generator no longer
 *   produces, anywhere (old flat names and the `templates_*` / `offers_*` families).
 * @see src/lib/mcp/operations.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec } from '@/lib/api/openapi/spec';
import { COMPACT_TOOLS, mcpOperations, type OpenApiDocument } from '@/lib/mcp/operations';

const REPO = path.resolve(__dirname, '../../../../..');
const tools = new Set([...mcpOperations(buildOpenApiSpec() as unknown as OpenApiDocument).map((op) => op.name), ...COMPACT_TOOLS.map((t) => t.name)]);

/** Tool names of the removed `mcp-server/` (last shipped in 2026.11.0). */
const OLD_SERVER_TOOLS = [
  'bulk_grant_access', 'compare_periods', 'create_coupon', 'create_product', 'create_webhook', 'deactivate_coupon', 'delete_coupon',
  'delete_product', 'delete_webhook', 'duplicate_product', 'export_payments', 'extend_access', 'get_api_usage', 'get_conversion_stats',
  'get_coupon', 'get_coupon_stats', 'get_dashboard', 'get_payment', 'get_payment_stats', 'get_product', 'get_product_stats',
  'get_purchase_attribution', 'get_refund_stats', 'get_revenue_by_product', 'get_revenue_stats', 'get_sales_trends', 'get_system_health',
  'get_top_products', 'get_user', 'get_user_purchases', 'get_webhook_logs', 'grant_access', 'list_coupons', 'list_failed_payments',
  'list_payments', 'list_products', 'list_users', 'list_webhooks', 'process_refund', 'restore_product', 'revoke_access', 'search_payments',
  'search_users', 'toggle_product_status', 'update_coupon', 'update_product', 'update_webhook',
];
const RETIRED = new Set(OLD_SERVER_TOOLS.filter((name) => !tools.has(name)));
const RETIRED_FAMILY = /\b(?:templates|offers)_[a-z]+(?:_[a-z]+)*\b/g;

const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
const TOOL_HEADER = /\btool\b|narzędzi/i;
const VERBS = new Set([...tools, ...OLD_SERVER_TOOLS].map((name) => name.split('_')[0]));
/** Database identifiers (functions, tables, columns, enum values) are not tools. */
const SQL_NAMES = new Set(readFileSync(path.join(REPO, 'supabase/schema.snapshot.sql'), 'utf8').match(/\b[a-z][a-z0-9_]+\b/g));
/** Backticked identifiers outside the schema that start with a verb but are not tools. */
const NOT_TOOLS = new Set(['compare_at_price']);

function files(rel: string, ext = /\.(md|mdx|txt)$/): string[] {
  const full = path.join(REPO, rel);
  if (!statSync(full, { throwIfNoEntry: false })) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? (entry.name === 'node_modules' ? [] : files(path.join(rel, entry.name), ext)) : ext.test(entry.name) ? [path.join(full, entry.name)] : []);
}

const DOCS = ['docs-site/src/content', 'docs-site/public/llms.txt', 'admin-panel/public/llms.txt', 'skills', 'docs', 'README.md', 'FEATURES.md', 'BACKLOG.md', 'admin-panel/README.md']
  .flatMap((rel) => files(rel));

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

/** Tool names a document refers to, with their line numbers. */
export function toolMentions(text: string): Array<{ name: string; line: number; retired?: boolean }> {
  const out: Array<{ name: string; line: number; retired?: boolean }> = [];
  const lines = text.split('\n');
  let toolColumn = -1;
  lines.forEach((line, i) => {
    const at = i + 1;
    for (const m of line.matchAll(/"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"/g)) out.push({ name: m[1], line: at });

    if (line.trim().startsWith('|')) {
      const row = cells(line);
      if (lines[i + 1]?.trim().match(/^\|?\s*:?-{3,}/)) toolColumn = row.findIndex((cell) => TOOL_HEADER.test(cell));
      else if (toolColumn >= 0 && !/^:?-{3,}/.test(row[0] ?? '')) {
        const cell = (row[toolColumn] ?? '').replace(/`/g, '');
        if (SNAKE.test(cell)) out.push({ name: cell, line: at });
      }
    } else toolColumn = -1;

    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const name = m[1];
      if (!SNAKE.test(name) || !VERBS.has(name.split('_')[0]) || NOT_TOOLS.has(name) || (SQL_NAMES.has(name) && !tools.has(name))) continue;
      const before = line.slice(0, m.index);
      const after = line.slice((m.index ?? 0) + m[0].length);
      if (!before.endsWith('public.') && !after.startsWith('(')) out.push({ name, line: at });
    }
    for (const word of line.match(/\b[a-z][a-z0-9_]+\b/g) ?? []) if (RETIRED.has(word)) out.push({ name: word, line: at, retired: true });
    for (const m of line.matchAll(RETIRED_FAMILY)) out.push({ name: m[0], line: at, retired: true });
  });
  return out;
}

describe('MCP tool names in repository docs', () => {
  it('scans the documentation set', () => {
    expect(DOCS.length).toBeGreaterThan(40);
    expect(tools.size).toBeGreaterThan(90);
    expect([...tools].some((name) => /^(templates|offers)_/.test(name)), 'retired family prefix now generated; adjust RETIRED_FAMILY').toBe(false);
  });

  it('detects the forms used to name a tool', () => {
    const sample = [
      '| MCP tool | Scope |', '|---|---|', '| templates_capabilities | x |', '| get_template_config | x |', '',
      'Call `create_coupon` and `get_nope` via MCP; `public.get_attribution_report`, `get_x()`, `discount_type` and `set_price` are not tools.',
      '{"name":"made_up_tool","arguments":{}}',
      'Discovery: deactivate_coupon in prose.',
    ].join('\n');
    const missing = toolMentions(sample).filter((m) => m.retired || !tools.has(m.name)).map((m) => m.name);
    expect(missing.sort()).toEqual(['deactivate_coupon', 'get_nope', 'made_up_tool', 'templates_capabilities', 'templates_capabilities'].sort());
  });

  it('names only tools that the generated list contains', () => {
    const missing = DOCS.flatMap((file) => toolMentions(readFileSync(file, 'utf8'))
      .filter((m) => m.retired || !tools.has(m.name))
      .map((m) => `${path.relative(REPO, file)}:${m.line} ${m.name}`));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('does not point at the removed mcp-server/ package', () => {
    const stale = DOCS.flatMap((file) => readFileSync(file, 'utf8').split('\n')
      .flatMap((line, i) => (/\bmcp-server\//.test(line) ? [`${path.relative(REPO, file)}:${i + 1}`] : [])));
    expect(stale).toEqual([]);
  });
});
