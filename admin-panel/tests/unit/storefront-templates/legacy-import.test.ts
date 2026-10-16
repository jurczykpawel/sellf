/** Authorized legacy import flow. @see actions/storefront-legacy-theme.ts */
import { beforeEach, expect, it, vi } from 'vitest';
import { importLegacyStorefrontTheme } from '@/lib/actions/storefront-legacy-theme';
import { DEFAULT_CONFIG } from '@/lib/storefront-templates/fixtures';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), principal: vi.fn(), lifecycle: vi.fn(), read: vi.fn(), write: vi.fn(), mkdir: vi.fn(), client: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/storefront-templates/mutations', () => ({ verifyTemplateSession: mocks.verify, getTemplatePrincipal: mocks.principal }));
vi.mock('@/lib/storefront-templates/lifecycle', () => ({ storefrontLifecycle: mocks.lifecycle }));
vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: mocks.client }));
vi.mock('@/lib/demo-guard', () => ({ isDemoMode: () => false }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.read, writeFile: mocks.write, mkdir: mocks.mkdir }));
beforeEach(() => {
  vi.resetAllMocks(); mocks.verify.mockResolvedValue({}); mocks.principal.mockReturnValue({});
  const query = { select: () => query, eq: () => query, gt: () => query, limit: mocks.query };
  mocks.client.mockReturnValue({ from: () => query }); mocks.query.mockResolvedValue({ data: [], error: null });
  mocks.read.mockResolvedValue(Buffer.from('{"colors":{"accent":"#123456","border":"red"}}'));
  mocks.lifecycle.mockResolvedValueOnce({ success: true, data: { revision: 7, draft: DEFAULT_CONFIG, published: DEFAULT_CONFIG } }).mockResolvedValueOnce({ success: true, revision: 8 });
});
it('retains a byte-exact backup before saving a converted draft and keeps content', async () => {
  const response = await importLegacyStorefrontTheme(7);
  expect(response.success).toBe(true);
  expect(mocks.write).toHaveBeenCalledWith(expect.stringContaining('active-theme.legacy-backup.json'), Buffer.from('{"colors":{"accent":"#123456","border":"red"}}'), { flag: 'wx', mode: 0o600 });
  expect(mocks.lifecycle.mock.calls[1][1]).toEqual({ operation: 'legacy-import', expectedRevision: 7, config: { ...DEFAULT_CONFIG, tokens: { format: 1, dark: { accent: '#123456' } } } });
  expect(response.unsupported).toEqual(['colors.border']);
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
it('does not overwrite a different backup', async () => {
  mocks.write.mockRejectedValue({ code: 'EEXIST' }); mocks.read.mockResolvedValueOnce(Buffer.from('{"colors":{}}')).mockResolvedValueOnce(Buffer.from('different'));
  expect((await importLegacyStorefrontTheme(7)).success).toBe(false);
  expect(mocks.lifecycle).toHaveBeenCalledTimes(1);
});
it('retains conflicts and never creates a backup from a stale snapshot', async () => {
  const response = await importLegacyStorefrontTheme(6);
  expect(response.code).toBe('CONFLICT'); expect(mocks.write).not.toHaveBeenCalled();
});
it('keeps existing overrides and inactive settings while merging supported legacy leaves', async () => {
  const current = { ...DEFAULT_CONFIG, tokens: { format: 1, dark: { accent: '#abcdef' } }, settingsByTemplate: { d: { density: 'compact' } }, content: { 'home.tasks': { sourceLocale: 'pl', pl: { kind: 'heading', heading: 'Żółć', body: '' } } } };
  mocks.lifecycle.mockReset().mockResolvedValueOnce({ success: true, data: { revision: 7, draft: current, published: DEFAULT_CONFIG } }).mockResolvedValueOnce({ success: true, revision: 8 });
  await importLegacyStorefrontTheme(7);
  expect(mocks.lifecycle.mock.calls[1][1].config).toEqual(current);
});
it('can retry after a failed commit using the same retained backup', async () => {
  mocks.write.mockRejectedValue({ code: 'EEXIST' });
  expect((await importLegacyStorefrontTheme(7)).success).toBe(true);
  expect(mocks.lifecycle).toHaveBeenCalledTimes(2);
});
it('fails closed when prior import records cannot be read', async () => {
  mocks.query.mockResolvedValue({ data: null, error: {} });
  expect((await importLegacyStorefrontTheme(7)).success).toBe(false);
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.lifecycle).not.toHaveBeenCalled();
});
it('does not mutate after backup creation fails', async () => {
  mocks.write.mockRejectedValue({ code: 'EACCES' });
  expect((await importLegacyStorefrontTheme(7)).code).toBe('BACKUP_FAILED');
  expect(mocks.lifecycle).toHaveBeenCalledTimes(1);
});
it('declines a file that cannot be decoded without changing its bytes', async () => {
  mocks.read.mockResolvedValue(Buffer.concat([Buffer.from('{"name":"'), Buffer.from([0xff]), Buffer.from('","colors":{"accent":"#123456"}}')]));
  expect((await importLegacyStorefrontTheme(7)).success).toBe(false);
  expect(mocks.write).not.toHaveBeenCalled();
});
