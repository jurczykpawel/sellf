import { describe, it, expect, afterEach } from 'vitest';
import { isTelemetryEnabled, isNonDeploymentHost, assertSafeOutboundUrl } from '@/lib/telemetry/config';

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

  it('rejects non-https outbound', () => expect(() => assertSafeOutboundUrl('http://x.com/i')).toThrow());
  it('rejects loopback/private outbound', () => { expect(() => assertSafeOutboundUrl('https://127.0.0.1/i')).toThrow(); expect(() => assertSafeOutboundUrl('https://192.168.1.1/i')).toThrow(); });
  it('accepts the default https receiver', () => expect(assertSafeOutboundUrl('https://telemetry.techskills.academy/v1/ingest').hostname).toBe('telemetry.techskills.academy'));
});
