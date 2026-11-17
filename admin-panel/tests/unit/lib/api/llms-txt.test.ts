/**
 * llms.txt carries the API v1 description generated from the operation registry (owner decision
 * 11.1: agent instructions and group descriptions from one source). Fails in CI
 * (`test:api-contract`) when a file's generated block differs from the registry;
 * `bun run llms:update` (UPDATE_LLMS_TXT=1) rewrites the blocks and keeps the hand-written rest.
 * @see src/lib/api/openapi/llms.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LLMS_BEGIN, LLMS_END, renderLlmsApiSection } from '@/lib/api/openapi/llms';
import { API_OPERATIONS, API_TAGS } from '@/lib/api/openapi/operations';
import { buildOpenApiSpec } from '@/lib/api/openapi/spec';

const REPO = path.resolve(__dirname, '../../../../..');
const FILES = ['admin-panel/public/llms.txt', 'docs-site/public/llms.txt'];
const generated = renderLlmsApiSection(buildOpenApiSpec());

describe('generated API section of llms.txt', () => {
  it('lists every operation and group from the registry', () => {
    for (const op of API_OPERATIONS) expect(generated).toContain(`\`${op.method} /api/v1${op.path}\` — \`${op.operationId}\``);
    for (const [tag, description] of Object.entries(API_TAGS)) expect(generated).toContain(`### ${tag}\n\n${description}`);
    expect(generated).toContain('`list_products` · products:read — ');
    expect(generated).toMatch(/`list_api_keys` · panel session only · not in MCP/);
  });

  describe.each(FILES)('%s', (rel) => {
    const file = path.join(REPO, rel);
    const text = readFileSync(file, 'utf8');
    const start = text.indexOf(LLMS_BEGIN);
    const end = text.indexOf(LLMS_END);

    it('has one generated block that matches the registry', () => {
      expect(start, 'missing BEGIN marker').toBeGreaterThanOrEqual(0);
      expect(end, 'missing END marker').toBeGreaterThan(start);
      expect(text.indexOf(LLMS_BEGIN, start + 1)).toBe(-1);
      const actual = text.slice(start, end + LLMS_END.length);
      if (actual !== generated && process.env.UPDATE_LLMS_TXT === '1') {
        writeFileSync(file, text.slice(0, start) + generated + text.slice(end + LLMS_END.length));
        return;
      }
      expect(actual, `${rel} is out of date: run \`bun run llms:update\` in admin-panel`).toBe(generated);
    });
  });
});
