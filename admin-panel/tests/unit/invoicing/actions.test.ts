import { beforeEach, describe, expect, it, vi } from 'vitest';
const { ADMIN_ID } = vi.hoisted(() => ({ ADMIN_ID: '11111111-1111-4111-8111-111111111111' }));
const mock = vi.hoisted(() => ({ config: {} as Record<string, unknown>, update: vi.fn(), updateError: null as null | { message: string }, audit: vi.fn(), auditSaved: vi.fn(), discard: vi.fn(), issue: vi.fn(), steps: [] as string[], calls: [] as unknown[] }));
vi.mock('@/lib/invoicing/service', () => ({ issueInvoiceForTransaction: (...args: unknown[]) => { mock.steps.push('issue'); return mock.issue(...args); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: vi.fn(async (fn, options) => {
  mock.calls.push(options);
  const dataClient = { from(table: string) {
    return {
      select: () => ({ eq: () => ({ single: async () => ({ data: mock.config, error: null }) }) }),
      update: (input: unknown) => { mock.steps.push('update'); mock.update(input); return { eq: async () => ({ error: mock.updateError }) }; },
      insert: (row: unknown) => { mock.steps.push('audit'); mock.audit(row); return { select: () => ({ single: mock.auditSaved }) }; },
      delete: () => ({ eq: async (column: string, value: string) => { mock.steps.push('discard'); mock.discard(column, value); return { error: null }; } }),
    };
  } };
  return fn({ dataClient, user: { id: ADMIN_ID } });
}) }));
import { getInvoiceSettings, mutateInvoice, saveInvoiceSettings } from '@/lib/actions/invoicing';

beforeEach(() => { mock.calls = []; mock.steps = []; mock.updateError = null; vi.clearAllMocks(); mock.auditSaved.mockResolvedValue({ data: { id: 'audit-1' }, error: null }); mock.issue.mockResolvedValue({ success: true }); mock.config = { id: true, provider: 'none', mode: 'manual', domain: '', template: '{product}', exemption: '', token: { encrypted_key: 'ciphertext', encryption_iv: 'iv', encryption_tag: 'tag' } }; });
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

const SETTINGS = { provider: 'none', domain: '', mode: 'manual', template: '{product}', exemption: '', token: '' };
const TRANSACTION_ID = '44444444-4444-4444-8444-444444444444';

describe('invoice actions audit (W256c)', () => {
  it('writes the settings entry (admin auth user UUID) before saving', async () => {
    expect((await saveInvoiceSettings(SETTINGS)).success).toBe(true);
    expect(mock.steps).toEqual(['audit', 'update']);
    expect(mock.audit).toHaveBeenCalledWith(expect.objectContaining({ table_name: 'invoicing_config', performed_by: ADMIN_ID }));
  });
  it('saves no settings when the audit entry is refused', async () => {
    mock.auditSaved.mockResolvedValueOnce({ data: null, error: { message: 'audit down' } });
    expect((await saveInvoiceSettings(SETTINGS)).success).toBe(false);
    expect(mock.update).not.toHaveBeenCalled();
  });
  it('takes the settings entry back when saving fails', async () => {
    mock.updateError = { message: 'update failed' };
    expect((await saveInvoiceSettings(SETTINGS)).success).toBe(false);
    expect(mock.steps).toEqual(['audit', 'update', 'discard']);
    expect(mock.discard).toHaveBeenCalledWith('id', 'audit-1');
  });
  it('issues no invoice when the audit entry is refused', async () => {
    mock.auditSaved.mockResolvedValueOnce({ data: null, error: { message: 'audit down' } });
    expect((await mutateInvoice(TRANSACTION_ID, 'issue')).success).toBe(false);
    expect(mock.issue).not.toHaveBeenCalled();
  });
  it('writes the issue entry first and takes it back when issuing fails', async () => {
    mock.issue.mockResolvedValueOnce({ success: false, error: 'provider down' });
    expect((await mutateInvoice(TRANSACTION_ID, 'issue')).success).toBe(false);
    expect(mock.steps).toEqual(['audit', 'issue', 'discard']);
  });
});
