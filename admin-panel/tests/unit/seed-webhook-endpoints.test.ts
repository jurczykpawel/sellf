/**
 * Seeded webhook endpoints never point at a real host (W256c). The sample endpoint is active, so
 * every local test purchase is dispatched to it; with https://webhook.site/... buyer data from local
 * runs went to a public third-party service. Reserved names (RFC 2606/6761) never resolve.
 * @see supabase/seed.sql
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const seed = readFileSync(resolve(__dirname, '../../../supabase/seed.sql'), 'utf8');
const RESERVED = /(^|\.)(invalid|test|example|localhost)$|^example\.(com|net|org)$/;

describe('seed webhook endpoints', () => {
  const inserts = seed.match(/INSERT INTO\s+(public\.)?webhook_endpoints\b[\s\S]*?;\s*$/gim) ?? [];

  it('seeds at least one sample endpoint (the check below is not vacuous)', () => {
    expect(inserts.length).toBeGreaterThan(0);
  });

  it('every seeded endpoint URL uses a reserved, never-resolving host', () => {
    const urls = inserts.flatMap((sql) => sql.match(/'(https?:\/\/[^']+)'/g) ?? []).map((quoted) => quoted.slice(1, -1));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(new URL(url).hostname, url).toMatch(RESERVED);
  });
});
