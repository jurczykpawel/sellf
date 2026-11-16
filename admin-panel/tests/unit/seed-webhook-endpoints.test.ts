/**
 * Seeded webhook endpoints never point at a real host (W256c, tightened in W256d). The sample endpoint
 * is active, so every local test purchase is dispatched to it; with https://webhook.site/... buyer data
 * from local runs went to a public third-party service.
 *
 * Only the `.invalid` TLD is accepted: RFC 6761 §6.4 requires resolvers to answer NXDOMAIN for it, so
 * the dispatcher's DNS guard stops before any HTTP. `example.com` and friends (RFC 2606) DO resolve to
 * public addresses, so the dispatcher would send buyer data there — the reviewer measured 1 HTTP call
 * (W256cr P2). The dispatcher probe below runs the production WebhookDispatcher with a resolver that
 * behaves per RFC 6761 (NXDOMAIN for .invalid, a public address otherwise) and counts HTTP calls.
 * @see supabase/seed.sql
 * @see src/lib/services/webhook-queue/dispatcher.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ calls: [] as string[], lookups: [] as string[] }));

vi.mock('undici', () => ({
  fetch: vi.fn(async (url: string) => { http.calls.push(url); return { ok: true, status: 200, body: new Response('').body }; }),
}));
vi.mock('@/lib/security/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/security/safe-fetch')>()),
  getSsrfSafeAgent: vi.fn(() => undefined),
}));
vi.mock('node:dns/promises', () => {
  const answer = async (hostname: string, address: string) => {
    http.lookups.push(hostname);
    if (/\.invalid$/i.test(hostname)) throw Object.assign(new Error(`queryA ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    return [address];
  };
  const resolve4 = (hostname: string) => answer(hostname, '93.184.215.14');
  const resolve6 = (hostname: string) => answer(hostname, '2606:2800:21f:cb07:6820:80da:af6b:8b2c');
  return { default: { resolve4, resolve6 }, resolve4, resolve6 };
});

import { WebhookDispatcher } from '@/lib/services/webhook-queue/dispatcher';

const seed = readFileSync(resolve(__dirname, '../../../supabase/seed.sql'), 'utf8');
/** Only RFC 6761 `.invalid`: guaranteed NXDOMAIN. */
const NEVER_RESOLVES = /(^|\.)invalid$/;
const isNeverResolvingHost = (url: string) => NEVER_RESOLVES.test(new URL(url).hostname.toLowerCase());

const inserts = seed.match(/INSERT INTO\s+(public\.)?webhook_endpoints\b[\s\S]*?;\s*$/gim) ?? [];
const seededUrls = inserts.flatMap((sql) => sql.match(/'(https?:\/\/[^']+)'/g) ?? []).map((quoted) => quoted.slice(1, -1));

beforeEach(() => { http.calls = []; http.lookups = []; });

describe('seed webhook endpoints', () => {
  it('seeds at least one sample endpoint (the checks below are not vacuous)', () => {
    expect(inserts.length).toBeGreaterThan(0);
    expect(seededUrls.length).toBeGreaterThan(0);
  });

  it('every seeded endpoint URL uses a .invalid host', () => {
    for (const url of seededUrls) expect(isNeverResolvingHost(url), url).toBe(true);
  });

  it.each(['https://example.com/hook', 'https://hooks.example.org/x', 'https://sellf.test/hook', 'https://webhook.site/abc'])(
    'the host rule refuses %s (reserved for docs, but resolvable or not guaranteed NXDOMAIN)',
    (url) => { expect(isNeverResolvingHost(url)).toBe(false); },
  );

  it('the production dispatcher makes 0 HTTP calls to every seeded endpoint', async () => {
    for (const url of seededUrls) {
      const result = await WebhookDispatcher.dispatch({ id: 'seed', url, secret: 'whsec_seed_probe' }, 'purchase.completed', { data: {} }, { attemptCount: 1 });
      expect(result, url).toMatchObject({ ok: false, httpStatus: 0 });
      expect(result.errorMessage, url).toMatch(/^Webhook URL rejected/);
    }
    expect(http.lookups.length).toBeGreaterThan(0);
    expect(http.calls).toEqual([]);
  });

  it('control: the same probe counts 1 HTTP call for example.com, so 0 above is a real measurement', async () => {
    const result = await WebhookDispatcher.dispatch({ id: 'control', url: 'https://example.com/hook', secret: 'whsec_seed_probe' }, 'purchase.completed', { data: {} }, { attemptCount: 1 });
    expect(result.httpStatus).toBe(200);
    expect(http.calls).toEqual(['https://example.com/hook']);
  });
});
