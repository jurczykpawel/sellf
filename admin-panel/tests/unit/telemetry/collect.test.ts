import { describe, it, expect } from 'vitest';
import { collectMetrics, collectDeployment, collectLicenseTier } from '@/lib/telemetry/collect';

describe('collect', () => {
  it('collectMetrics returns non-negative numbers for all keys', async () => {
    const m = await collectMetrics();
    expect(Object.keys(m).length).toBeGreaterThan(10);
    for (const v of Object.values(m)) { expect(typeof v).toBe('number'); expect(v).toBeGreaterThanOrEqual(0); }
  });
  it('collectDeployment returns coarsened runtime + version + flags (no node_env)', async () => {
    const d = await collectDeployment();
    expect(typeof d.app_version).toBe('string');
    expect(d.runtime).toBe('node');
    expect(d.runtime_version_major).toMatch(/^\d+$/);
    expect(['<1G','1-2','2-4','4-8','8-16','16-32','32+']).toContain(d.mem_bucket);
    expect(d).not.toHaveProperty('node_env');
    expect(d).not.toHaveProperty('mem_total_mb');
    for (const f of ['stripe_mode','tax_mode','default_currency','embed_enabled','omnibus_enabled',
      'subscriptions_enabled','registration_enabled','license_keys_enabled','captcha_provider','oauth_providers_count'])
      expect(d).toHaveProperty(f);
  });
  it('collectLicenseTier returns a tier string', async () => {
    const t = await collectLicenseTier();
    expect(['free','registered','pro','business']).toContain(t);
  });
});
