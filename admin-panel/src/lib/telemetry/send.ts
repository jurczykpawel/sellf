/**
 * Telemetry transport + orchestrated send cycle.
 *
 *  - postTelemetry()     — SSRF-guarded POST (https-only host guard + redirect:'error',
 *                          AGENTS.md rule #12), 10s timeout, one retry. Never throws.
 *  - runTelemetryCycle() — claim (sole DB gate) -> collect -> build -> self-validate
 *                          against the strict contract -> post -> confirm. Never throws;
 *                          any failure degrades to 'failed'/'skipped' with no payload or
 *                          secret in the log.
 *
 * @see ./config.ts — isTelemetryEnabled / assertSafeOutboundUrl / resolveTelemetryUrl
 * @see ./identity.ts — claimSend / confirmSend (atomic claim-then-confirm)
 * @see ./collect.ts — collectMetrics / collectDeployment / collectLicenseTier
 * @see ./contract.ts — buildEnvelope / telemetryEnvelopeSchema (anti-PII / anti-drift)
 */

import { assertSafeOutboundUrl, isTelemetryEnabled, resolveTelemetryUrl } from './config';
import { RETRY_LEASE_MS, SEND_WINDOW_MS } from './constants';
import { claimSend, confirmSend } from './identity';
import { collectDeployment, collectLicenseTier, collectMetrics } from './collect';
import { buildEnvelope, telemetryEnvelopeSchema, type TelemetryEnvelope } from './contract';

/** POST once with a 10s timeout, no redirects; one retry. Never throws. Returns true on 2xx. */
export async function postTelemetry(env: TelemetryEnvelope, rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = assertSafeOutboundUrl(rawUrl);
  } catch {
    return false;
  }
  const attempt = async (): Promise<boolean> => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(env),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  if (await attempt()) return true;
  await new Promise((r) => setTimeout(r, 2000));
  return attempt();
}

export async function runTelemetryCycle(): Promise<'sent' | 'skipped' | 'failed'> {
  if (!isTelemetryEnabled()) return 'skipped';
  try {
    const claim = await claimSend(SEND_WINDOW_MS, RETRY_LEASE_MS);
    if (!claim) return 'skipped';

    const [metrics, deployment, licenseTier] = await Promise.all([
      collectMetrics(),
      collectDeployment(),
      collectLicenseTier(),
    ]);
    const envelope = buildEnvelope({
      instanceId: claim.instanceId,
      reportId: claim.reportId,
      licenseTier,
      deployment,
      metrics,
    });

    // Self-validate: refuse to send anything that drifts from the contract.
    const validation = telemetryEnvelopeSchema.safeParse(envelope);
    if (!validation.success) {
      // Log only the offending field paths — never any values/payload.
      const keys = validation.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
      console.warn(`[telemetry] envelope failed self-validation: ${keys}`);
      return 'failed';
    }

    const ok = await postTelemetry(envelope, resolveTelemetryUrl());
    if (!ok) return 'failed';
    await confirmSend();
    return 'sent';
  } catch (err) {
    console.warn(`[telemetry] cycle error: ${err instanceof Error ? err.message : 'unknown'}`);
    return 'failed';
  }
}
