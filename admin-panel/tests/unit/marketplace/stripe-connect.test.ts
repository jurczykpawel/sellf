/**
 * Tests for Stripe Connect Standard integration
 *
 * @see src/lib/stripe/connect.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===== MOCKS (hoisted to avoid vi.mock factory scoping issues) =====

const { mockStripe, mockPlatformFrom } = vi.hoisted(() => {
  const mockStripe = {
    accounts: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
    accountLinks: {
      create: vi.fn(),
    },
  };
  const mockPlatformFrom = vi.fn();
  return { mockStripe, mockPlatformFrom };
});

vi.mock('@/lib/stripe/server', () => ({
  getStripeServer: vi.fn().mockResolvedValue(mockStripe),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createPlatformClient: vi.fn(() => ({
    from: mockPlatformFrom,
  })),
}));

// ===== IMPORT AFTER MOCKS =====

import {
  createConnectedAccount,
  createOnboardingLink,
  getConnectedAccountStatus,
  isOnboardingComplete,
  disconnectAccount,
  handleAccountUpdated,
  handleAccountDeauthorized,
} from '@/lib/stripe/connect';
import type Stripe from 'stripe';

// ===== HELPERS =====

function setupPlatformChain(overrides?: {
  selectData?: unknown;
  selectError?: unknown;
  updateError?: unknown;
}) {
  const updateEq = vi.fn().mockResolvedValue({ error: overrides?.updateError ?? null });
  const updateFn = vi.fn().mockReturnValue({ eq: updateEq });
  const selectSingle = vi.fn().mockResolvedValue({
    data: overrides?.selectData ?? null,
    error: overrides?.selectError ?? null,
  });
  const selectEq2 = vi.fn().mockReturnValue({ single: selectSingle });
  const selectEq = vi.fn().mockReturnValue({ eq: selectEq2, single: selectSingle });
  const selectFn = vi.fn().mockReturnValue({ eq: selectEq });

  mockPlatformFrom.mockImplementation(() => ({
    update: updateFn,
    select: selectFn,
  }));

  return { updateFn, updateEq, selectFn, selectEq, selectSingle };
}

// ===== TESTS =====

describe('Stripe Connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===== createConnectedAccount =====

  describe('createConnectedAccount', () => {
    it('should create a Standard connected account and update seller', async () => {
      mockStripe.accounts.create.mockResolvedValue({ id: 'acct_test123' });
      const chain = setupPlatformChain();

      const result = await createConnectedAccount(
        { id: 'seller-1', slug: 'nick', display_name: 'Nick G' },
        'nick@example.com'
      );

      expect(result.success).toBe(true);
      expect(result.accountId).toBe('acct_test123');

      // Verify Stripe API call
      expect(mockStripe.accounts.create).toHaveBeenCalledWith({
        type: 'standard',
        email: 'nick@example.com',
        metadata: {
          seller_id: 'seller-1',
          seller_slug: 'nick',
          platform: 'sellf',
        },
        business_profile: {
          name: 'Nick G',
        },
      });

      // Verify DB update
      expect(chain.updateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          stripe_account_id: 'acct_test123',
          stripe_onboarding_complete: false,
        })
      );
    });

    it('should return success even if DB update fails (account exists on Stripe)', async () => {
      mockStripe.accounts.create.mockResolvedValue({ id: 'acct_test456' });
      setupPlatformChain({ updateError: { message: 'DB error' } });

      const result = await createConnectedAccount(
        { id: 'seller-2', slug: 'alice', display_name: 'Alice' },
        'alice@example.com'
      );

      expect(result.success).toBe(true);
      expect(result.accountId).toBe('acct_test456');
    });

    it('should return error when Stripe API fails', async () => {
      mockStripe.accounts.create.mockRejectedValue(new Error('Stripe API error'));
      setupPlatformChain();

      const result = await createConnectedAccount(
        { id: 'seller-3', slug: 'bob', display_name: 'Bob' },
        'bob@example.com'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Stripe API error');
    });
  });

  // ===== createOnboardingLink =====

  describe('createOnboardingLink', () => {
    it('should create an account onboarding link', async () => {
      mockStripe.accountLinks.create.mockResolvedValue({
        url: 'https://connect.stripe.com/setup/s/test123',
      });

      const result = await createOnboardingLink(
        'acct_test123',
        'https://platform.com/connect/refresh',
        'https://platform.com/connect/return'
      );

      expect(result.success).toBe(true);
      expect(result.url).toBe('https://connect.stripe.com/setup/s/test123');

      expect(mockStripe.accountLinks.create).toHaveBeenCalledWith({
        account: 'acct_test123',
        refresh_url: 'https://platform.com/connect/refresh',
        return_url: 'https://platform.com/connect/return',
        type: 'account_onboarding',
      });
    });

    it('should return error when Stripe fails', async () => {
      mockStripe.accountLinks.create.mockRejectedValue(new Error('Link expired'));

      const result = await createOnboardingLink(
        'acct_test123',
        'https://platform.com/refresh',
        'https://platform.com/return'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Link expired');
    });
  });

  // ===== getConnectedAccountStatus =====

  describe('getConnectedAccountStatus', () => {
    it('should return full account status for completed onboarding', async () => {
      mockStripe.accounts.retrieve.mockResolvedValue({
        id: 'acct_test123',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      });

      const status = await getConnectedAccountStatus('acct_test123');

      expect(status).toEqual({
        accountId: 'acct_test123',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        onboardingComplete: true,
      });
    });

    it('should return incomplete status for partial onboarding', async () => {
      mockStripe.accounts.retrieve.mockResolvedValue({
        id: 'acct_test456',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
      });

      const status = await getConnectedAccountStatus('acct_test456');

      expect(status).toEqual({
        accountId: 'acct_test456',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        onboardingComplete: false,
      });
    });

    it('should return null when Stripe API fails', async () => {
      mockStripe.accounts.retrieve.mockRejectedValue(new Error('Not found'));

      const status = await getConnectedAccountStatus('acct_invalid');

      expect(status).toBeNull();
    });

    it('should handle charges_enabled true but details_submitted false', async () => {
      mockStripe.accounts.retrieve.mockResolvedValue({
        id: 'acct_partial',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: false,
      });

      const status = await getConnectedAccountStatus('acct_partial');

      expect(status?.onboardingComplete).toBe(false);
    });
  });

  // ===== isOnboardingComplete =====

  describe('isOnboardingComplete', () => {
    it('should return true for completed onboarding', async () => {
      mockStripe.accounts.retrieve.mockResolvedValue({
        id: 'acct_test',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      });

      expect(await isOnboardingComplete('acct_test')).toBe(true);
    });

    it('should return false for incomplete onboarding', async () => {
      mockStripe.accounts.retrieve.mockResolvedValue({
        id: 'acct_test',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
      });

      expect(await isOnboardingComplete('acct_test')).toBe(false);
    });

    it('should return false when API fails', async () => {
      mockStripe.accounts.retrieve.mockRejectedValue(new Error('fail'));

      expect(await isOnboardingComplete('acct_invalid')).toBe(false);
    });
  });

  // ===== disconnectAccount =====

  describe('disconnectAccount', () => {
    it('should clear Stripe account from seller', async () => {
      const chain = setupPlatformChain({
        selectData: { stripe_account_id: 'acct_test123' },
      });

      const result = await disconnectAccount('seller-1');

      expect(result.success).toBe(true);
      expect(chain.updateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          stripe_account_id: null,
          stripe_onboarding_complete: false,
        })
      );
    });

    it('should return error when seller not found', async () => {
      setupPlatformChain({
        selectData: null,
        selectError: { message: 'Not found' },
      });

      const result = await disconnectAccount('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when seller has no Stripe account', async () => {
      setupPlatformChain({
        selectData: { stripe_account_id: null },
      });

      const result = await disconnectAccount('seller-no-stripe');

      expect(result.success).toBe(false);
      expect(result.error).toContain('no Stripe account');
    });

    it('should return error when DB update fails', async () => {
      setupPlatformChain({
        selectData: { stripe_account_id: 'acct_test123' },
        updateError: { message: 'DB error' },
      });

      const result = await disconnectAccount('seller-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to update');
    });
  });

  // ===== handleAccountUpdated =====

  describe('handleAccountUpdated', () => {
    it('should update seller onboarding status when charges become enabled', async () => {
      const chain = setupPlatformChain({
        selectData: { id: 'seller-1', stripe_onboarding_complete: false },
      });

      const result = await handleAccountUpdated({
        id: 'acct_test123',
        charges_enabled: true,
        details_submitted: true,
      } as Stripe.Account);

      expect(result.processed).toBe(true);
      expect(chain.updateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          stripe_onboarding_complete: true,
        })
      );
    });

    it('should skip update when status has not changed', async () => {
      const chain = setupPlatformChain({
        selectData: { id: 'seller-1', stripe_onboarding_complete: true },
      });

      const result = await handleAccountUpdated({
        id: 'acct_test123',
        charges_enabled: true,
        details_submitted: true,
      } as Stripe.Account);

      expect(result.processed).toBe(true);
      expect(chain.updateFn).not.toHaveBeenCalled();
    });

    it('should handle unknown account gracefully', async () => {
      setupPlatformChain({
        selectData: null,
        selectError: { message: 'Not found' },
      });

      const result = await handleAccountUpdated({
        id: 'acct_unknown',
        charges_enabled: true,
        details_submitted: true,
      } as Stripe.Account);

      expect(result.processed).toBe(true);
      expect(result.message).toContain('No seller found');
    });

    it('should report failure when DB update fails', async () => {
      setupPlatformChain({
        selectData: { id: 'seller-1', stripe_onboarding_complete: false },
        updateError: { message: 'DB error' },
      });

      const result = await handleAccountUpdated({
        id: 'acct_test123',
        charges_enabled: true,
        details_submitted: true,
      } as Stripe.Account);

      expect(result.processed).toBe(false);
    });

    it('should set onboarding to false when charges become disabled', async () => {
      const chain = setupPlatformChain({
        selectData: { id: 'seller-1', stripe_onboarding_complete: true },
      });

      const result = await handleAccountUpdated({
        id: 'acct_test123',
        charges_enabled: false,
        details_submitted: true,
      } as Stripe.Account);

      expect(result.processed).toBe(true);
      expect(chain.updateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          stripe_onboarding_complete: false,
        })
      );
    });
  });

  // ===== handleAccountDeauthorized =====

  describe('handleAccountDeauthorized', () => {
    it('should clear Stripe association when seller deauthorizes', async () => {
      const chain = setupPlatformChain({
        selectData: { id: 'seller-1' },
      });

      const result = await handleAccountDeauthorized('acct_test123');

      expect(result.processed).toBe(true);
      expect(result.message).toContain('deauthorized');
      expect(chain.updateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          stripe_account_id: null,
          stripe_onboarding_complete: false,
        })
      );
    });

    it('should handle unknown account gracefully', async () => {
      setupPlatformChain({
        selectData: null,
        selectError: { message: 'Not found' },
      });

      const result = await handleAccountDeauthorized('acct_unknown');

      expect(result.processed).toBe(true);
      expect(result.message).toContain('No seller found');
    });

    it('should report failure when DB update fails', async () => {
      setupPlatformChain({
        selectData: { id: 'seller-1' },
        updateError: { message: 'DB error' },
      });

      const result = await handleAccountDeauthorized('acct_test123');

      expect(result.processed).toBe(false);
    });
  });
});
