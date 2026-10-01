import { DEFAULT_ECB_BASE_URL } from '@/lib/services/currencyService';

export function assertTrustedProxyConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.TRUSTED_PROXY === 'true') return;

  throw new Error(
    'Refusing to start: NODE_ENV=production but TRUSTED_PROXY is not "true". ' +
      'Set TRUSTED_PROXY=true and ensure a reverse proxy (Caddy/nginx) sits in front of Node, ' +
      'or expose Node directly to the public internet at your own risk. See .env.example.',
  );
}

/**
 * Refuse to boot in production when a flag intended only for dev/test was
 * left enabled in the runtime environment.
 *
 * E2E_MODE / DEMO_MODE both flip on password login (see runtime-config.ts);
 * either set to "true" in production opens an extra attack surface that the
 * deploy must intentionally acknowledge.
 */
export function assertNonProductionFlagsOff(): void {
  if (process.env.NODE_ENV !== 'production') return;

  if (
    process.env.E2E_MODE === 'true'
    && process.env.ALLOW_PRODUCTION_E2E_MODE !== 'true'
  ) {
    throw new Error(
      'Refusing to start: NODE_ENV=production but E2E_MODE="true". ' +
        'Unset E2E_MODE or explicitly set ALLOW_PRODUCTION_E2E_MODE="true" for a disposable test instance.',
    );
  }
  if (
    process.env.DEMO_MODE === 'true'
    && process.env.ALLOW_PRODUCTION_DEMO_MODE !== 'true'
  ) {
    throw new Error(
      'Refusing to start: NODE_ENV=production but DEMO_MODE="true". ' +
        'Unset DEMO_MODE or explicitly set ALLOW_PRODUCTION_DEMO_MODE="true" for a public demo instance.',
    );
  }
}

/**
 * Surface a misconfiguration where the runtime forgot NODE_ENV entirely.
 * Next.js defaults NODE_ENV to "production" during `next start`, but bare
 * scripts (PM2 exec, custom servers) can drop the variable; assertions
 * above silently no-op in that case, hiding real production deploys behind
 * dev-style guards. Fail loudly here with a hint.
 */
export function assertNodeEnvIsSet(): void {
  if (process.env.NODE_ENV) return;
  throw new Error(
    'Refusing to start: NODE_ENV is not set. Set NODE_ENV=production for a ' +
      'production deploy, or NODE_ENV=development locally. The other startup ' +
      'assertions short-circuit without it, hiding real prod misconfig.',
  );
}

/**
 * Refuse to boot when the checkout-mutation binding secret is missing.
 * update-payment-metadata and the session-expire path verify an HMAC over
 * the Stripe object identity; without a secret those routes return 500.
 */
export function assertCheckoutBindingSecret(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.CHECKOUT_BINDING_SECRET && process.env.CHECKOUT_BINDING_SECRET.length >= 16) {
    return;
  }
  throw new Error(
    'Refusing to start: CHECKOUT_BINDING_SECRET is not set (or too short) in production. ' +
      'Generate one with `openssl rand -base64 32` and add to .env.local before booting.',
  );
}

/**
 * Refuse to boot when the database secret-encryption key is missing or the
 * wrong shape. src/lib/services/secret-encryption.ts uses APP_ENCRYPTION_KEY
 * (or the legacy STRIPE_ENCRYPTION_KEY) to encrypt/decrypt every DB-stored
 * secret — Stripe keys, webhook signing secrets, license-issuer keys. Without
 * this check the app boots fine and only fails the first time a request
 * actually reads or writes one of those secrets. Validation mirrors
 * secret-encryption.ts's own check: present, base64, decodes to 32 bytes.
 */
export function assertAppEncryptionKey(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const key = process.env.APP_ENCRYPTION_KEY || process.env.STRIPE_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      'Refusing to start: APP_ENCRYPTION_KEY is not set in production. ' +
        'It decrypts every secret stored in the database (Stripe keys, webhook ' +
        'signing secrets, license-issuer keys). Generate one with `openssl rand ' +
        '-base64 32` and add to .env.local before booting. See .env.example.',
    );
  }

  const decoded = Buffer.from(key, 'base64');
  if (decoded.length !== 32) {
    throw new Error(
      'Refusing to start: APP_ENCRYPTION_KEY must decode to 32 bytes (256 bits) of ' +
        `base64. Decoded length: ${decoded.length} bytes. Generate a new key with ` +
        '`openssl rand -base64 32`.',
    );
  }
}

/**
 * Refuse to boot when the ECB currency provider's base URL has been
 * redirected away from the real Frankfurter host. `CURRENCY_ECB_BASE_URL`
 * exists only so the E2E suite can point `ECBProvider` (currencyService.ts)
 * at a local stub server with fixed rates; left set in production it would
 * silently feed fake exchange rates into real payment/revenue conversions.
 */
export function assertCurrencyProviderBaseUrl(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const override = process.env.CURRENCY_ECB_BASE_URL;
  if (!override || override === DEFAULT_ECB_BASE_URL) return;

  throw new Error(
    `Refusing to start: NODE_ENV=production but CURRENCY_ECB_BASE_URL is set to "${override}" ` +
      `instead of the real Frankfurter host (${DEFAULT_ECB_BASE_URL}). This exists only to point ` +
      'the currency provider at a local test stub during E2E runs; unset it for a real deploy.',
  );
}

/** Run every production startup gate in one call. */
export function assertProductionStartupConfig(): void {
  assertNodeEnvIsSet();
  assertTrustedProxyConfig();
  assertNonProductionFlagsOff();
  assertCheckoutBindingSecret();
  assertAppEncryptionKey();
  assertCurrencyProviderBaseUrl();
}
