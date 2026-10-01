import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertAppEncryptionKey,
  assertCheckoutBindingSecret,
  assertCurrencyProviderBaseUrl,
  assertNodeEnvIsSet,
  assertNonProductionFlagsOff,
  assertProductionStartupConfig,
  assertTrustedProxyConfig,
} from '@/lib/security/startup-assertions';

const SAVED_NODE_ENV = process.env.NODE_ENV;
const SAVED_TRUSTED_PROXY = process.env.TRUSTED_PROXY;
const SAVED_E2E_MODE = process.env.E2E_MODE;
const SAVED_DEMO_MODE = process.env.DEMO_MODE;
const SAVED_ALLOW_PRODUCTION_DEMO_MODE = process.env.ALLOW_PRODUCTION_DEMO_MODE;
const SAVED_ALLOW_PRODUCTION_E2E_MODE = process.env.ALLOW_PRODUCTION_E2E_MODE;
const SAVED_BINDING_SECRET = process.env.CHECKOUT_BINDING_SECRET;
const SAVED_APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY;
const SAVED_STRIPE_ENCRYPTION_KEY = process.env.STRIPE_ENCRYPTION_KEY;
const SAVED_CURRENCY_ECB_BASE_URL = process.env.CURRENCY_ECB_BASE_URL;

beforeEach(() => {
  delete process.env.TRUSTED_PROXY;
  delete process.env.E2E_MODE;
  delete process.env.DEMO_MODE;
  delete process.env.ALLOW_PRODUCTION_DEMO_MODE;
  delete process.env.ALLOW_PRODUCTION_E2E_MODE;
  delete process.env.CHECKOUT_BINDING_SECRET;
  delete process.env.APP_ENCRYPTION_KEY;
  delete process.env.STRIPE_ENCRYPTION_KEY;
  delete process.env.CURRENCY_ECB_BASE_URL;
});

afterEach(() => {
  if (SAVED_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = SAVED_NODE_ENV;
  if (SAVED_TRUSTED_PROXY === undefined) delete process.env.TRUSTED_PROXY;
  else process.env.TRUSTED_PROXY = SAVED_TRUSTED_PROXY;
  if (SAVED_E2E_MODE === undefined) delete process.env.E2E_MODE;
  else process.env.E2E_MODE = SAVED_E2E_MODE;
  if (SAVED_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = SAVED_DEMO_MODE;
  if (SAVED_ALLOW_PRODUCTION_DEMO_MODE === undefined) delete process.env.ALLOW_PRODUCTION_DEMO_MODE;
  else process.env.ALLOW_PRODUCTION_DEMO_MODE = SAVED_ALLOW_PRODUCTION_DEMO_MODE;
  if (SAVED_ALLOW_PRODUCTION_E2E_MODE === undefined) delete process.env.ALLOW_PRODUCTION_E2E_MODE;
  else process.env.ALLOW_PRODUCTION_E2E_MODE = SAVED_ALLOW_PRODUCTION_E2E_MODE;
  if (SAVED_BINDING_SECRET === undefined) delete process.env.CHECKOUT_BINDING_SECRET;
  else process.env.CHECKOUT_BINDING_SECRET = SAVED_BINDING_SECRET;
  if (SAVED_APP_ENCRYPTION_KEY === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = SAVED_APP_ENCRYPTION_KEY;
  if (SAVED_STRIPE_ENCRYPTION_KEY === undefined) delete process.env.STRIPE_ENCRYPTION_KEY;
  else process.env.STRIPE_ENCRYPTION_KEY = SAVED_STRIPE_ENCRYPTION_KEY;
  if (SAVED_CURRENCY_ECB_BASE_URL === undefined) delete process.env.CURRENCY_ECB_BASE_URL;
  else process.env.CURRENCY_ECB_BASE_URL = SAVED_CURRENCY_ECB_BASE_URL;
});

describe('assertTrustedProxyConfig', () => {
  it('throws when NODE_ENV=production and TRUSTED_PROXY is unset', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertTrustedProxyConfig()).toThrow(/TRUSTED_PROXY/);
  });

  it('throws when NODE_ENV=production and TRUSTED_PROXY is not "true"', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_PROXY = 'false';
    expect(() => assertTrustedProxyConfig()).toThrow(/TRUSTED_PROXY/);
  });

  it('does not throw when NODE_ENV=production and TRUSTED_PROXY=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_PROXY = 'true';
    expect(() => assertTrustedProxyConfig()).not.toThrow();
  });

  it('does not throw in development regardless of TRUSTED_PROXY', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertTrustedProxyConfig()).not.toThrow();
    process.env.TRUSTED_PROXY = 'false';
    expect(() => assertTrustedProxyConfig()).not.toThrow();
  });

  it('does not throw in test environment', () => {
    process.env.NODE_ENV = 'test';
    expect(() => assertTrustedProxyConfig()).not.toThrow();
  });
});

