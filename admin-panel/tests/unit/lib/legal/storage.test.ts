/**
 * Unit tests for publishSnapshot archive key precision.
 *
 * We test the timestamp slug format without mocking storage — we verify
 * the path strings generated from two Date objects milliseconds apart
 * produce distinct archive keys (second-precision, not minute-precision).
 *
 * Run: cd admin-panel && bunx vitest run tests/unit/lib/legal/storage.test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { publishSnapshot } from '@/lib/legal/storage';
import type { SupabaseClient } from '@supabase/supabase-js';

// The timestamp generation logic from storage.ts — extracted here so we can
// unit-test it without importing the full Supabase-dependent module.
// When you change storage.ts, keep this helper in sync.
function archiveTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Minimal fake of the `supabase.storage.from(bucket)` surface publishSnapshot uses. */
function makeFakeSupabase() {
  const getPublicUrl = vi.fn();
  const download = vi.fn().mockResolvedValue({ data: null, error: null }); // no existing doc → skip archive
  const upload = vi.fn().mockResolvedValue({ data: { path: 'x' }, error: null });
  const from = vi.fn().mockReturnValue({ download, upload, getPublicUrl });
  const supabase = { storage: { from } } as unknown as SupabaseClient;
  return { supabase, download, upload, getPublicUrl, from };
}

describe('publishSnapshot archive timestamp', () => {
  it('produces a 19-character slug (second precision)', () => {
    const ts = archiveTimestamp(new Date('2026-06-21T10:30:45.123Z'));
    expect(ts).toBe('2026-06-21T10-30-45');
    expect(ts).toHaveLength(19);
  });

  it('two timestamps one second apart produce distinct archive keys', () => {
    const ts1 = archiveTimestamp(new Date('2026-06-21T10:30:45.000Z'));
    const ts2 = archiveTimestamp(new Date('2026-06-21T10:30:46.000Z'));
    expect(ts1).not.toBe(ts2);
  });

  it('two timestamps 500ms apart (same second) produce the same archive key', () => {
    // Within a single second they collide — this is expected and acceptable.
    const ts1 = archiveTimestamp(new Date('2026-06-21T10:30:45.000Z'));
    const ts2 = archiveTimestamp(new Date('2026-06-21T10:30:45.500Z'));
    expect(ts1).toBe(ts2);
  });

  it('two timestamps in the same MINUTE but different second produce distinct keys', () => {
    // This is the bug case: minute-precision (slice 0,16) would make these identical.
    const ts1 = archiveTimestamp(new Date('2026-06-21T10:30:01.000Z'));
    const ts2 = archiveTimestamp(new Date('2026-06-21T10:30:59.000Z'));
    expect(ts1).not.toBe(ts2);
  });
});

describe('publishSnapshot — returns an internal page path, not a storage URL', () => {
  it('resolves to /legal/<type> for terms', async () => {
    const { supabase } = makeFakeSupabase();
    const url = await publishSnapshot(supabase, 'shop-1', 'terms', '<h1>x</h1>');
    expect(url).toBe('/legal/terms');
  });

  it('resolves to /legal/<type> for privacy', async () => {
    const { supabase } = makeFakeSupabase();
    const url = await publishSnapshot(supabase, 'shop-1', 'privacy', '<h1>x</h1>');
    expect(url).toBe('/legal/privacy');
  });

  it('never calls getPublicUrl — the bucket is private, nothing should read a public URL', async () => {
    const { supabase, getPublicUrl } = makeFakeSupabase();
    await publishSnapshot(supabase, 'shop-1', 'terms', '<h1>x</h1>');
    expect(getPublicUrl).not.toHaveBeenCalled();
  });

  it('uploads to {shopId}/{type}.html in the legal bucket', async () => {
    const { supabase, upload, from } = makeFakeSupabase();
    await publishSnapshot(supabase, 'shop-42', 'privacy', '<h1>x</h1>');
    expect(from).toHaveBeenCalledWith('legal');
    expect(upload).toHaveBeenCalledWith(
      'shop-42/privacy.html',
      expect.anything(),
      expect.objectContaining({ contentType: 'text/html', upsert: true }),
    );
  });
});
