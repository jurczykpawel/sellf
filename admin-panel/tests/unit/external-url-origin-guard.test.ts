import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// API routes that build URLs handed to external systems (Stripe, magic links,
// webhook callbacks). They must NOT use request.nextUrl.origin — behind a
// reverse proxy that origin is the bind address (e.g. http://[::]:3333).
const EXTERNAL_URL_BUILDERS = [
  'src/app/api/create-payment-intent/route.ts',
];

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '../../', rel), 'utf-8');
}

describe('external-URL builders use getCanonicalOrigin instead of request.nextUrl.origin', () => {
  it.each(EXTERNAL_URL_BUILDERS)('%s', (path) => {
    const source = read(path);
    expect(
      source,
      `${path} still uses request.nextUrl.origin to build a URL. Stripe/etc receive that URL — bind-address shapes (http://[::]:3333) leak through. Use getCanonicalOrigin(request) from @/lib/utils/canonical-url.`,
    ).not.toMatch(/request\.nextUrl\.origin/);
    expect(source).toContain('getCanonicalOrigin');
  });
});
