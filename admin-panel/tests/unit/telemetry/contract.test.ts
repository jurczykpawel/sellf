import { describe, it, expect } from 'vitest';
import { buildEnvelope, telemetryEnvelopeSchema } from '@/lib/telemetry/contract';

// Valid RFC-4122 v4 UUIDs (Zod v4's z.uuid() enforces the version + variant nibbles;
// real ids come from Postgres gen_random_uuid(), which mints v4 UUIDs).
const input = {
  instanceId: '11111111-1111-4111-8111-111111111111',
  reportId: '22222222-2222-4222-8222-222222222222',
  licenseTier: 'pro' as const,
  deployment: { app_version: '2026.6.19', runtime: 'node' },
  metrics: { products_total: 3 },
};

describe('telemetry contract', () => {
  it('builds a valid, strict envelope with no PII fields', () => {
    const env = buildEnvelope(input);
    expect(env.schema_version).toBe(1);
    expect(env.project).toBe('sellf');
    expect(env.instance_id).toBe(input.instanceId);
    expect(env.report_id).toBe(input.reportId);
    expect(env.identity).toEqual({ license_tier: 'pro' });
    expect(env).not.toHaveProperty('identity.domain_hash');
    expect(env).not.toHaveProperty('identity.license_hash');
    expect(typeof env.sent_at).toBe('string');
    expect(telemetryEnvelopeSchema.safeParse(env).success).toBe(true);
  });

  it('rejects an envelope with an unexpected top-level key', () => {
    const env = { ...buildEnvelope(input), email: 'leak@x.com' };
    expect(telemetryEnvelopeSchema.safeParse(env).success).toBe(false);
  });

  it('rejects an envelope with an unexpected key inside identity', () => {
    const env = buildEnvelope(input);
    const leaky = { ...env, identity: { ...env.identity, domain_hash: 'abc' } };
    expect(telemetryEnvelopeSchema.safeParse(leaky).success).toBe(false);
  });

  it('accepts a null license_tier', () => {
    const env = buildEnvelope({ ...input, licenseTier: null });
    expect(env.identity).toEqual({ license_tier: null });
    expect(telemetryEnvelopeSchema.safeParse(env).success).toBe(true);
  });
});
