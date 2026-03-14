/**
 * Marketplace Feature Flag
 *
 * Controls whether marketplace features are enabled.
 * Two independent conditions:
 * 1. MARKETPLACE_ENABLED=true — env var (deployment toggle)
 * 2. Sellf Pro license — existing ECDSA P-256 offline license keys
 *
 * Domain verification is mandatory: the license is tied to the domain it was
 * issued for (ECDSA-signed). Domain is read from the incoming request Host
 * header via next/headers, with SELLF_DOMAIN env var as a fallback for
 * environments where headers() is unavailable (e.g. background jobs).
 *
 * @see priv/MARKETPLACE-PLAN.md — feature gating section
 * @see src/lib/license/verify.ts — license verification
 */

import { headers } from 'next/headers';
import { validateLicense } from '@/lib/license/verify';

// ===== SYNC: ENV-ONLY CHECK =====

/**
 * Check if marketplace is enabled via environment variable.
 * Synchronous, no I/O. Use for middleware/routing decisions.
 */
export function isMarketplaceEnabled(): boolean {
  return process.env.MARKETPLACE_ENABLED === 'true';
}

// ===== DOMAIN RESOLUTION =====

/**
 * Resolve the current request domain for license verification.
 *
 * Priority:
 *   1. Host header from the incoming Next.js request (most accurate)
 *   2. SELLF_DOMAIN env var (explicit override / fallback for background jobs)
 *
 * Returns null if domain cannot be determined — callers must treat this as a
 * license failure (domain unknown = cannot verify = deny access).
 */
async function resolveCurrentDomain(): Promise<string | null> {
  // 1. Try to get the Host header from the active Next.js request
  try {
    const headersList = await headers();
    const host = headersList.get('host');
    if (host) {
      // Strip port — license is issued for hostname only (e.g. "example.com")
      return host.split(':')[0];
    }
  } catch {
    // headers() throws outside of a request context (e.g. background jobs)
  }

  // 2. Explicit env var override
  const envDomain = process.env.SELLF_DOMAIN;
  if (envDomain) {
    return envDomain.split(':')[0];
  }

  return null;
}

// ===== LICENSE CHECK =====

/**
 * Check marketplace license validity against the current request domain.
 * Async — reads domain from request headers.
 *
 * @returns true if license is valid for the current domain (or demo mode)
 */
async function checkMarketplaceLicense(): Promise<boolean> {
  // Demo mode bypasses license check (but NOT env flag)
  if (process.env.DEMO_MODE === 'true') {
    return true;
  }

  const licenseKey = process.env.SELLF_LICENSE_KEY;
  if (!licenseKey) {
    return false;
  }

  const domain = await resolveCurrentDomain();
  if (!domain) {
    // Cannot determine domain — deny access (fail secure)
    console.error('[marketplace] License check failed: cannot resolve current domain. Set SELLF_DOMAIN env var.');
    return false;
  }

  const result = validateLicense(licenseKey, domain);
  if (!result.valid) {
    console.error(`[marketplace] License invalid for domain "${domain}": ${result.error}`);
  }
  return result.valid;
}

// ===== HYBRID: ENV + LICENSE =====

/**
 * Full marketplace access check: env flag AND license (with domain verification).
 * Async — resolves domain from request headers automatically.
 * Use in Server Components, Server Actions, and API routes.
 *
 * @returns { enabled, licensed, accessible, reason }
 */
export async function checkMarketplaceAccess(): Promise<{
  enabled: boolean;
  licensed: boolean;
  accessible: boolean;
  reason?: string;
}> {
  const enabled = isMarketplaceEnabled();
  if (!enabled) {
    return {
      enabled: false,
      licensed: false,
      accessible: false,
      reason: 'Marketplace is not enabled (MARKETPLACE_ENABLED != true)',
    };
  }

  const licensed = await checkMarketplaceLicense();
  if (!licensed) {
    return {
      enabled: true,
      licensed: false,
      accessible: false,
      reason: 'Valid Sellf Pro license required for marketplace features',
    };
  }

  return {
    enabled: true,
    licensed: true,
    accessible: true,
  };
}
