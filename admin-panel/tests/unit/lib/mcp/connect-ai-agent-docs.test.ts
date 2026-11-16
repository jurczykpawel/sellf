/**
 * The tool calls printed in "Connect your AI agent" (EN/PL) must be valid for the generated
 * MCP tools: every `{"name": …, "arguments": …}` line names an existing tool and its arguments
 * pass that tool's inputSchema (JSON Schema 2020-12).
 * @see docs-site/src/content/docs/connect-ai-agent.md
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec } from '@/lib/api/openapi/spec';
import { mcpOperations, type OpenApiDocument } from '@/lib/mcp/operations';

const tools = new Map(mcpOperations(buildOpenApiSpec() as unknown as OpenApiDocument).map((op) => [op.name, op]));
const ajv = new Ajv2020({ strict: false, allErrors: true });

describe.each(['connect-ai-agent.md', 'pl/connect-ai-agent.md'])('docs %s', (file) => {
  const text = readFileSync(path.resolve(__dirname, '../../../../../docs-site/src/content/docs', file), 'utf8');
  const calls = text.split('\n').filter((line) => line.startsWith('{"name":')).map((line) => JSON.parse(line) as { name: string; arguments: Record<string, unknown> });

  it('documents the HTTP endpoint, not the removed stdio server', () => {
    expect(text).toContain('/api/mcp');
    expect(text).toContain('mode=compact');
    expect(text).not.toMatch(/mcp-server|stdio/);
  });

  it('every documented tool call matches the generated tool schema', () => {
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const call of calls) {
      const tool = tools.get(call.name);
      expect(tool, call.name).toBeDefined();
      const validate = ajv.compile(tool!.inputSchema);
      expect(validate(call.arguments), `${call.name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });
});
