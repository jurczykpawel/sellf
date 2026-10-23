import { afterEach, describe, expect, it, vi } from 'vitest';
import { signTransferToken, verifyTransferToken } from '@/lib/orders/transfer-token';
import { availableTransferMethod } from '@/lib/orders/bank-transfer-config';
const id = '10000000-0000-4000-8000-000000000001';
afterEach(() => { vi.unstubAllEnvs(); });
describe('transfer instructions link', () => {
  it('reads only the signed order during its validity period', () => {
    vi.stubEnv('CHECKOUT_BINDING_SECRET', 'test-only-transfer-secret');
    const token = signTransferToken(id, 1000);
    expect(verifyTransferToken(token, id, 1001)).toBe(true);
    expect(verifyTransferToken(token, 'another-order', 1001)).toBe(false);
    expect(verifyTransferToken(token, id, 1000 + 61 * 86400)).toBe(false);
    expect(verifyTransferToken(token + 'x', id, 1001)).toBe(false);
    expect(verifyTransferToken(undefined, id, 1001)).toBe(false);
    expect(verifyTransferToken(['invalid'] as unknown as string, id, 1001)).toBe(false);
    vi.stubEnv('CHECKOUT_BINDING_SECRET', '');
    expect(verifyTransferToken(token, id, 1001)).toBe(false);
  });
  it('refreshes the selected method when buyer eligibility changes', () => {
    const profile = { v: 1, modules: [{ id: 'buyer', types: ['person', 'organization'], gus: false, bank_transfer_for: ['organization'] }] };
    expect(availableTransferMethod('transfer', true, profile, 'organization')).toBe('transfer');
    expect(availableTransferMethod('transfer', true, profile, 'person')).toBe('online');
    expect(availableTransferMethod('transfer', false, profile, 'organization')).toBe('online');
    expect(availableTransferMethod('transfer', true, null, 'organization')).toBe('online');
    expect(availableTransferMethod('online', true, profile, 'organization')).toBe('online');
  });
});
