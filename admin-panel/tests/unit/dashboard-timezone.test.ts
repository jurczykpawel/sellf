/** Timezone helpers behind the hourly dashboard chart ("Today" in the viewer's timezone). */
import { describe, expect, it } from 'vitest';
import { getDateInTimezone, isValidTimezone } from '@/lib/timezone';

describe('getDateInTimezone', () => {
  const justAfterMidnightInWarsaw = new Date('2026-10-25T22:30:00Z');

  it('returns the calendar day of the given timezone, not the UTC day', () => {
    expect(getDateInTimezone('Europe/Warsaw', justAfterMidnightInWarsaw)).toBe('2026-10-25');
    expect(getDateInTimezone('Asia/Tokyo', justAfterMidnightInWarsaw)).toBe('2026-10-26');
    expect(getDateInTimezone('America/Los_Angeles', justAfterMidnightInWarsaw)).toBe('2026-10-25');
  });

  it('uses UTC when no timezone is given', () => {
    expect(getDateInTimezone(undefined, new Date('2026-10-25T23:59:00Z'))).toBe('2026-10-25');
  });
});

describe('isValidTimezone', () => {
  it('accepts IANA names and rejects anything else', () => {
    expect(isValidTimezone('Europe/Warsaw')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });
});
