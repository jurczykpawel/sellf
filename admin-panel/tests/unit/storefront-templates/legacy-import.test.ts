/** Authorized legacy import flow. @see actions/storefront-legacy-theme.ts */
import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { importLegacyStorefrontTheme } from '@/lib/actions/storefront-legacy-theme';
import { DEFAULT_CONFIG } from '@/lib/storefront-templates/fixtures';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), principal: vi.fn(), lifecycle: vi.fn(), read: vi.fn(), stat: vi.fn(), write: vi.fn(), mkdir: vi.fn(), client: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/storefront-templates/mutations', () => ({ verifyTemplateSession: mocks.verify, getTemplatePrincipal: mocks.principal }));
vi.mock('@/lib/storefront-templates/lifecycle', () => ({ storefrontLifecycle: mocks.lifecycle }));
vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: mocks.client }));
vi.mock('@/lib/demo-guard', () => ({ isDemoMode: () => false }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.read, stat: mocks.stat, writeFile: mocks.write, mkdir: mocks.mkdir }));
beforeEach(() => {
  vi.resetAllMocks(); mocks.verify.mockResolvedValue({}); mocks.principal.mockReturnValue({});
  const query = { select: () => query, eq: () => query, gt: () => query, limit: mocks.query };
  mocks.client.mockReturnValue({ from: () => query }); mocks.query.mockResolvedValue({ data: [], error: null });
  mocks.stat.mockResolvedValue({ size: 45, isFile: () => true });
  mocks.read.mockResolvedValue(Buffer.from('{"colors":{"accent":"#123456","border":"red"}}'));
  mocks.lifecycle.mockResolvedValueOnce({ success: true, data: { revision: 7, draft: DEFAULT_CONFIG, published: DEFAULT_CONFIG } }).mockResolvedValueOnce({ success: true, revision: 8 });
});
it('imports on a read-only filesystem and records the original bytes', async () => {
  const original = Buffer.from(' {"colors":{"accent":"#123456"},"name":"Żółć"}\n');
  mocks.read.mockResolvedValue(original);
  mocks.write.mockRejectedValue({ code: 'EROFS' });
  mocks.mkdir.mockRejectedValue({ code: 'EROFS' });
  const response = await importLegacyStorefrontTheme(7);
  expect(response.success).toBe(true);
  expect(mocks.stat).toHaveBeenCalledWith(expect.stringContaining('active-theme.json'));
  expect(mocks.stat.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[0]);
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.mkdir).not.toHaveBeenCalled();
  expect(mocks.lifecycle.mock.calls[1][1]).toEqual({
    operation: 'legacy-import', expectedRevision: 7,
    config: { ...DEFAULT_CONFIG, tokens: { format: 1, dark: { accent: '#123456' } } },
    legacySource: { sha256: createHash('sha256').update(original).digest('hex'), byteLength: original.byteLength },
  });
});
it('declines oversized files before reading', async () => {
  mocks.stat.mockResolvedValue({ size: 102401, isFile: () => true });
  expect((await importLegacyStorefrontTheme(7)).code).toBe('INVALID');
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.lifecycle).toHaveBeenCalledTimes(1);
});
it('checks bytes again when the file grows after stat', async () => {
  mocks.read.mockResolvedValue(Buffer.alloc(102401));
  expect((await importLegacyStorefrontTheme(7)).code).toBe('INVALID');
  expect(mocks.lifecycle).toHaveBeenCalledTimes(1);
});
it('checks authorization before reading files or using the service client', async () => {
  mocks.principal.mockReturnValue(null);
  expect((await importLegacyStorefrontTheme(7)).success).toBe(false);
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
});
it('does not import again after a recorded import', async () => {
  mocks.query.mockResolvedValue({ data: [{ revision: 8 }], error: null });
  expect((await importLegacyStorefrontTheme(7)).code).toBe('ALREADY_IMPORTED');
  expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.lifecycle).not.toHaveBeenCalled();
});
it('retains conflicts and never reads a stale source', async () => {
  const response = await importLegacyStorefrontTheme(6);
  expect(response.code).toBe('CONFLICT'); expect(mocks.read).not.toHaveBeenCalled();
});
it('keeps existing overrides and inactive settings while merging supported legacy leaves', async () => {
  const current = { ...DEFAULT_CONFIG, tokens: { format: 1, dark: { accent: '#abcdef' } }, settingsByTemplate: { d: { density: 'compact' } }, content: { 'home.tasks': { sourceLocale: 'pl', pl: { kind: 'heading', heading: 'Żółć', body: '' } } } };
  mocks.lifecycle.mockReset().mockResolvedValueOnce({ success: true, data: { revision: 7, draft: current, published: DEFAULT_CONFIG } }).mockResolvedValueOnce({ success: true, revision: 8 });
  await importLegacyStorefrontTheme(7);
  expect(mocks.lifecycle.mock.calls[1][1].config).toEqual(current);
});
it('fails closed when prior import records cannot be read', async () => {
  mocks.query.mockResolvedValue({ data: null, error: {} });
  expect((await importLegacyStorefrontTheme(7)).success).toBe(false);
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.lifecycle).not.toHaveBeenCalled();
});
it('declines a file that cannot be decoded without changing its bytes', async () => {
  mocks.read.mockResolvedValue(Buffer.concat([Buffer.from('{"name":"'), Buffer.from([0xff]), Buffer.from('","colors":{"accent":"#123456"}}')]));
  expect((await importLegacyStorefrontTheme(7)).success).toBe(false);
  expect(mocks.write).not.toHaveBeenCalled();
});
