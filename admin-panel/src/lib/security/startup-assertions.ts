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

  if (process.env.E2E_MODE === 'true') {
    throw new Error(
      'Refusing to start: NODE_ENV=production but E2E_MODE="true". ' +
        'Unset E2E_MODE before deploying to a production environment.',
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

/** Run every production startup gate in one call. */
export function assertProductionStartupConfig(): void {
  assertNodeEnvIsSet();
  assertTrustedProxyConfig();
  assertNonProductionFlagsOff();
  assertCheckoutBindingSecret();
}
