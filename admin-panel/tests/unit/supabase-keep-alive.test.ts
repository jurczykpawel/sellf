/**
 * Tests for the Supabase free-tier keep-alive scheduler.
 * Covers the gating logic only — the actual ping path mocks the admin client.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  startKeepAlive,
  stopKeepAlive,
  isKeepAliveRunning,
} from '@/lib/supabase/keep-alive';

const ORIGINAL_ENV = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function resetEnv() {
  for (const k of Object.keys(process.env)) {
    delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

describe('supabase keep-alive', () => {
  beforeEach(() => {
    stopKeepAlive();
    resetEnv();
  });

  afterEach(() => {
    stopKeepAlive();
    resetEnv();
  });

  it('is a no-op outside production', () => {
    setEnv({
      NODE_ENV: 'development',
      SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
      SUPABASE_URL: 'https://fake.supabase.co',
    });
    expect(startKeepAlive()).toBe(false);
    expect(isKeepAliveRunning()).toBe(false);
  });

  it('is a no-op when SUPABASE_KEEP_ALIVE=false', () => {
    setEnv({
      NODE_ENV: 'production',
      SUPABASE_KEEP_ALIVE: 'false',
      SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
      SUPABASE_URL: 'https://fake.supabase.co',
    });
    expect(startKeepAlive()).toBe(false);
    expect(isKeepAliveRunning()).toBe(false);
  });

  it('is a no-op when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    setEnv({
      NODE_ENV: 'production',
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      SUPABASE_URL: 'https://fake.supabase.co',
    });
    expect(startKeepAlive()).toBe(false);
    expect(isKeepAliveRunning()).toBe(false);
  });

  it('is a no-op when both SUPABASE_URL and NEXT_PUBLIC_SUPABASE_URL are missing', () => {
    setEnv({
      NODE_ENV: 'production',
      SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
      SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
    });
    expect(startKeepAlive()).toBe(false);
    expect(isKeepAliveRunning()).toBe(false);
  });

  it('schedules a timer when all conditions are met', () => {
    vi.useFakeTimers();
    try {
      setEnv({
        NODE_ENV: 'production',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
        SUPABASE_URL: 'https://fake.supabase.co',
      });
      expect(startKeepAlive()).toBe(true);
      expect(isKeepAliveRunning()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts NEXT_PUBLIC_SUPABASE_URL as a URL fallback', () => {
    vi.useFakeTimers();
    try {
      setEnv({
        NODE_ENV: 'production',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
        SUPABASE_URL: undefined,
        NEXT_PUBLIC_SUPABASE_URL: 'https://fake.supabase.co',
      });
      expect(startKeepAlive()).toBe(true);
      expect(isKeepAliveRunning()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is idempotent — second call returns false but does not duplicate timer', () => {
    vi.useFakeTimers();
    try {
      setEnv({
        NODE_ENV: 'production',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
        SUPABASE_URL: 'https://fake.supabase.co',
      });
      expect(startKeepAlive()).toBe(true);
      expect(startKeepAlive()).toBe(false);
      expect(isKeepAliveRunning()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stopKeepAlive clears the timer', () => {
    vi.useFakeTimers();
    try {
      setEnv({
        NODE_ENV: 'production',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
        SUPABASE_URL: 'https://fake.supabase.co',
      });
      startKeepAlive();
      expect(isKeepAliveRunning()).toBe(true);
      stopKeepAlive();
      expect(isKeepAliveRunning()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
