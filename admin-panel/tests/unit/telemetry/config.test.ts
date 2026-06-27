import { describe, it, expect, afterEach } from 'vitest';
import { isTelemetryEnabled, isNonDeploymentHost, assertSafeOutboundUrl, resolveTelemetryUrl } from '@/lib/telemetry/config';
import { DEFAULT_TELEMETRY_URL } from '@/lib/telemetry/constants';

const save = { ...process.env };
afterEach(() => { process.env = { ...save }; });

describe('telemetry config', () => {
  it('is ON by default', () => { delete process.env.SELLF_TELEMETRY_DISABLED; delete process.env.SELLF_TELEMETRY_ENABLED; expect(isTelemetryEnabled()).toBe(true); });
  it('off via DISABLED=true', () => { process.env.SELLF_TELEMETRY_DISABLED = 'true'; expect(isTelemetryEnabled()).toBe(false); });
  it('off via ENABLED=false', () => { process.env.SELLF_TELEMETRY_ENABLED = 'false'; expect(isTelemetryEnabled()).toBe(false); });

  it.each(['localhost','127.0.0.1','::1','0.0.0.0','','foo.local','bar.localhost','dev','10.1.2.3','192.168.0.5','172.16.9.9'])
    ('suppresses non-deployment host %s', (h) => expect(isNonDeploymentHost(h)).toBe(true));
  it.each(['sellf.techskills.academy','shop.example.com','8.8.8.8'])
    ('allows deployment host %s', (h) => expect(isNonDeploymentHost(h)).toBe(false));

  // 172.16.0.0–172.31.255.255 is private; 172.15.x and 172.32.x are public (boundary).
  it('treats 172.15.0.1 as a deployment host (below private range)', () => expect(isNonDeploymentHost('172.15.0.1')).toBe(false));
  it('treats 172.32.0.1 as a deployment host (above private range)', () => expect(isNonDeploymentHost('172.32.0.1')).toBe(false));
  it('treats 172.31.255.255 as non-deployment (top of private range)', () => expect(isNonDeploymentHost('172.31.255.255')).toBe(true));

  it('resolveTelemetryUrl returns the TELEMETRY_URL override when set', () => {
    process.env.TELEMETRY_URL = 'https://custom.example.com/v1/ingest';
    expect(resolveTelemetryUrl()).toBe('https://custom.example.com/v1/ingest');
  });
  it('resolveTelemetryUrl falls back to DEFAULT_TELEMETRY_URL when absent', () => {
    delete process.env.TELEMETRY_URL;
    expect(resolveTelemetryUrl()).toBe(DEFAULT_TELEMETRY_URL);
  });

  it('rejects non-https outbound', () => expect(() => assertSafeOutboundUrl('http://x.com/i')).toThrow());
  it('rejects loopback/private outbound', () => { expect(() => assertSafeOutboundUrl('https://127.0.0.1/i')).toThrow(); expect(() => assertSafeOutboundUrl('https://192.168.1.1/i')).toThrow(); });
  it('accepts the default https receiver', () => expect(assertSafeOutboundUrl('https://telemetry.techskills.academy/v1/ingest').hostname).toBe('telemetry.techskills.academy'));
});
