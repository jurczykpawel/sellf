/**
 * Redirect URL Builders
 * Builds redirect URLs for OTO and regular success redirects after payment
 */

import { isSafeRedirectUrl } from '@/lib/validations/redirect';

// ============================================
// OTO Redirect
// ============================================

export interface OtoRedirectParams {
  locale: string;
  otoProductSlug: string;
  customerEmail?: string;
  couponCode?: string;
  baseUrl?: string;
  // Optional params from source product settings
  hideBump?: boolean;
  passParams?: boolean;
  // Additional data to pass when passParams is true
  sourceProductId?: string;
  sessionId?: string;
}

// ============================================
// Success Redirect (non-OTO)
// ============================================

export interface SuccessRedirectParams {
  /** Target URL - can be relative (/path), absolute (https://...), or domain only (example.com) */
  targetUrl: string;
  /** Base URL for resolving relative paths */
  baseUrl?: string;
  /** Whether to append customer data params */
  passParams?: boolean;
  /** Customer email */
  customerEmail?: string;
  /** Source product ID */
  productId?: string;
  /** Stripe session ID */
  sessionId?: string;
  /** Additional params to pass (will be filtered) */
  additionalParams?: Record<string, string | undefined>;
}

export interface SuccessRedirectResult {
  url: string;
  hasHideBump: boolean;
}

export interface OtoRedirectResult {
  url: string;
  hasAllRequiredParams: boolean;
  missingParams: string[];
}

/**
 * Builds the OTO redirect URL with all required parameters
 *
 * Required params for OTO mode to work on checkout:
 * - email: Customer email for coupon validation
 * - coupon: OTO coupon code
 * - oto=1: Flag to enable OTO mode
 *
 * @returns URL string and validation info
 */
export function buildOtoRedirectUrl(params: OtoRedirectParams): OtoRedirectResult {
  const {
    locale,
    otoProductSlug,
    customerEmail,
    couponCode,
    baseUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
    hideBump,
    passParams,
    sourceProductId,
    sessionId
  } = params;

  const missingParams: string[] = [];

  if (!customerEmail) missingParams.push('email');
  if (!couponCode) missingParams.push('coupon');

  const otoUrl = new URL(`/${locale}/checkout/${otoProductSlug}`, baseUrl);

  // Always add email if available (needed for OTO coupon validation)
  if (customerEmail) {
    otoUrl.searchParams.set('email', customerEmail);
  }
  if (couponCode) {
    otoUrl.searchParams.set('coupon', couponCode);
  }
  otoUrl.searchParams.set('oto', '1');

  // Handle hide_bump option from source product
  if (hideBump) {
    otoUrl.searchParams.set('hide_bump', 'true');
  }

  // Handle pass_params option - add additional customer data
  if (passParams) {
    if (sourceProductId) {
      otoUrl.searchParams.set('productId', sourceProductId);
    }
    if (sessionId) {
      otoUrl.searchParams.set('sessionId', sessionId);
    }
  }

  return {
    url: otoUrl.toString(),
    hasAllRequiredParams: missingParams.length === 0,
    missingParams
  };
}

/**
 * Validates that an OTO redirect URL has all required parameters
 */
export function validateOtoRedirectUrl(url: string): { valid: boolean; missingParams: string[] } {
  try {
    const urlObj = new URL(url);
    const missingParams: string[] = [];

    if (!urlObj.searchParams.get('email')) missingParams.push('email');
    if (!urlObj.searchParams.get('coupon')) missingParams.push('coupon');
    if (urlObj.searchParams.get('oto') !== '1') missingParams.push('oto');

    return {
      valid: missingParams.length === 0,
      missingParams
    };
  } catch {
    return {
      valid: false,
      missingParams: ['invalid_url']
    };
  }
}

// ============================================
// Success Redirect (non-OTO)
// ============================================

/** Params that should not be passed through to redirect URL */
const FILTERED_PARAMS = ['session_id', 'success_url', 'payment_intent'];

/**
 * Builds the success redirect URL with optional customer data params
 *
 * Handles:
 * - Relative URLs (/thank-you)
 * - Absolute URLs (https://example.com/thank-you)
 * - Domain-only URLs (example.com/thank-you)
 * - Preserves existing query params (including hide_bump)
 * - Optionally adds customer data (email, productId, sessionId)
 */
export function buildSuccessRedirectUrl(params: SuccessRedirectParams): SuccessRedirectResult {
  const {
    targetUrl,
    baseUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
    passParams = false,
    customerEmail,
    productId,
    sessionId,
    additionalParams = {}
  } = params;

  // Check if original URL has hide_bump (before any modifications)
  const hasHideBump = targetUrl.includes('hide_bump=true');

  // If not passing params, return URL as-is
  if (!passParams) {
    return {
      url: targetUrl,
      hasHideBump
    };
  }

  // Parse and build URL with params
  try {
    let urlObj: URL;

    if (targetUrl.startsWith('/')) {
      // Relative URL - use base URL
      urlObj = new URL(targetUrl, baseUrl);
    } else if (targetUrl.startsWith('http')) {
      // Absolute URL
      urlObj = new URL(targetUrl);
    } else {
      // Domain only - assume https
      urlObj = new URL(`https://${targetUrl}`);
    }

    // Add customer data params
    if (customerEmail) {
      urlObj.searchParams.set('email', customerEmail);
    }
    if (productId) {
      urlObj.searchParams.set('productId', productId);
    }
    if (sessionId) {
      urlObj.searchParams.set('sessionId', sessionId);
    }

    // Pass through additional params (filtered)
    Object.entries(additionalParams).forEach(([key, value]) => {
      if (value && !FILTERED_PARAMS.includes(key)) {
        urlObj.searchParams.set(key, value);
      }
    });

    return {
      url: urlObj.toString(),
      hasHideBump
    };
  } catch {
    // Fallback: use isSafeRedirectUrl for consistent validation across the app
    console.error('Error parsing redirect URL:', targetUrl);
    return {
      url: isSafeRedirectUrl(targetUrl) ? targetUrl : '/',
      hasHideBump
    };
  }
}

/**
 * Checks if a URL string contains hide_bump=true
 */
export function hasHideBumpParam(url: string | null | undefined): boolean {
  return url?.includes('hide_bump=true') || false;
}
