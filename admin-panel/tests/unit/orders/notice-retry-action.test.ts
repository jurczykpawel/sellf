import { beforeEach, expect, it, vi } from 'vitest';
const { send, audit } = vi.hoisted(() => ({ send: vi.fn(), audit: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminAuth: (fn: (ctx: unknown) => unknown) => fn({ user: { id: 'admin' } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/orders/transfer-mail', () => ({ sendOrderNotice: send }));
vi.mock('@/lib/audit/audit-entry', () => ({ recordAuditEntry: audit }));
import { retryOrderNotice } from '@/lib/orders/bank-transfer-actions';
const id = '10000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.clearAllMocks(); audit.mockResolvedValue({ ok: true }); });
it.each(['skipped', 'refused', 'unknown', 'error', 'sent'])('returns and audits the actual %s outcome', async outcome => {
  send.mockResolvedValue({ sent: outcome === 'sent', outcome });
  expect((await retryOrderNotice(id, 'placed')).success).toBe(outcome === 'sent');
  expect(audit).toHaveBeenNthCalledWith(1, {}, expect.objectContaining({ new_values: { action: 'retry_order_notice_requested', order_id: id, notice: 'placed' } }));
  expect(audit).toHaveBeenNthCalledWith(2, {}, expect.objectContaining({ new_values: { action: 'retry_order_notice_result', order_id: id, notice: 'placed', outcome, sent: outcome === 'sent' } }));
});
it('does not send when recording the request fails', async () => {
  audit.mockResolvedValue({ ok: false });
  expect((await retryOrderNotice(id, 'placed')).success).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
