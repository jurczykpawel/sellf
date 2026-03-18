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

import { checkFeature } from '@/lib/license/resolve';

// ===== SYNC: ENV-ONLY CHECK =====

/**
 * Check if marketplace is enabled via environment variable.
 * Synchronous, no I/O. Use for middleware/routing decisions.
 */
export function isMarketplaceEnabled(): boolean {
  return process.env.MARKETPLACE_ENABLED === 'true';
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

  const licensed = await checkFeature('marketplace');
  if (!licensed) {
    return {
      enabled: true,
      licensed: false,
      accessible: false,
      reason: 'Sellf Marketplace license required for marketplace features',
    };
  }

  return {
    enabled: true,
    licensed: true,
    accessible: true,
  };
}
