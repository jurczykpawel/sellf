/**
 * Stripe Security Utilities
 *
 * Secure helpers for Stripe payment data handling:
 * - Client secret parsing (regex-validated, not naive split)
 * - Metadata sanitization (control char removal, length limits)
 * - Payment amount validation (fixed-price and PWYW)
 * - Currency validation against allowlist
 * - Refund amount validation (double-refund prevention)
 *
 * @see /api/update-payment-metadata/route.ts - uses client secret parsing
 * @see /api/webhooks/stripe/route.ts - uses idempotency / amount checks
 * @see /api/admin/payments/refund/route.ts - uses refund validation
 */

// ===== CLIENT SECRET PARSING =====

/**
 * Securely extract Payment Intent ID from a Stripe client secret.
 *
 * Uses regex validation instead of naive `.split('_secret_')` to prevent
 * injection attacks with embedded `_secret_` substrings.
 *
 * @returns The payment intent ID (e.g., `pi_3Mtw...`) or null if malformed
 */
export function extractPaymentIntentIdSecure(clientSecret: string): string | null {
  const pattern = /^(pi_[a-zA-Z0-9]{14,30})_secret_[a-zA-Z0-9]+$/;
  const match = clientSecret.match(pattern);
  return match ? match[1] : null;
}

// ===== METADATA SANITIZATION =====

export interface PaymentMetadata {
  first_name?: string;
  last_name?: string;
  company_name?: string;
  nip?: string;
  address?: string;
}

/**
 * Sanitize a single metadata field value.
 * Removes control characters, trims whitespace, and enforces length limit.
 */
export function sanitizeMetadataField(value: string | undefined, maxLength: number = 100): string {
  if (!value || typeof value !== 'string') return '';

  // Remove control characters
  let sanitized = value.replace(/[\x00-\x1F\x7F]/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  // Enforce length limit
  sanitized = sanitized.substring(0, maxLength);

  return sanitized;
}

/**
 * Sanitize all fields of payment metadata with per-field length limits.
 */
export function sanitizePaymentMetadata(input: PaymentMetadata): PaymentMetadata {
  return {
    first_name: sanitizeMetadataField(input.first_name, 100),
    last_name: sanitizeMetadataField(input.last_name, 100),
    company_name: sanitizeMetadataField(input.company_name, 200),
    nip: sanitizeMetadataField(input.nip, 20),
    address: sanitizeMetadataField(input.address, 300),
  };
}

// ===== AMOUNT VALIDATION =====

export interface AmountValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate a payment amount against the expected price.
 *
 * @param receivedAmount - Amount received (in cents)
 * @param expectedPrice - Expected price (in currency units, e.g., dollars)
 * @param currency - Payment currency code
 * @param allowCustomPrice - Whether pay-what-you-want pricing is enabled
 * @param minCustomPrice - Minimum PWYW price (in currency units)
 */
export function validatePaymentAmount(
  receivedAmount: number | undefined,
  expectedPrice: number,
  currency: string,
  allowCustomPrice: boolean = false,
  minCustomPrice: number = 0.50
): AmountValidation {
  if (receivedAmount === undefined || receivedAmount === null) {
    return { valid: false, error: 'Amount is required' };
  }

  // Must be a valid number
  if (!Number.isFinite(receivedAmount) || receivedAmount < 0) {
    return { valid: false, error: 'Invalid amount' };
  }

  // Convert expected price to cents
  const expectedAmountCents = Math.round(expectedPrice * 100);
  const minAmountCents = Math.round(minCustomPrice * 100);

  // For fixed-price products, must match exactly
  if (!allowCustomPrice) {
    if (receivedAmount !== expectedAmountCents) {
      return {
        valid: false,
        error: `Amount mismatch: expected ${expectedAmountCents}, got ${receivedAmount}`
      };
    }
  } else {
    // For PWYW, must meet minimum
    if (receivedAmount < minAmountCents) {
      return {
        valid: false,
        error: `Amount below minimum: ${minAmountCents} cents`
      };
    }
  }

  return { valid: true };
}

// ===== CURRENCY VALIDATION =====

export const ALLOWED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'PLN', 'CAD', 'AUD'] as const;

/**
 * Validate that the received currency matches the expected currency
 * and is in the allowed list.
 */
export function validateCurrencyMatch(
  receivedCurrency: string | undefined,
  expectedCurrency: string
): { valid: boolean; error?: string } {
  if (!receivedCurrency) {
    return { valid: false, error: 'Currency is required' };
  }

  const normalizedReceived = receivedCurrency.toUpperCase();
  const normalizedExpected = expectedCurrency.toUpperCase();

  // Must be in allowed list
  if (!ALLOWED_CURRENCIES.includes(normalizedReceived as typeof ALLOWED_CURRENCIES[number])) {
    return { valid: false, error: `Unsupported currency: ${normalizedReceived}` };
  }

  // Must match expected
  if (normalizedReceived !== normalizedExpected) {
    return {
      valid: false,
      error: `Currency mismatch: expected ${normalizedExpected}, got ${normalizedReceived}`
    };
  }

  return { valid: true };
}

// ===== REFUND VALIDATION =====

export interface RefundValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate a refund request against the original transaction.
 *
 * @param requestedAmount - Amount to refund (in cents)
 * @param originalAmount - Original transaction amount (in cents)
 * @param alreadyRefunded - Amount already refunded (in cents)
 * @param transactionStatus - Current transaction status
 */
export function validateRefund(
  requestedAmount: number,
  originalAmount: number,
  alreadyRefunded: number,
  transactionStatus: string
): RefundValidation {
  // Status must be 'completed' to refund
  if (transactionStatus !== 'completed') {
    return { valid: false, error: `Cannot refund transaction with status: ${transactionStatus}` };
  }

  // Amount must be positive
  if (requestedAmount <= 0) {
    return { valid: false, error: 'Refund amount must be positive' };
  }

  // Cannot exceed remaining
  const maxRefundable = originalAmount - alreadyRefunded;
  if (requestedAmount > maxRefundable) {
    return {
      valid: false,
      error: `Amount ${requestedAmount} exceeds refundable ${maxRefundable}`
    };
  }

  return { valid: true };
}
