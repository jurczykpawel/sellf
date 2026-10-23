import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ config: {} as Record<string, unknown>, update: vi.fn(), audit: vi.fn(), calls: [] as unknown[] }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: vi.fn(async (fn, options) => {
  mock.calls.push(options);
  const dataClient = { from(table: string) {
    return {
      select: () => ({ eq: () => ({ single: async () => ({ data: mock.config, error: null }) }) }),
      update: (input: unknown) => { mock.update(input); return { eq: async () => ({ error: null }) }; },
      insert: mock.audit,
    };
  } };
  return fn({ dataClient, user: { id: 'admin' } });
}) }));
import { getInvoiceSettings, saveInvoiceSettings } from '@/lib/actions/invoicing';

beforeEach(() => { mock.calls = []; mock.update.mockClear(); mock.config = { id: true, provider: 'none', mode: 'manual', domain: '', template: '{product}', exemption: '', token: { encrypted_key: 'ciphertext', encryption_iv: 'iv', encryption_tag: 'tag' } }; });
describe('invoice settings action responses', () => {
  it('returns a token flag and no encrypted token material', async () => {
    const response = await getInvoiceSettings();
    expect(response.data).toMatchObject({ tokenSet: true });
    expect(JSON.stringify(response)).not.toMatch(/ciphertext|encrypted_key|encryption_iv|encryption_tag/);
  });
  it('updates only validated settings, retains saved token and uses a mutating admin action', async () => {
    const response = await saveInvoiceSettings({ provider: 'none', domain: '', mode: 'manual', template: '{product}', exemption: '', token: '' });
    expect(response.success).toBe(true);
    expect(mock.update.mock.calls[0][0]).not.toHaveProperty('token');
    expect(mock.calls).toContainEqual({ mutating: true });
    expect(mock.audit).toHaveBeenCalled();
  });
  it('rejects unknown values before any write', async () => {
    expect((await saveInvoiceSettings({ provider: 'other', token: 'text' })).success).toBe(false);
    expect(mock.update).not.toHaveBeenCalled();
  });
});
