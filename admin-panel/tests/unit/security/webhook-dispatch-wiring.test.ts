import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Wiring guard for the runtime-portable SSRF gate on the webhook dispatch path.
 *
 * Why this test exists: the connect-time SSRF protection in src/lib/security/safe-fetch.ts
 * relies on undici's Agent.dispatch via `dispatcher: getSsrfSafeAgent()`. That hook
 * is a no-op under Bun (Agent.prototype.dispatch is undefined on Bun's bundled
 * undici), and Sellf's production runtime is Bun (see Dockerfile CMD). As a
 * runtime-portable defence, the WebhookDispatcher re-resolves the URL via
 * validateWebhookUrlAsync immediately before each fetch, so a hostname that
 * has rebinded to a private address since save-time gets blocked.
 *
 * If a future refactor drops that pre-flight call, the connect-time hook may
 * silently revert to "no protection" on the production runtime. These
 * source-level assertions catch that drift.
 *
 * (Validation moved from webhook-service.ts into webhook-queue/dispatcher.ts
 *  during the DLQ refactor; the security guarantee is preserved at the new
 *  location.)
 */

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('Webhook dispatch — runtime-portable SSRF gate', () => {
  const src = read('src/lib/services/webhook-queue/dispatcher.ts');

  it('imports validateWebhookUrlAsync', () => {
    expect(src).toMatch(/import\s+\{\s*validateWebhookUrlAsync\s*\}\s+from\s+['"]@\/lib\/validations\/webhook['"]/);
  });

  it('calls validateWebhookUrlAsync before issuing the fetch', () => {
    const guardIdx = src.indexOf('validateWebhookUrlAsync(endpoint.url)');
    const fetchIdx = src.indexOf('undiciFetch(endpoint.url');
    expect(guardIdx).toBeGreaterThan(0);
    expect(fetchIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeLessThan(fetchIdx);
  });

  it('returns a failure result (rather than continues) when the guard rejects the URL', () => {
    expect(src).toMatch(/if\s*\(!guard\.valid\)\s*\{\s*\n\s*return\s+\{[\s\S]*?ok:\s*false/);
  });

  it('WebhookService delegates to WebhookDispatcher', () => {
    const serviceSrc = read('src/lib/services/webhook-service.ts');
    expect(serviceSrc).toMatch(/WebhookDispatcher\.dispatch\(/);
  });
});
