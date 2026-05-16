/**
 * Stripe Payment Method Metadata — pure constants, types, and utility functions.
 *
 * Safe for client-bundle import. Has no dependency on Stripe runtime
 * (no getStripeServer, no admin client). Runtime API calls live in
 * payment-method-configs.ts (server-only).
 */

import { isValidStripePMCId as isValidPMCIdFromTypes } from '@/types/payment-config';
import type { StripePaymentMethodConfig, PaymentMethodInfo } from '@/types/payment-config';

export const KNOWN_PAYMENT_METHODS = [
  'card',
  'blik',
  'p24',
  'sepa_debit',
  'ideal',
  'klarna',
  'affirm',
  'cashapp',
  'giropay',
  'bancontact',
  'eps',
  'sofort',
  'alipay',
  'wechat_pay',
  'au_becs_debit',
  'bacs_debit',
  'acss_debit',
  'us_bank_account',
  'konbini',
  'paynow',
  'promptpay',
  'fpx',
  'grabpay',
] as const;

export type KnownPaymentMethod = typeof KNOWN_PAYMENT_METHODS[number];

export function extractEnabledPaymentMethods(config: StripePaymentMethodConfig): string[] {
  const enabled: string[] = [];
  for (const method of KNOWN_PAYMENT_METHODS) {
    if (config[method]?.enabled) {
      enabled.push(method);
    }
  }
  return enabled;
}

export function getPaymentMethodConfigDisplayName(config: StripePaymentMethodConfig): string {
  if (config.name) return config.name;

  const enabled = extractEnabledPaymentMethods(config);
  if (enabled.length === 0) return 'Empty Configuration';
  if (enabled.length <= 3) return `Custom: ${enabled.join(' + ')}`;
  return `Custom: ${enabled.slice(0, 3).join(', ')} +${enabled.length - 3} more`;
}

export function getAvailablePaymentMethods(): PaymentMethodInfo[] {
  return [
    { type: 'card', name: 'Card', icon: '💳', currencies: ['*'] },
    { type: 'blik', name: 'BLIK', icon: '🇵🇱', currencies: ['PLN'] },
    { type: 'p24', name: 'Przelewy24', icon: '🇵🇱', currencies: ['PLN', 'EUR'] },
    { type: 'sepa_debit', name: 'SEPA Direct Debit', icon: '🇪🇺', currencies: ['EUR'] },
    { type: 'ideal', name: 'iDEAL', icon: '🇳🇱', currencies: ['EUR'] },
    { type: 'giropay', name: 'giropay', icon: '🇩🇪', currencies: ['EUR'] },
    { type: 'bancontact', name: 'Bancontact', icon: '🇧🇪', currencies: ['EUR'] },
    { type: 'eps', name: 'EPS', icon: '🇦🇹', currencies: ['EUR'] },
    { type: 'sofort', name: 'Sofort', icon: '🇩🇪', currencies: ['EUR'] },
    {
      type: 'klarna',
      name: 'Klarna',
      icon: '🛍️',
      currencies: ['USD', 'EUR', 'GBP', 'SEK', 'NOK', 'DKK', 'CHF', 'CAD', 'AUD', 'NZD', 'PLN'],
    },
    { type: 'affirm', name: 'Affirm', icon: '💰', currencies: ['USD', 'CAD'] },
    { type: 'cashapp', name: 'Cash App Pay', icon: '💵', currencies: ['USD'] },
    { type: 'us_bank_account', name: 'US Bank Account (ACH)', icon: '🏦', currencies: ['USD'] },
    {
      type: 'alipay',
      name: 'Alipay',
      icon: '🇨🇳',
      currencies: ['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'SGD', 'AUD', 'NZD', 'CAD'],
    },
    {
      type: 'wechat_pay',
      name: 'WeChat Pay',
      icon: '🇨🇳',
      currencies: ['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'SGD', 'AUD'],
    },
    { type: 'konbini', name: 'Konbini', icon: '🇯🇵', currencies: ['JPY'] },
    { type: 'paynow', name: 'PayNow', icon: '🇸🇬', currencies: ['SGD'] },
    { type: 'promptpay', name: 'PromptPay', icon: '🇹🇭', currencies: ['THB'] },
    { type: 'fpx', name: 'FPX', icon: '🇲🇾', currencies: ['MYR'] },
    { type: 'grabpay', name: 'GrabPay', icon: '🇸🇬', currencies: ['SGD', 'MYR'] },
    { type: 'bacs_debit', name: 'Bacs Direct Debit', icon: '🇬🇧', currencies: ['GBP'] },
    { type: 'au_becs_debit', name: 'BECS Direct Debit', icon: '🇦🇺', currencies: ['AUD'] },
    { type: 'acss_debit', name: 'Pre-authorized debit (PAD)', icon: '🇨🇦', currencies: ['CAD'] },
  ];
}

export function getPaymentMethodInfo(type: string): PaymentMethodInfo | null {
  return getAvailablePaymentMethods().find((m) => m.type === type) || null;
}

export function isPaymentMethodSupportedForCurrency(type: string, currency: string): boolean {
  const info = getPaymentMethodInfo(type);
  if (!info) return false;
  if (info.currencies.includes('*')) return true;
  return info.currencies.includes(currency.toUpperCase());
}

export function filterPaymentMethodTypesByCurrency(types: string[], currency: string): string[] {
  return types.filter((type) => isPaymentMethodSupportedForCurrency(type, currency));
}

export const isValidStripePMCId = isValidPMCIdFromTypes;

export function isValidPaymentMethodType(type: string): boolean {
  const validTypes = getAvailablePaymentMethods().map((m) => m.type);
  return validTypes.includes(type);
}
