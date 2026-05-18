/**
 * Stripe Payment Method Configurations — server-side API integration.
 *
 * Live Stripe API calls (getStripeServer dependency). Pure constants
 * and pure utility functions live in payment-method-metadata.ts and
 * are safe for client-bundle import.
 *
 * @see https://docs.stripe.com/api/payment_method_configurations
 */

import 'server-only'

import { getStripeServer } from '@/lib/stripe/server';
import { getAvailablePaymentMethods } from '@/lib/stripe/payment-method-metadata';
import type { StripePaymentMethodConfig, PaymentMethodInfo } from '@/types/payment-config';

export async function fetchStripePaymentMethodConfigs(): Promise<{
  success: boolean;
  data?: StripePaymentMethodConfig[];
  error?: string;
}> {
  try {
    const stripe = await getStripeServer();
    if (!stripe) {
      return {
        success: false,
        error: 'Stripe not configured. Please configure Stripe API keys in settings.',
      };
    }

    const configs = await stripe.paymentMethodConfigurations.list({ limit: 100 });
    return {
      success: true,
      data: configs.data as unknown as StripePaymentMethodConfig[],
    };
  } catch (error) {
    console.error('[fetchStripePaymentMethodConfigs] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function fetchStripePaymentMethodConfig(id: string): Promise<{
  success: boolean;
  data?: StripePaymentMethodConfig;
  error?: string;
}> {
  try {
    const stripe = await getStripeServer();
    if (!stripe) {
      return { success: false, error: 'Stripe not configured' };
    }

    const config = await stripe.paymentMethodConfigurations.retrieve(id);
    return {
      success: true,
      data: config as unknown as StripePaymentMethodConfig,
    };
  } catch (error) {
    console.error(`[fetchStripePaymentMethodConfig] Error fetching PMC ${id}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getAccountAvailablePaymentMethods(): Promise<PaymentMethodInfo[]> {
  return getAvailablePaymentMethods().map((method) => ({ ...method, available: true }));
}
