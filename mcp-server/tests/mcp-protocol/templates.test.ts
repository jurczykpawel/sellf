/** Template tools exercised through MCP and the authenticated HTTP client. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';

const validation = { validatorVersion: 1, valid: true, errors: [], warnings: [{ code: 'TRANSLATION_FALLBACK', path: '/content', message: 'Using fallback' }] };
const config = { format: 1, templateId: 'default', settingsByTemplate: {}, overridesByTemplate: {}, content: {}, tokens: null };
let client: Client;
let server: ReturnType<typeof createServer>;
const fetchMock = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const textBody = (result: Awaited<ReturnType<Client['callTool']>>) => JSON.parse((result.content as Array<{ text: string }>)[0].text);
const call = (name: string, args = {}) => client.callTool({ name: `templates_${name}`, arguments: args });

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock);
  server = createServer({ apiUrl: 'http://localhost:55436', apiKey: 'test-template-key' });
  client = new Client({ name: 'template-author', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
});
afterEach(async () => {
  await client.close();
  await server.close();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('template MCP contract', () => {
  it('discovers eleven independent scope wrappers and strict envelopes', async () => {
    const { tools } = await client.listTools();
    const expected = { read: 'read', capabilities: 'read', draft: 'write', validate: 'read', preview: 'read', diff: 'read', publish: 'activate', rollback: 'activate', reset: 'write', license_activate: 'write', license_status: 'read' };
    for (const [name, scope] of Object.entries(expected)) {
      const tool = tools.find(t => t.name === `templates_${name}`)!;
      expect(tool, name).toBeDefined();
      expect(tool.description).toContain(`templates:${scope}`);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    expect(tools.filter(t => t.name.startsWith('templates_'))).toHaveLength(11);
  });

  it('forwards exact revisions, typed evidence and top-level bodies throughout authoring', async () => {
    const preview = { revision: 1, locale: 'pl', fixture: 'standard', expiresAt: '2026-10-16T22:10:00.000Z', previewPath: '/template-preview/1?locale=pl&fixture=standard&issuedAt=1792188000000', validation, effectiveTokens: [{ path: 'light.accent', value: '#000000', origin: 'core' }], unusedSlots: ['home.faq'] };
    const steps: Array<[string, string, string, Record<string, unknown>, unknown]> = [
      ['read', 'GET', 'config', {}, { revision: 0, draft: null, published: config, effectiveTemplateId: 'default', rights: { canSelect: [], canCustomizeTheme: false }, validation, unusedSlots: [], effectiveTokens: [] }],
      ['capabilities', 'GET', 'capabilities', {}, { schemas: { config: {} }, resetPaths: { default: ['tokens.light.accent'] }, limits: { requestBytes: 131072 } }],
      ['draft', 'PUT', 'draft', { expectedRevision: 0, config }, { revision: 1, validation }],
      ['validate', 'POST', 'validate', { config, mode: 'publish' }, validation],
      ['preview', 'POST', 'preview', { revision: 1, locale: 'pl', fixture: 'standard' }, preview],
      ['diff', 'POST', 'diff', { fromRevision: 0, toRevision: 1 }, { fromRevision: 0, toRevision: 1, changes: [{ path: '/tokens', kind: 'changed', before: null, after: {} }], unusedSlots: [], validation }],
      ['publish', 'POST', 'publish', { expectedRevision: 1 }, { revision: 2, validation }],
      ['rollback', 'POST', 'rollback', { expectedRevision: 2, targetRevision: 0 }, { revision: 3, validation }],
      ['reset', 'POST', 'reset', { expectedRevision: 3, templateId: 'default', field: 'tokens.light.accent' }, { revision: 4, validation }],
    ];
    for (const [name, method, endpoint, input, output] of steps) {
      reply(output);
      const result = await call(name, input);
      expect(result.isError).not.toBe(true);
      expect(textBody(result)).toEqual(output);
      expect(result.structuredContent).toEqual(output);
      const [url, options] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe(`http://localhost:55436/api/v1/templates/${endpoint}`);
      expect(options).toMatchObject({ method, headers: { 'X-API-Key': 'test-template-key' }, redirect: 'error' });
      expect(options?.body).toBe(method === 'GET' ? undefined : JSON.stringify(input));
    }
    expect(JSON.stringify(preview)).not.toContain('test-template-key');
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it.each([
    [401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [409, 'CONFLICT'],
    [422, 'INVALID'], [422, 'LIMIT'], [429, 'RATE_LIMITED'], [503, 'UNAVAILABLE'],
  ])('preserves HTTP %i / %s without retry or fallback', async (status, code) => {
    const error = { code, message: 'Template request could not be completed', validation: status === 422 ? { validatorVersion: 1, valid: false, errors: [{ code, path: '/tokens', message: 'Invalid value', limit: 102400 }], warnings: [] } : null, currentRevision: status === 409 ? 7 : null };
    reply(error, status);
    const result = await call('publish', { expectedRevision: 1 });
    expect(result.isError).toBe(true);
    expect(textBody(result)).toEqual(error);
    expect(result.structuredContent).toEqual(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['read', 'draft', 'publish'])('does not infer other scopes for %s', async name => {
    reply({ code: 'FORBIDDEN', message: 'Template request could not be completed', validation: null, currentRevision: null }, 403);
    const result = await call(name, name === 'draft' ? { expectedRevision: 0, config } : name === 'publish' ? { expectedRevision: 0 } : {});
    expect(result.isError).toBe(true);
    expect(textBody(result).code).toBe('FORBIDDEN');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['read', { actor: 'other' }], ['draft', { expectedRevision: 0, config, operation: 'publish' }],
    ['publish', { expectedRevision: -1 }], ['publish', { expectedRevision: 1.1 }],
    ['publish', { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }],
    ['preview', { revision: 1, locale: 'de', fixture: 'standard' }],
    ['preview', { revision: 1, locale: 'en', fixture: '../local' }],
    ['validate', { config, mode: 'force' }],
  ])('rejects invalid %s envelopes before HTTP', async (name, input) => {
    expect((await call(name, input)).isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the generated registry schemas and all reset paths without a local schema fork', async () => {
    const capabilities = JSON.parse(execFileSync('bun', ['scripts/check-template.ts', '--capabilities'], {
      cwd: new URL('../../../admin-panel/', import.meta.url), encoding: 'utf8',
    }));
    reply(capabilities);
    const result = await call('capabilities');
    expect(result.structuredContent).toEqual(capabilities);
    expect(textBody(result)).toEqual(capabilities);
    expect(capabilities.limits).toMatchObject({ configInputBytes: 102400, requestBytes: 131072 });
    expect(capabilities.resetPaths.default).not.toContain('content.home.hero');
    expect(capabilities.resetPaths.d).toContain('overrides.sections.tasks.visibility');
    expect(capabilities.resetPaths.d).toContain('overrides.sections.hero.variant');
    expect(capabilities.resetPaths.d).not.toContain('overrides.hidden');
    expect(capabilities.orderPolicy).toMatchObject({ read: 'unique-known-subset', write: 'full-resolved-list' });
    expect(capabilities.schemas.config.properties.overridesByTemplate.properties.d.properties).toHaveProperty('sections');
    const { tools } = await client.listTools();
    expect(JSON.stringify(tools.find(tool => tool.name === 'templates_draft')?.inputSchema)).toContain('sections.<id>.visibility');
  });

  it('retains a maximum-sized config plus wrapper and the API byte-limit diagnostics', async () => {
    const content = { ...config, content: { padding: '' } };
    content.content.padding = 'ą'.repeat(Math.floor((102400 - Buffer.byteLength(JSON.stringify(content))) / 2));
    const input = { expectedRevision: Number.MAX_SAFE_INTEGER, config: content };
    reply({ revision: Number.MAX_SAFE_INTEGER, validation });
    expect((await call('draft', input)).isError).not.toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify(input));
    const error = { code: 'LIMIT', message: 'Template request could not be completed', validation: { validatorVersion: 1, valid: false, errors: [{ code: 'LIMIT', path: '/config', message: 'Input exceeds byte limit', limit: 102400 }], warnings: [] }, currentRevision: null };
    reply(error, 422);
    expect(textBody(await call('draft', { ...input, config: { ...content, extra: 'over budget' } }))).toEqual(error);
  });

  it('leaves current reset-path authorization to the API allowlist', async () => {
    const error = { code: 'INVALID', message: 'Template request could not be completed', validation: { validatorVersion: 1, valid: false, errors: [{ code: 'SCHEMA', path: '/field', message: 'Unknown reset field' }], warnings: [] }, currentRevision: null };
    reply(error, 422);
    expect(textBody(await call('reset', { expectedRevision: 0, templateId: 'default', field: 'content.home.hero' }))).toEqual(error);
  });

  it('reports unavailable transport without emitting transport details', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private transport details'));
    const result = await call('read');
    expect(result.isError).toBe(true);
    expect(textBody(result)).toEqual({ code: 'UNAVAILABLE', message: 'Template API unavailable', validation: null, currentRevision: null });
  });
});

it('saves keys and reads status through independent private endpoints', async () => {
  const status = { templateId: 'storefront-a', state: 'unknown', verifiedAt: null };
  reply(status);
  expect((await call('license_activate', { templateId: 'storefront-a', token: 'synthetic-private-key' })).structuredContent).toEqual(status);
  expect(fetchMock.mock.calls.at(-1)).toMatchObject(['http://localhost:55436/api/v1/templates/licenses', { method: 'POST', body: JSON.stringify({ templateId: 'storefront-a', token: 'synthetic-private-key' }) }]);
  reply({ statuses: [status] });
  expect((await call('license_status')).structuredContent).toEqual({ statuses: [status] });
  expect(fetchMock.mock.calls.at(-1)).toMatchObject(['http://localhost:55436/api/v1/templates/licenses', { method: 'GET' }]);
});

it('discovers and forwards product-scoped offer tools with exact API bodies', async () => {
  const productId = 'aaaaaaaa-1111-4111-a111-111111111111';
  const { tools } = await client.listTools();
  const steps = [
    ['read', 'GET', 'config', {}, 'read'],
    ['draft', 'PUT', 'draft', { expectedRevision: 0, config }, 'write'],
    ['validate', 'POST', 'validate', { config, mode: 'publish' }, 'read'],
    ['preview', 'POST', 'preview', { revision: 1, locale: 'pl', fixture: 'published-products' }, 'read'],
    ['diff', 'POST', 'diff', { fromRevision: 0, toRevision: 1 }, 'read'],
    ['publish', 'POST', 'publish', { expectedRevision: 1 }, 'activate'],
    ['rollback', 'POST', 'rollback', { expectedRevision: 2, targetRevision: 0 }, 'activate'],
    ['reset', 'POST', 'reset', { expectedRevision: 3, field: 'appearance' }, 'write'],
    ['history', 'POST', 'history', { limit: 10, beforeRevision: 4 }, 'read'],
  ] as const;
  for (const [name, method, endpoint, input, scope] of steps) {
    const tool = tools.find(t => t.name === `offers_${name}`)!;
    expect(tool).toBeDefined(); expect(tool.description).toContain(`templates:${scope}`);
    expect(tool.inputSchema.additionalProperties).toBe(false);
    const output = name === 'history' ? { history: [{ revision: 4, draft: config, published: null }] } : { revision: 4, validation };
    reply(output);
    const result = await client.callTool({ name: `offers_${name}`, arguments: { productId, ...input } });
    expect(result.structuredContent).toEqual(output);
    expect(fetchMock.mock.calls.at(-1)).toMatchObject([`http://localhost:55436/api/v1/products/${productId}/offer/${endpoint}`, { method }]);
    const sent = fetchMock.mock.calls.at(-1)![1]?.body;
    expect(sent ? JSON.parse(String(sent)) : undefined).toEqual(method === 'GET' ? undefined : input);
  }
});
it('keeps offer input validation and structured errors in MCP', async () => {
  expect((await client.callTool({ name: 'offers_read', arguments: { productId: '../other' } })).isError).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
  const error = { code: 'CONFLICT', message: 'Reconcile', currentRevision: 7, validation: null };
  reply(error, 409);
  const result = await client.callTool({ name: 'offers_publish', arguments: { productId: 'aaaaaaaa-1111-4111-a111-111111111111', expectedRevision: 1 } });
  expect(result.isError).toBe(true); expect(result.structuredContent).toEqual(error);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
