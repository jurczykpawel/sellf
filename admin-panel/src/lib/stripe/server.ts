// lib/stripe/server.ts
// Secure Stripe server configuration for Next.js Server Actions and API routes

import Stripe from 'stripe';
import { getDecryptedStripeKeyInternal, getDecryptedWebhookSecretInternal } from '@/lib/actions/stripe-config';
import { STRIPE_API_VERSION } from '@/lib/constants';
import type { StripeMode } from '@/types/stripe-config';

let stripe: Stripe | null = null;
let stripeInitPromise: Promise<Stripe> | null = null;
let stripeInitTimestamp = 0;

/** Max age of cached Stripe instance (1 hour). After key rotation the new key is picked up within this window. */
const STRIPE_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Determines the Stripe mode based on environment
 */
function getStripeMode(): StripeMode {
  // In production, use live mode; otherwise use test mode
  return process.env.NODE_ENV === 'production' ? 'live' : 'test';
}

/**
 * Get Stripe instance with automatic configuration.
 *
 * Two equal configuration methods:
 * 1. Database config (encrypted Restricted API Keys via Settings wizard) - easier for non-technical users
 * 2. .env config (STRIPE_SECRET_KEY) - preferred by developers, Docker deployments, CI/CD
 *
 * Both methods are fully supported and equal. Choose what works best for your deployment.
 *
 * Only for use in server-side code (Server Actions, API routes)
 *
 * @returns Promise<Stripe> - Initialized Stripe instance
 * @throws {Error} if Stripe is not configured
 */
export const getStripeServer = async (): Promise<Stripe> => {
  // Invalidate stale cache (e.g. after key rotation)
  if (stripe && (Date.now() - stripeInitTimestamp) >= STRIPE_CACHE_TTL_MS) {
    stripe = null;
    stripeInitPromise = null;
  }

  // Return cached instance if available
  if (stripe) return stripe;

  // Return existing initialization promise if in progress
  if (stripeInitPromise) return stripeInitPromise;

  // Create new initialization promise
  stripeInitPromise = (async () => {
    const mode = getStripeMode();

    // Priority 1: Try database configuration
    try {
      const dbKey = await getDecryptedStripeKeyInternal(mode);
      if (dbKey) {
        console.log(`[Stripe] Using database configuration (${mode} mode)`);
        stripe = new Stripe(dbKey, {
          apiVersion: STRIPE_API_VERSION,
          typescript: true,
          timeout: 15_000,
        });
        stripeInitTimestamp = Date.now();
        return stripe;
      }
    } catch (error) {
      console.warn('[Stripe] Failed to retrieve database configuration:', error);
      // Continue to fallback
    }

    // Priority 2: .env configuration (alternative method)
    const envKey = process.env.STRIPE_SECRET_KEY;
    if (envKey) {
      const actualMode = envKey.startsWith('sk_test_') ? 'test' : 'live';
      console.log(`[Stripe] Using .env configuration (${actualMode} mode)`);
      stripe = new Stripe(envKey, {
        apiVersion: STRIPE_API_VERSION,
        typescript: true,
        timeout: 15_000,
      });
      stripeInitTimestamp = Date.now();
      return stripe;
    }

    // No configuration found
    throw new Error(
      'Stripe is not configured. Please configure Stripe via Settings or set STRIPE_SECRET_KEY in .env'
    );
  })();

  return stripeInitPromise;
};

/**
 * Invalidate the cached Stripe instance immediately.
 * Call after saving new Stripe API keys in Settings.
 */
export function invalidateStripeCache(): void {
  stripe = null;
  stripeInitPromise = null;
  stripeInitTimestamp = 0;
}

/**
 * Verify webhook signature for security
 */
export const verifyWebhookSignature = async (
  body: string | Buffer,
  signature: string
): Promise<Stripe.Event> => {
  // Priority 1: DB-stored secret (set via Settings → Integrations or auto-registered webhook)
  let webhookSecret = await getDecryptedWebhookSecretInternal() ?? undefined;

  // Priority 2: env var fallback
  if (!webhookSecret) {
    webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  }

  if (!webhookSecret) {
    throw new Error(
      'Webhook secret not configured. Set STRIPE_WEBHOOK_SECRET or register the webhook via Settings.'
    );
  }

  const stripeInstance = await getStripeServer();
  return stripeInstance.webhooks.constructEvent(body, signature, webhookSecret);
};

/**
 * Checks which Stripe configuration method is currently active
 * Used to show informational banner in Settings about alternative config method
 *
 * @returns Promise<boolean> - true if using .env config, false if using database config
 */
export const isUsingEnvConfig = async (): Promise<boolean> => {
  const mode = getStripeMode();

  try {
    const dbKey = await getDecryptedStripeKeyInternal(mode);
    return !dbKey; // If no DB key, we're using env fallback
  } catch (error) {
    return true; // If error retrieving DB key, assume env fallback
  }
};

export type StripeKeySource = {
  activeSource: 'db' | 'env' | 'none'
  dbConfigured: boolean
  envConfigured: boolean
}

/**
 * Richer detection of Stripe key source: DB, ENV, or none.
 * Exposes whether both are configured so UI can show "overrides" info.
 */
export const getStripeKeySource = async (): Promise<StripeKeySource> => {
  const mode = getStripeMode();
  const envConfigured = !!process.env.STRIPE_SECRET_KEY;

  let dbConfigured = false;
  try {
    const dbKey = await getDecryptedStripeKeyInternal(mode);
    dbConfigured = !!dbKey;
  } catch {
    // DB not available — ignore
  }

  let activeSource: StripeKeySource['activeSource'] = 'none';
  if (dbConfigured) {
    activeSource = 'db';
  } else if (envConfigured) {
    activeSource = 'env';
  }

  return { activeSource, dbConfigured, envConfigured };
};
