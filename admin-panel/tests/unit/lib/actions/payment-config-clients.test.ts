import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
  createPlatformClient: vi.fn(),
  withAdminClient: vi.fn(),
}))

vi.mock('@/lib/actions/admin-auth', () => ({
  withAdminAuth: vi.fn(),
  withAdminClient: vi.fn(async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ user: {}, supabase: {}, role: 'platform_admin', dataClient: {} })
  ),
}))

vi.mock('@/lib/stripe/payment-method-configs', () => ({
  fetchStripePaymentMethodConfigs: vi.fn(),
  isValidStripePMCId: vi.fn(() => true),
  fetchStripePaymentMethodConfig: vi.fn(),
}))

vi.mock('@/lib/auth-server', () => ({
  requireAdminUser: vi.fn(),
}))

import {
  getPaymentMethodConfig,
  getStripePaymentMethodConfigsCached,
} from '@/lib/actions/payment-config'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { withAdminClient } from '@/lib/actions/admin-auth'

const mockedCreateClient = vi.mocked(createClient)
const mockedCreateAdminClient = vi.mocked(createAdminClient)
const mockedWithAdminClient = vi.mocked(withAdminClient)

function makeChainableClient(returnValue: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.from = vi.fn(() => chain)
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.update = vi.fn(() => chain)
  chain.single = vi.fn().mockResolvedValue(returnValue)
  return chain
}

describe('payment-config: client selection (anti-regression for 42501)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getPaymentMethodConfig', () => {
    it('uses service_role admin client, never anon createClient', async () => {
      const chain = makeChainableClient({
        data: { id: 1, config_mode: 'automatic' },
        error: null,
      })
      mockedCreateAdminClient.mockReturnValue(chain as never)

      await getPaymentMethodConfig()

      expect(mockedCreateAdminClient).toHaveBeenCalledOnce()
      expect(mockedCreateClient).not.toHaveBeenCalled()
    })

    it('returns config data on success', async () => {
      const chain = makeChainableClient({
        data: { id: 1, config_mode: 'custom', custom_payment_methods: [] },
        error: null,
      })
      mockedCreateAdminClient.mockReturnValue(chain as never)

      const result = await getPaymentMethodConfig()
      expect(result?.config_mode).toBe('custom')
    })

    it('returns null on db error without throwing', async () => {
      const chain = makeChainableClient({
        data: null,
        error: { code: 'PGRST116', message: 'not found' },
      })
      mockedCreateAdminClient.mockReturnValue(chain as never)

      const result = await getPaymentMethodConfig()
      expect(result).toBeNull()
    })
  })

  describe('getStripePaymentMethodConfigsCached', () => {
    it('uses service_role admin client, never anon createClient', async () => {
      const chain = makeChainableClient({
        data: {
          stripe_pmc_last_synced: new Date().toISOString(),
          available_payment_methods: [{ id: 'pmc_test', name: 'Test' }],
        },
        error: null,
      })
      mockedCreateAdminClient.mockReturnValue(chain as never)

      await getStripePaymentMethodConfigsCached()

      expect(mockedCreateAdminClient).toHaveBeenCalled()
      expect(mockedCreateClient).not.toHaveBeenCalled()
    })

    it('rejects non-admin callers before touching the admin client', async () => {
      mockedWithAdminClient.mockResolvedValueOnce({
        success: false,
        error: 'Forbidden - admin access required',
        errorCode: 'FORBIDDEN',
      })

      const result = await getStripePaymentMethodConfigsCached()

      expect(result.success).toBe(false)
      expect(result.error).toContain('Forbidden')
      expect(mockedCreateAdminClient).not.toHaveBeenCalled()
    })
  })
})
