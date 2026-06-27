/**
 * Telemetry wire-envelope contract: the single source of truth for what leaves the
 * deployment. The top-level `.strict()` (and the `.strict()` on `identity`) is the
 * anti-PII / anti-drift guard — any field not declared here (an email, a domain hash,
 * a raw host fact) fails the parse instead of silently shipping. Build the envelope
 * with `buildEnvelope`, then `telemetryEnvelopeSchema.parse(...)` before sending.
 *
 * Zod v4 notes: ids use `z.uuid()` (strict RFC-4122; real ids come from Postgres
 * `gen_random_uuid()`), timestamps use `z.iso.datetime()`, and `z.record(k, v)` takes
 * an explicit key + value type — matching the rest of the codebase's schemas.
 *
 * @see ./constants.ts — PROJECT / SCHEMA_VERSION
 * @see ./collect.ts — produces the deployment/metrics/license inputs
 */

import { z } from 'zod';

import { PROJECT, SCHEMA_VERSION } from './constants';

export const telemetryEnvelopeSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    project: z.literal(PROJECT),
    instance_id: z.uuid(),
    report_id: z.uuid(),
    sent_at: z.iso.datetime(),
    identity: z.object({ license_tier: z.string().nullable() }).strict(),
    deployment: z.record(z.string(), z.unknown()),
    metrics: z.record(z.string(), z.number()),
  })
  .strict();

export type TelemetryEnvelope = z.infer<typeof telemetryEnvelopeSchema>;

export interface EnvelopeInput {
  instanceId: string;
  reportId: string;
  licenseTier: string | null;
  deployment: Record<string, unknown>;
  metrics: Record<string, number>;
}

/** Assemble the wire envelope. Stamps `sent_at` at call time; does not validate. */
export function buildEnvelope(input: EnvelopeInput): TelemetryEnvelope {
  return {
    schema_version: SCHEMA_VERSION,
    project: PROJECT,
    instance_id: input.instanceId,
    report_id: input.reportId,
    sent_at: new Date().toISOString(),
    identity: { license_tier: input.licenseTier },
    deployment: input.deployment,
    metrics: input.metrics,
  };
}
