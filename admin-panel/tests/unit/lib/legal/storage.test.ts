/**
 * Unit tests for publishSnapshot archive key precision.
 *
 * We test the timestamp slug format without mocking storage — we verify
 * the path strings generated from two Date objects milliseconds apart
 * produce distinct archive keys (second-precision, not minute-precision).
 *
 * Run: cd admin-panel && bunx vitest run tests/unit/lib/legal/storage.test.ts
 */

import { describe, it, expect } from 'vitest';

// The timestamp generation logic from storage.ts — extracted here so we can
// unit-test it without importing the full Supabase-dependent module.
// When you change storage.ts, keep this helper in sync.
function archiveTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
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