describe('assertNonProductionFlagsOff', () => {
  it('is a no-op outside production even with both flags set', () => {
    process.env.NODE_ENV = 'development';
    process.env.E2E_MODE = 'true';
    process.env.DEMO_MODE = 'true';
    expect(() => assertNonProductionFlagsOff()).not.toThrow();
  });

  it('throws in production when E2E_MODE=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.E2E_MODE = 'true';
    expect(() => assertNonProductionFlagsOff()).toThrow(/E2E_MODE/);
  });

  it('allows production E2E mode only with an explicit acknowledgement', () => {
    process.env.NODE_ENV = 'production';
    process.env.E2E_MODE = 'true';
    process.env.ALLOW_PRODUCTION_E2E_MODE = 'true';
    expect(() => assertNonProductionFlagsOff()).not.toThrow();
  });

  it('does not treat a non-"true" E2E acknowledgement as consent', () => {
    process.env.NODE_ENV = 'production';
    process.env.E2E_MODE = 'true';
    process.env.ALLOW_PRODUCTION_E2E_MODE = '1';
    expect(() => assertNonProductionFlagsOff()).toThrow(/ALLOW_PRODUCTION_E2E_MODE/);
  });

  it('throws in production when DEMO_MODE=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEMO_MODE = 'true';
    expect(() => assertNonProductionFlagsOff()).toThrow(/DEMO_MODE/);
  });

  it('allows production demo mode only with an explicit acknowledgement', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEMO_MODE = 'true';
    process.env.ALLOW_PRODUCTION_DEMO_MODE = 'true';
    expect(() => assertNonProductionFlagsOff()).not.toThrow();
  });

  it('passes in production when both flags are off', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertNonProductionFlagsOff()).not.toThrow();
  });
});

describe('assertNodeEnvIsSet', () => {
  it('throws with helpful message when NODE_ENV is unset', () => {
    delete process.env.NODE_ENV;
    expect(() => assertNodeEnvIsSet()).toThrow(/NODE_ENV is not set/);
  });

  it('passes when NODE_ENV is set to any non-empty value', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertNodeEnvIsSet()).not.toThrow();
  });
});

describe('assertCheckoutBindingSecret', () => {
  it('is a no-op outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertCheckoutBindingSecret()).not.toThrow();
  });

  it('throws in production when secret is unset', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertCheckoutBindingSecret()).toThrow(/CHECKOUT_BINDING_SECRET/);
  });

  it('throws in production when secret is too short', () => {
    process.env.NODE_ENV = 'production';
    process.env.CHECKOUT_BINDING_SECRET = 'short';
    expect(() => assertCheckoutBindingSecret()).toThrow(/CHECKOUT_BINDING_SECRET/);
  });

  it('passes in production with a 32-byte base64 secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.CHECKOUT_BINDING_SECRET = 'a-base64-secret-that-is-clearly-long-enough';
    expect(() => assertCheckoutBindingSecret()).not.toThrow();
  });
});

describe('assertAppEncryptionKey', () => {
  it('is a no-op outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertAppEncryptionKey()).not.toThrow();
  });

  it('throws in production when the key is unset', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertAppEncryptionKey()).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('throws in production when the key does not decode to 32 bytes', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(16, 7).toString('base64');
    expect(() => assertAppEncryptionKey()).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('passes in production with a valid 32-byte base64 key', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    expect(() => assertAppEncryptionKey()).not.toThrow();
  });

  it('accepts a legacy STRIPE_ENCRYPTION_KEY when APP_ENCRYPTION_KEY is unset', () => {
    process.env.NODE_ENV = 'production';
    process.env.STRIPE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    expect(() => assertAppEncryptionKey()).not.toThrow();
  });
});

describe('assertCurrencyProviderBaseUrl', () => {
  it('is a no-op outside production even when overridden', () => {
    process.env.NODE_ENV = 'development';
    process.env.CURRENCY_ECB_BASE_URL = 'http://127.0.0.1:3799/fake-fx';
    expect(() => assertCurrencyProviderBaseUrl()).not.toThrow();
  });

  it('passes in production when unset (real host used)', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertCurrencyProviderBaseUrl()).not.toThrow();
  });

  it('passes in production when set to the real frankfurter.dev host', () => {
    process.env.NODE_ENV = 'production';
    process.env.CURRENCY_ECB_BASE_URL = 'https://api.frankfurter.dev/v1';
    expect(() => assertCurrencyProviderBaseUrl()).not.toThrow();
  });

  it('throws in production when overridden to any other host', () => {
    process.env.NODE_ENV = 'production';
    process.env.CURRENCY_ECB_BASE_URL = 'http://127.0.0.1:3799/fake-fx';
    expect(() => assertCurrencyProviderBaseUrl()).toThrow(/CURRENCY_ECB_BASE_URL/);
  });
});

describe('assertProductionStartupConfig', () => {
  it('fails first when NODE_ENV is unset', () => {
    delete process.env.NODE_ENV;
    expect(() => assertProductionStartupConfig()).toThrow(/NODE_ENV is not set/);
  });

  it('passes when production is fully configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_PROXY = 'true';
    process.env.CHECKOUT_BINDING_SECRET = 'a-base64-secret-that-is-clearly-long-enough';
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    expect(() => assertProductionStartupConfig()).not.toThrow();
  });

  it('propagates flag failures', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_PROXY = 'true';
    process.env.DEMO_MODE = 'true';
    expect(() => assertProductionStartupConfig()).toThrow(/DEMO_MODE/);
  });

  it('rejects production without a binding secret even if other flags are right', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_PROXY = 'true';
    expect(() => assertProductionStartupConfig()).toThrow(/CHECKOUT_BINDING_SECRET/);
  });

  it('rejects production without an app encryption key even if other secrets are right', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_PROXY = 'true';
    process.env.CHECKOUT_BINDING_SECRET = 'a-base64-secret-that-is-clearly-long-enough';
    expect(() => assertProductionStartupConfig()).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('rejects production with an overridden currency provider base URL even if everything else is right', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUSTED_PROXY = 'true';
    process.env.CHECKOUT_BINDING_SECRET = 'a-base64-secret-that-is-clearly-long-enough';
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.CURRENCY_ECB_BASE_URL = 'http://127.0.0.1:3799/fake-fx';
    expect(() => assertProductionStartupConfig()).toThrow(/CURRENCY_ECB_BASE_URL/);
  });
});
