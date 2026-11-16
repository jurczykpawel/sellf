import { beforeEach, describe, expect, it, vi } from 'vitest';
const { ADMIN_ID } = vi.hoisted(() => ({ ADMIN_ID: '11111111-1111-4111-8111-111111111111' }));
const mock = vi.hoisted(() => ({ config: {} as Record<string, unknown>, update: vi.fn(), updateError: null as null | { message: string }, audit: vi.fn(), auditSaved: vi.fn(), discard: vi.fn(), issue: vi.fn(), rpc: vi.fn(), rpcError: null as null | { message: string }, steps: [] as string[], calls: [] as unknown[] }));
vi.mock('@/lib/invoicing/service', () => ({ issueInvoiceForTransaction: (...args: unknown[]) => { mock.steps.push('issue'); return mock.issue(...args); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: vi.fn(async (fn, options) => {
  mock.calls.push(options);
  const dataClient = { rpc: async (name: string, args: unknown) => { mock.steps.push(`rpc:${name}`); mock.rpc(name, args); return { data: null, error: mock.rpcError }; }, from(table: string) {
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

beforeEach(() => { mock.calls = []; mock.steps = []; mock.updateError = null; mock.rpcError = null; vi.clearAllMocks(); mock.auditSaved.mockResolvedValue({ data: { id: 'audit-1' }, error: null }); mock.issue.mockResolvedValue({ success: true }); mock.config = { id: true, provider: 'none', mode: 'manual', domain: '', template: '{product}', exemption: '', token: { encrypted_key: 'ciphertext', encryption_iv: 'iv', encryption_tag: 'tag' } }; });
describe('invoice settings action responses', () => {
  it('returns a token flag and no encrypted token material', async () => {
    const response = await getInvoiceSettings();
    expect(response.data).toMatchObject({ tokenSet: true });
    expect(JSON.stringify(response)).not.toMatch(/ciphertext|encrypted_key|encryption_iv|encryption_tag/);
  });
  it('saves only validated settings, retains saved token and uses a mutating admin action', async () => {
    const response = await saveInvoiceSettings({ provider: 'none', domain: '', mode: 'manual', template: '{product}', exemption: '', token: '' });
    expect(response.success).toBe(true);
    expect(mock.rpc).toHaveBeenCalledWith('save_invoicing_config', { p_settings: { provider: 'none', domain: '', mode: 'manual', template: '{product}', exemption: '' }, p_token: null, p_performed_by: ADMIN_ID });
    expect(mock.calls).toContainEqual({ mutating: true });
  });
  it('rejects unknown values before any write', async () => {
    expect((await saveInvoiceSettings({ provider: 'other', token: 'text' })).success).toBe(false);
    expect(mock.update).not.toHaveBeenCalled();
  });
});

const SETTINGS = { provider: 'none', domain: '', mode: 'manual', template: '{product}', exemption: '', token: '' };
const TRANSACTION_ID = '44444444-4444-4444-8444-444444444444';

describe('invoice actions audit (W256c, transactional since W256d)', () => {
  it('saves the settings and their entry in one RPC (admin auth user UUID), with no direct table write', async () => {
    expect((await saveInvoiceSettings(SETTINGS)).success).toBe(true);
    expect(mock.steps).toEqual(['rpc:save_invoicing_config']);
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.audit).not.toHaveBeenCalled();
  });
  it('passes a new token only in encrypted form', async () => {
    expect((await saveInvoiceSettings({ ...SETTINGS, token: 'plain-api-token' })).success).toBe(true);
    const args = mock.rpc.mock.calls[0][1] as { p_token: Record<string, string> };
    expect(Object.keys(args.p_token).sort()).toEqual(['encrypted_key', 'encryption_iv', 'encryption_tag']);
    expect(JSON.stringify(args)).not.toContain('plain-api-token');
  });
  it('reports failure and deletes nothing when the RPC fails (a refused entry saves nothing, in the database)', async () => {
    mock.rpcError = { message: 'audit_log_performed_by_fkey' };
    expect((await saveInvoiceSettings(SETTINGS)).success).toBe(false);
    expect(mock.discard).not.toHaveBeenCalled();
  });
  it('issues no invoice when the request entry is refused', async () => {
    mock.auditSaved.mockResolvedValueOnce({ data: null, error: { message: 'audit down' } });
    expect((await mutateInvoice(TRANSACTION_ID, 'issue')).success).toBe(false);
    expect(mock.issue).not.toHaveBeenCalled();
  });
  it('records the issue as a request before calling the provider', async () => {
    expect((await mutateInvoice(TRANSACTION_ID, 'issue')).success).toBe(true);
    expect(mock.steps).toEqual(['audit', 'issue']);
    expect(mock.audit).toHaveBeenCalledWith(expect.objectContaining({ table_name: 'invoices', performed_by: ADMIN_ID, new_values: { transaction_id: TRANSACTION_ID, action: 'issue_requested' } }));
  });
  it('keeps the request and adds an outcome entry when issuing fails (nothing is deleted)', async () => {
    mock.issue.mockResolvedValueOnce({ success: false, error: 'provider down' });
    expect((await mutateInvoice(TRANSACTION_ID, 'issue')).success).toBe(false);
    expect(mock.steps).toEqual(['audit', 'issue', 'audit']);
    expect(mock.discard).not.toHaveBeenCalled();
    expect(mock.audit).toHaveBeenLastCalledWith(expect.objectContaining({ new_values: { transaction_id: TRANSACTION_ID, action: 'issue_failed', request_audit_id: 'audit-1' } }));
  });
});
