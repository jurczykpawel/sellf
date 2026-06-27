import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { startTelemetry, stopTelemetry, isTelemetryRunning } from '@/lib/telemetry/scheduler';

const save = { ...process.env };
beforeEach(() => {
  process.env = { ...save };
  process.env.NODE_ENV = 'production';
  delete process.env.SELLF_TELEMETRY_DISABLED;
  // Deterministic deployment host so arming doesn't depend on the developer's
  // .env.local (which sets localhost). hostFromEnv() reads SITE_URL first.
  process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com';
  delete process.env.NEXT_PUBLIC_BASE_URL;
  delete process.env.MAIN_DOMAIN;
});
afterEach(() => { stopTelemetry(); process.env = { ...save }; });

describe('telemetry scheduler', () => {
  it('arms once and is idempotent', () => {
    expect(startTelemetry()).toBe(true);
    expect(startTelemetry()).toBe(false);
    expect(isTelemetryRunning()).toBe(true);
  });
  it('does not arm outside production', () => { process.env.NODE_ENV = 'development'; expect(startTelemetry()).toBe(false); });
  it('does not arm when disabled', () => { process.env.SELLF_TELEMETRY_DISABLED = 'true'; expect(startTelemetry()).toBe(false); });
  it('does not arm on a non-deployment host', () => { process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'; expect(startTelemetry()).toBe(false); });
});
