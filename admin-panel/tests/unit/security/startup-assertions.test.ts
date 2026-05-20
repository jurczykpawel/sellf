import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertTrustedProxyConfig } from '@/lib/security/startup-assertions';

const SAVED_NODE_ENV = process.env.NODE_ENV;
const SAVED_TRUSTED_PROXY = process.env.TRUSTED_PROXY;

beforeEach(() => {
  delete process.env.TRUSTED_PROXY;
});

afterEach(() => {
  if (SAVED_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = SAVED_NODE_ENV;
  if (SAVED_TRUSTED_PROXY === undefined) delete process.env.TRUSTED_PROXY;
  else process.env.TRUSTED_PROXY = SAVED_TRUSTED_PROXY;
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
