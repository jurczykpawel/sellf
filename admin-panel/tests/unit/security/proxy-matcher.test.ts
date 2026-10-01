/**
 * The proxy() middleware matcher decides which requests Next.js even
 * invokes it for. A static-extension exclusion meant for pretty asset
 * URLs (e.g. a blog image) must not also skip API routes — a dynamic
 * route segment (a UUID, a filename param) can legitimately end in one
 * of those extensions, and skipping proxy() for it means the demo
 * guard, body-size cap, admin-auth gate, and CSP headers never run.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const proxySource = readFileSync(resolve(__dirname, '../../../src/proxy.ts'), 'utf-8');

function extractMatcher(source: string): string[] {
  const match = source.match(/export const config = \{\s*matcher:\s*\[([\s\S]*?)\]\s*,?\s*\}/);
  if (!match) throw new Error('Could not find config.matcher in proxy.ts');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('proxy() matcher', () => {
  const matcher = extractMatcher(proxySource);

  it('always matches /api routes regardless of extension', () => {
    expect(matcher).toContain('/api/:path*');
  });

  it('excludes the /api prefix from the static-extension-skipping catch-all pattern', () => {
    const catchAll = matcher.find((p) => p.includes('_next/static'));
    expect(catchAll).toBeDefined();
    // The negative lookahead must list "api" as an excluded prefix so that
    // pattern doesn't ALSO decide whether API routes get skipped —
    // /api/:path* above already guarantees they're always matched.
    expect(catchAll).toMatch(/\(\?!.*\bapi\b.*\)/);
  });
});
