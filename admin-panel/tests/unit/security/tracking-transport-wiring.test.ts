import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Wiring guard for the outbound request guard rails on the
 * tracking-destinations path. Mirrors webhook-dispatch-wiring.test.ts's
 * rationale: the pre-flight assertSafeOutboundUrl() check and the
 * connect-time getSsrfSafeAgent() dispatcher are two different,
 * complementary defenses (see that file's comment for why). This test only
 * guards against a refactor silently dropping either one.
 */
function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('Tracking destinations — outbound request guard rails', () => {
  const src = read('src/lib/tracking/destinations.ts');

  it('imports assertSafeOutboundUrl and getSsrfSafeAgent', () => {
    expect(src).toMatch(/import\s+\{\s*assertSafeOutboundUrl\s*\}\s+from\s+['"]@\/lib\/security\/outbound-url['"]/);
    expect(src).toMatch(/import\s+\{\s*getSsrfSafeAgent,\s*readBoundedText\s*\}\s+from\s+['"]@\/lib\/security\/safe-fetch['"]/);
  });

  it('calls assertSafeOutboundUrl before issuing the fetch, and passes the getSsrfSafeAgent() dispatcher to it', () => {
    const guardIdx = src.indexOf('await assertSafeOutboundUrl(url)');
    const fetchIdx = src.indexOf('undiciFetch(url,');
    const dispatcherIdx = src.indexOf('dispatcher: getSsrfSafeAgent()');

    expect(guardIdx).toBeGreaterThan(0);
    expect(fetchIdx).toBeGreaterThan(0);
    expect(dispatcherIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeLessThan(fetchIdx);
    // The dispatcher option must be part of the same postJson() request that
    // the guard protects, not some unrelated call elsewhere in the file.
    expect(dispatcherIdx).toBeGreaterThan(fetchIdx);
    expect(dispatcherIdx - fetchIdx).toBeLessThan(300);
  });

  it('never follows redirects on outbound tracking requests', () => {
    expect(src).toMatch(/redirect:\s*'error'/);
  });

  it('reads error response bodies through the bounded reader, not response.text()', () => {
    expect(src).not.toContain('response.text()');
    expect(src).toContain('readBoundedText(response, MAX_ERROR_BODY_CHARS)');
  });
});
