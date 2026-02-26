/**
 * Configuration Tests
 * Quick Vitest tests to ensure environment variables are properly loaded at runtime
 * and not hardcoded from build time.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Parse .env.local file to get expected values
function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const vars: Record<string, string> = {};

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        vars[key.trim()] = valueParts.join('=').trim();
      }
    }
    return vars;
  } catch {
    return {};
  }
}

const envLocalPath = resolve(__dirname, '../../.env.local');
const envLocalExists = existsSync(envLocalPath);
const expectedEnv = envLocalExists ? parseEnvFile(envLocalPath) : {};

describe('Environment Variables Configuration', () => {
  describe('Supabase Configuration', () => {
    it('should have SUPABASE_URL defined', () => {
      expect(process.env.SUPABASE_URL).toBeDefined();
      expect(process.env.SUPABASE_URL).not.toBe('');
    });

    it('should NOT have placeholder Supabase URL', () => {
      expect(process.env.SUPABASE_URL).not.toContain('placeholder');
      expect(process.env.SUPABASE_URL).not.toBe('https://placeholder.supabase.co');
    });

    it('should have SUPABASE_ANON_KEY defined', () => {
      expect(process.env.SUPABASE_ANON_KEY).toBeDefined();
      expect(process.env.SUPABASE_ANON_KEY).not.toBe('');
    });

    it('should NOT have placeholder anon key', () => {
      expect(process.env.SUPABASE_ANON_KEY).not.toBe('placeholder-anon-key');
    });

    it('should have SUPABASE_SERVICE_ROLE_KEY defined', () => {
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeDefined();
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).not.toBe('');
    });

    it('should NOT have placeholder service role key', () => {
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).not.toBe('placeholder-service-key');
    });
  });

  describe('Stripe Configuration', () => {
    it('should have STRIPE_SECRET_KEY defined', () => {
      expect(process.env.STRIPE_SECRET_KEY).toBeDefined();
      expect(process.env.STRIPE_SECRET_KEY).not.toBe('');
    });

    it('should NOT have placeholder Stripe key', () => {
      expect(process.env.STRIPE_SECRET_KEY).not.toBe('sk_test_placeholder');
    });

    it('should have valid Stripe key format', () => {
      const key = process.env.STRIPE_SECRET_KEY;
      expect(key).toMatch(/^sk_(test|live)_/);
    });
  });

  describe('Site URL Configuration', () => {
    it('should have SITE_URL defined', () => {
      expect(process.env.SITE_URL).toBeDefined();
    });

    it('should NOT have placeholder site URL', () => {
      expect(process.env.SITE_URL).not.toContain('placeholder');
    });
  });

  describe.skipIf(!envLocalExists)('env vars match .env.local', () => {
    it('should match SUPABASE_URL from .env.local', () => {
      expect(expectedEnv.SUPABASE_URL).toBeDefined();
      expect(process.env.SUPABASE_URL).toBe(expectedEnv.SUPABASE_URL);
    });

    it('should match SUPABASE_ANON_KEY from .env.local', () => {
      expect(expectedEnv.SUPABASE_ANON_KEY).toBeDefined();
      expect(process.env.SUPABASE_ANON_KEY).toBe(expectedEnv.SUPABASE_ANON_KEY);
    });

    it('should match SUPABASE_SERVICE_ROLE_KEY from .env.local', () => {
      expect(expectedEnv.SUPABASE_SERVICE_ROLE_KEY).toBeDefined();
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe(expectedEnv.SUPABASE_SERVICE_ROLE_KEY);
    });

    it('should match STRIPE_SECRET_KEY from .env.local', () => {
      expect(expectedEnv.STRIPE_SECRET_KEY).toBeDefined();
      expect(process.env.STRIPE_SECRET_KEY).toBe(expectedEnv.STRIPE_SECRET_KEY);
    });

    it('should have SITE_URL or NEXT_PUBLIC_SITE_URL in .env.local', () => {
      const hasSiteUrl = expectedEnv.SITE_URL !== undefined || expectedEnv.NEXT_PUBLIC_SITE_URL !== undefined;
      expect(hasSiteUrl).toBe(true);
    });
  });
});

describe('Runtime Config Validation', () => {
  it('should not have any placeholder values in env', () => {
    const envVars = Object.entries(process.env);
    const placeholderVars = envVars.filter(([key, value]) =>
      value?.includes('placeholder') && !key.includes('EXAMPLE')
    );

    expect(placeholderVars).toHaveLength(0);
  });
});
