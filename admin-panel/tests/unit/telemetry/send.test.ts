import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/telemetry/identity');
vi.mock('@/lib/telemetry/collect');

import * as identity from '@/lib/telemetry/identity';
import * as collect from '@/lib/telemetry/collect';
import { postTelemetry, runTelemetryCycle } from '@/lib/telemetry/send';
import type { TelemetryEnvelope } from '@/lib/telemetry/contract';

// CONTROLLER NOTE (S5 carry-forward): use crypto.randomUUID() for instance_id /
// report_id. Zod v4's z.uuid() enforces the RFC-4122 variant nibble, so synthetic
// ids like 1111-1111-... would fail the self-validate and wrongly fail the success
// test. Real ids come from Postgres gen_random_uuid(); crypto.randomUUID() is the
// variant-valid v4 equivalent here.
const env = (): TelemetryEnvelope => ({
  schema_version: 1, project: 'sellf',
  instance_id: crypto.randomUUID(),
  report_id: crypto.randomUUID(),
  sent_at: new Date().toISOString(), identity: { license_tier: 'pro' },
  deployment: { app_version: '2026.6.19' }, metrics: { products_total: 1 },
});

const save = { ...process.env };
// clearAllMocks alongside restoreAllMocks: the auto-mocked identity/collect exports
// persist across tests, so call history (e.g. confirmSend from the success test) must
// be cleared too — restore alone only reverts implementations, not accumulated calls.
beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); process.env = { ...save }; delete process.env.SELLF_TELEMETRY_DISABLED; });
afterEach(() => { process.env = { ...save }; });

describe('postTelemetry', () => {
  it('returns true on 2xx and never throws on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
    expect(await postTelemetry(env(), 'https://telemetry.techskills.academy/v1/ingest')).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await postTelemetry(env(), 'https://telemetry.techskills.academy/v1/ingest')).toBe(false);
  });
  it('rejects an unsafe URL without throwing', async () => {
    expect(await postTelemetry(env(), 'http://127.0.0.1/i')).toBe(false);
  });
  it('uses redirect:error and POSTs JSON (SSRF + AGENTS.md rule #12)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await postTelemetry(env(), 'https://telemetry.techskills.academy/v1/ingest');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });
});

describe('runTelemetryCycle', () => {
  it('skips when disabled', async () => {
    process.env.SELLF_TELEMETRY_DISABLED = 'true';
    expect(await runTelemetryCycle()).toBe('skipped');
  });
  it('skips when not due (claim returns null)', async () => {
    vi.spyOn(identity, 'claimSend').mockResolvedValue(null);
    expect(await runTelemetryCycle()).toBe('skipped');
  });
  it('sends and confirms on success', async () => {
    vi.spyOn(identity, 'claimSend').mockResolvedValue({ instanceId: crypto.randomUUID(), reportId: crypto.randomUUID() });
    vi.spyOn(collect, 'collectMetrics').mockResolvedValue({ products_total: 1 });
    vi.spyOn(collect, 'collectDeployment').mockResolvedValue({ app_version: '2026.6.19' });
    vi.spyOn(collect, 'collectLicenseTier').mockResolvedValue('pro');
    const confirm = vi.spyOn(identity, 'confirmSend').mockResolvedValue();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
    expect(await runTelemetryCycle()).toBe('sent');
    expect(confirm).toHaveBeenCalledOnce();
  });
  it('does not confirm on a failed send', async () => {
    vi.spyOn(identity, 'claimSend').mockResolvedValue({ instanceId: crypto.randomUUID(), reportId: crypto.randomUUID() });
    vi.spyOn(collect, 'collectMetrics').mockResolvedValue({});
    vi.spyOn(collect, 'collectDeployment').mockResolvedValue({});
    vi.spyOn(collect, 'collectLicenseTier').mockResolvedValue(null);
    const confirm = vi.spyOn(identity, 'confirmSend').mockResolvedValue();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    expect(await runTelemetryCycle()).toBe('failed');
    expect(confirm).not.toHaveBeenCalled();
  });
});
