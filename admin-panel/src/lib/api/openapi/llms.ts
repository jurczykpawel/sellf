/**
 * The API part of `llms.txt`, generated from the OpenAPI document (same registry as
 * `GET /api/v1/openapi.json` and the MCP tools), so agent instructions, group descriptions and
 * the operation list have one source.
 *
 * Both `admin-panel/public/llms.txt` and `docs-site/public/llms.txt` keep a hand-written part and
 * this block between the markers. `tests/unit/lib/api/llms-txt.test.ts` (CI, `test:api-contract`)
 * fails when a file's block differs; `bun run llms:update` rewrites the blocks.
 *
 * @see ./spec.ts
 */
import type { OpenApiDocument } from '@/lib/api/openapi/spec';

export const LLMS_BEGIN = '<!-- BEGIN GENERATED: API v1 from the operation registry (admin-panel/src/lib/api/openapi/operations.ts); run `bun run llms:update` in admin-panel -->';
export const LLMS_END = '<!-- END GENERATED: API v1 -->';

interface SpecOperation {
  operationId: string;
  summary: string;
  tags: string[];
  security?: Array<Record<string, unknown>>;
  'x-required-scope'?: string;
  'x-mcp'?: { exclude?: boolean };
}

function access(op: SpecOperation): string {
  if (op['x-required-scope']) return op['x-required-scope'];
  if (op.security?.some((entry) => 'SessionCookie' in entry)) return 'panel session only';
  return 'public';
}

/** Markdown block (markers included) describing API v1 for agents. */
export function renderLlmsApiSection(spec: OpenApiDocument): string {
  const base = String(spec.servers[0]?.url ?? '/api/v1');
  const byTag = new Map<string, string[]>(spec.tags.map((tag) => [tag.name, []]));
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, raw] of Object.entries(item)) {
      const op = raw as unknown as SpecOperation;
      const mcp = op['x-required-scope'] && !op['x-mcp']?.exclude ? '' : ' · not in MCP';
      byTag.get(op.tags[0])?.push(`- \`${method.toUpperCase()} ${base}${path}\` — \`${op.operationId}\` · ${access(op)}${mcp} — ${op.summary}`);
    }
  }
  const count = [...byTag.values()].reduce((sum, lines) => sum + lines.length, 0);
  return [
    LLMS_BEGIN,
    '## API v1 for agents',
    '',
    String(spec.info.description),
    '',
    `Paths are relative to the Sellf instance origin (e.g. \`https://shop.example.com${base}/products\`). Full machine-readable description with request and response schemas: \`${base}/openapi.json\` (OpenAPI 3.1, public). MCP: \`POST /api/mcp\` with the same API key exposes one tool per operation, named by \`operationId\`, with the JSON request body under \`body\`; \`/api/mcp?mode=compact\` exposes \`search_operations\` + \`call_operation\` instead. ${count} operations; each line: method and path — operationId · required scope — summary.`,
    ...spec.tags.flatMap((tag) => ['', `### ${tag.name}`, '', tag.description, '', ...(byTag.get(tag.name) ?? [])]),
    LLMS_END,
  ].join('\n');
}
