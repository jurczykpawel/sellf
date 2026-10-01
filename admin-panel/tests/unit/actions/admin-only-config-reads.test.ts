/**
 * These server actions expose operational/integration config (Stripe tax
 * status, checkout config, payment method source, currency/GUS API
 * status). They must require an admin session — an anonymous caller
 * should never see them, regardless of what they return to an admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
  })),
}));

vi.mock('@/lib/stripe/server', () => ({ getStripeServer: vi.fn() }));
vi.mock('@/lib/stripe/checkout-config', () => ({ getCheckoutConfig: vi.fn() }));
vi.mock('@/lib/integrations/internal-secrets', () => ({
  getDecryptedCurrencyConfigInternal: vi.fn(),
}));

import { getStripeTaxStatus, getCheckoutConfigAction, getPaymentMethodSourceAction } from '@/lib/actions/stripe-tax';
import { getAdminPaymentConfig } from '@/lib/actions/payment-config';
import { getExchangeRates } from '@/lib/actions/currency';
import { getCurrencyConfig } from '@/lib/actions/currency-config';
import { getGUSConfig } from '@/lib/actions/gus-config';

beforeEach(() => {
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
});

describe('admin-only config reads reject an anonymous caller', () => {
  it('getStripeTaxStatus', async () => {
    const result = await getStripeTaxStatus();
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it('getCheckoutConfigAction', async () => {
    const result = await getCheckoutConfigAction();
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it('getPaymentMethodSourceAction', async () => {
    const result = await getPaymentMethodSourceAction();
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it('getAdminPaymentConfig', async () => {
    const result = await getAdminPaymentConfig();
    expect(result).toBeNull();
  });

  it('getExchangeRates', async () => {
    const result = await getExchangeRates('USD');
    expect(result).toBeNull();
  });

  it('getCurrencyConfig', async () => {
    const result = await getCurrencyConfig();
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it('getGUSConfig', async () => {
    const result = await getGUSConfig();
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
  });
});
