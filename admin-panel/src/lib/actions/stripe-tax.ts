'use server'

import { getStripeServer } from '@/lib/stripe/server'
import { getCheckoutConfig, type CheckoutConfig, type ConfigSource } from '@/lib/stripe/checkout-config'
import Stripe from 'stripe'

export type TaxStatusValue =
  | 'active'
  | 'pending'
  | 'stripe_not_configured'
  | 'no_permission'

export type TaxRegistration = {
  country: string
  state?: string
}

export type StripeTaxStatus = {
  status: TaxStatusValue
  missingFields?: string[]
  registrations: TaxRegistration[]
  headOffice?: { country: string; state?: string }
}

export type StripeTaxStatusResponse = {
  success: boolean
  data?: StripeTaxStatus
  error?: string
}

export async function getStripeTaxStatus(): Promise<StripeTaxStatusResponse> {
  let stripe: Stripe

  try {
    stripe = await getStripeServer()
  } catch {
    return {
      success: true,
      data: {
        status: 'stripe_not_configured',
        registrations: [],
      },
    }
  }

  try {
    const [taxSettings, registrationsList] = await Promise.all([
      stripe.tax.settings.retrieve(),
      stripe.tax.registrations.list({ status: 'active', limit: 100 }),
    ])

    const registrations: TaxRegistration[] = registrationsList.data.map((r) => {
      const us = r.country_options.us
      return {
        country: r.country,
        state: us?.state,
      }
    })

    const headOffice = taxSettings.head_office?.address
      ? {
          country: taxSettings.head_office.address.country || '',
          state: taxSettings.head_office.address.state || undefined,
        }
      : undefined

    return {
      success: true,
      data: {
        status: taxSettings.status,
        missingFields:
          taxSettings.status_details.pending?.missing_fields ?? undefined,
        registrations,
        headOffice,
      },
    }
  } catch (error) {
    if (error instanceof Stripe.errors.StripePermissionError) {
      return {
        success: true,
        data: {
          status: 'no_permission',
          registrations: [],
        },
      }
    }

    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to retrieve tax status',
    }
  }
}

export type CheckoutConfigResponse = {
  success: boolean
  data?: CheckoutConfig
  error?: string
}

export async function getCheckoutConfigAction(): Promise<CheckoutConfigResponse> {
  try {
    // Called from Settings UI — bypass the public shop-config cache so the
    // admin always sees the row they just wrote.
    const config = await getCheckoutConfig({ freshShopConfig: true })
    return { success: true, data: config }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resolve checkout config',
    }
  }
}

export type PaymentMethodSourceResponse = {
  success: boolean
  data?: { source: ConfigSource; envExists: boolean }
  error?: string
}

export async function getPaymentMethodSourceAction(): Promise<PaymentMethodSourceResponse> {
  try {
    const config = await getCheckoutConfig()
    return {
      success: true,
      data: {
        source: config.sources.payment_methods,
        envExists: config.envExists.payment_methods,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resolve payment method source',
    }
  }
}
