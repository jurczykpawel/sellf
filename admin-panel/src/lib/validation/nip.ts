/**
 * Tax ID / VAT Number validation with international support
 *
 * Supports:
 * - Polish NIP (10 digits, with or without "PL" prefix)
 * - EU VAT numbers (with country prefix: DE, FR, etc.)
 * - International tax IDs
 *
 * Polish NIP checksum is validated only for Polish numbers.
 */

import { EU_COUNTRY_CODES } from '@/lib/checkout/eu-countries';

/**
 * Detects if a tax ID is a Polish NIP (with or without "PL" prefix)
 * @returns true if it's Polish NIP format
 */
export function isPolishNIP(taxId: string): boolean {
  const cleaned = taxId.replace(/[-\s]/g, '').toUpperCase();

  // Check for explicit PL prefix
  if (cleaned.startsWith('PL')) {
    const digits = cleaned.substring(2);
    return /^\d{10}$/.test(digits);
  }

  // Check for 10 digits without prefix (assume Polish if exactly 10 digits)
  return /^\d{10}$/.test(cleaned);
}

/**
 * Extracts country code from tax ID (e.g., "PL1234567890" → "PL")
 * Returns null if no country prefix found
 */
export function extractCountryCode(taxId: string): string | null {
  const cleaned = taxId.replace(/[-\s]/g, '').toUpperCase();
  const match = cleaned.match(/^([A-Z]{2})/);
  return match ? match[1] : null;
}

/**
 * Normalizes NIP by removing dashes, spaces, and optionally country prefix
 * Examples:
 * - "123-456-78-90" → "1234567890"
 * - "PL1234567890" → "1234567890"
 * - "PL 123-456-78-90" → "1234567890"
 * - "DE123456789" → "DE123456789" (keeps non-PL prefixes)
 */
export function normalizeNIP(nip: string, removePrefix: boolean = true): string {
  const cleaned = nip.replace(/[-\s]/g, '').toUpperCase();

  // Remove "PL" prefix if requested and present
  if (removePrefix && cleaned.startsWith('PL')) {
    return cleaned.substring(2);
  }

  return cleaned;
}

/**
 * Formats NIP as XXX-XXX-XX-XX
 * Example: "1234567890" → "123-456-78-90"
 */
export function formatNIP(nip: string): string {
  const normalized = normalizeNIP(nip);
  if (normalized.length !== 10) return nip;

  return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6, 8)}-${normalized.slice(8, 10)}`;
}

/**
 * Validates NIP checksum using Polish algorithm
 *
 * Algorithm:
 * 1. Weights: [6, 5, 7, 2, 3, 4, 5, 6, 7]
 * 2. Multiply each of first 9 digits by corresponding weight
 * 3. Sum all products
 * 4. Calculate modulo 11
 * 5. Result must equal 10th digit
 * 6. If modulo = 10, NIP is invalid
 *
 * @param nip - NIP number (can include dashes/spaces)
 * @returns true if checksum is valid
 */
export function validateNIPChecksum(nip: string): boolean {
  const normalized = normalizeNIP(nip);

  // Must be exactly 10 digits
  if (!/^\d{10}$/.test(normalized)) {
    return false;
  }

  // Weights for checksum calculation
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];

  // Calculate checksum
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(normalized[i]) * weights[i];
  }

  const checksum = sum % 11;

  // If checksum is 10, NIP is invalid
  if (checksum === 10) {
    return false;
  }

  // Checksum must match 10th digit
  return checksum === parseInt(normalized[9]);
}

/**
 * Validates Tax ID / VAT Number format and checksum (for Polish NIP)
 *
 * @param taxId - Tax ID with or without country prefix
 * @param strictPolishValidation - If true, validates Polish checksum. Default: true
 * @returns validation result with normalized/formatted value or error
 */
export interface TaxIdValidationResult {
  isValid: boolean;
  isPolish: boolean;
  countryCode?: string | null;  // e.g., "PL", "DE", "FR"
  normalized?: string;  // e.g., "1234567890" (without prefix)
  formatted?: string;   // e.g., "123-456-78-90" (Polish) or "DE123456789" (other)
  withPrefix?: string;  // e.g., "PL1234567890"
  error?: string;
}

/**
 * Main validation function supporting international tax IDs
 */
export function validateTaxId(
  taxId: string,
  strictPolishValidation: boolean = true,
  country?: string
): TaxIdValidationResult {
  if (country) {
    const cleaned = normalizeNIP(taxId, country === 'PL');
    if (!EU_COUNTRY_CODES.has(country)) {
      const value = taxId.trim();
      return { isValid: /^[a-zA-Z0-9-]{0,40}$/.test(value), isPolish: false, normalized: value, formatted: value };
    }
    const result = validateTaxId(taxId, strictPolishValidation);
    const prefix = country === 'GR' ? 'EL' : country;
    const matches = country === 'PL' ? result.isPolish : cleaned.startsWith(prefix) && /^[A-Z]{2}[A-Z0-9]+$/.test(cleaned);
    return { ...result, isValid: taxId.length <= 40 && result.isValid && matches };
  }
  if (!taxId || taxId.trim().length === 0) {
    return {
      isValid: false,
      isPolish: false,
      error: 'Tax ID is required'
    };
  }

  const countryCode = extractCountryCode(taxId);
  const isPolish = isPolishNIP(taxId);

  // Polish NIP validation
  if (isPolish) {
    const normalized = normalizeNIP(taxId, true); // Remove PL prefix

    if (!/^\d{10}$/.test(normalized)) {
      return {
        isValid: false,
        isPolish: true,
        countryCode: 'PL',
        error: 'Polish NIP must be 10 digits'
      };
    }

    // Validate checksum for Polish NIP
    if (strictPolishValidation && !validateNIPChecksum(normalized)) {
      return {
        isValid: false,
        isPolish: true,
        countryCode: 'PL',
        normalized,
        error: 'Invalid Polish NIP checksum'
      };
    }

    return {
      isValid: true,
      isPolish: true,
      countryCode: 'PL',
      normalized,
      formatted: formatNIP(normalized),
      withPrefix: `PL${normalized}`
    };
  }

  // Non-Polish tax ID - basic validation
  const cleaned = normalizeNIP(taxId, false);

  // Minimum length for international tax IDs (EU VAT numbers are typically 8-15 characters)
  const MIN_TAX_ID_LENGTH = 8;

  // Basic format check: should have country code + sufficient digits
  if (countryCode && cleaned.length >= MIN_TAX_ID_LENGTH) {
    return {
      isValid: true,
      isPolish: false,
      countryCode,
      normalized: cleaned.substring(2), // Remove country prefix
      formatted: cleaned,
      withPrefix: cleaned
    };
  }

  // No country prefix, not Polish format - accept as generic tax ID if long enough
  if (!countryCode && cleaned.length >= MIN_TAX_ID_LENGTH) {
    return {
      isValid: true,
      isPolish: false,
      countryCode: null,
      normalized: cleaned,
      formatted: cleaned,
      withPrefix: cleaned
    };
  }

  return {
    isValid: false,
    isPolish: false,
    countryCode,
    error: 'Invalid tax ID format - too short or invalid format'
  };
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use validateTaxId() instead
 */
export function validateNIPLegacy(nip: string): TaxIdValidationResult {
  return validateTaxId(nip, true);
}
