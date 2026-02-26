/**
 * Timezone Utilities Unit Tests
 *
 * Tests for timezone conversion functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  convertLocalToUTC,
  convertUTCToLocal,
  formatUTCForDisplay,
  getUserTimezone,
  isDateInFuture,
  isCurrentlyAvailable,
  addTimezoneInfo,
} from '@/lib/timezone';

describe('Timezone Utilities', () => {
  describe('convertLocalToUTC', () => {
    it('should convert valid local datetime to UTC ISO string', () => {
      const result = convertLocalToUTC('2024-06-15T14:30');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should return empty string for empty input', () => {
      expect(convertLocalToUTC('')).toBe('');
    });

    it('should return empty string for invalid date', () => {
      expect(convertLocalToUTC('not-a-date')).toBe('');
      expect(convertLocalToUTC('2024-13-45')).toBe(''); // Invalid month/day
    });

    it('should handle null/undefined gracefully', () => {
      // @ts-expect-error Testing edge case
      expect(convertLocalToUTC(null)).toBe('');
      // @ts-expect-error Testing edge case
      expect(convertLocalToUTC(undefined)).toBe('');
    });

    it('should preserve date components', () => {
      const result = convertLocalToUTC('2024-06-15T14:30');
      const date = new Date(result);
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(5); // June is month 5 (0-indexed)
    });
  });

  describe('convertUTCToLocal', () => {
    it('should convert UTC ISO to datetime-local format', () => {
      const result = convertUTCToLocal('2024-06-15T14:30:00.000Z');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('should return empty string for empty input', () => {
      expect(convertUTCToLocal('')).toBe('');
    });

    it('should return empty string for invalid date', () => {
      expect(convertUTCToLocal('invalid')).toBe('');
    });

    it('should handle null/undefined gracefully', () => {
      // @ts-expect-error Testing edge case
      expect(convertUTCToLocal(null)).toBe('');
      // @ts-expect-error Testing edge case
      expect(convertUTCToLocal(undefined)).toBe('');
    });

    it('should handle ISO strings with timezone offset', () => {
      const result = convertUTCToLocal('2024-06-15T14:30:00+02:00');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });
  });

  describe('formatUTCForDisplay', () => {
    it('should format date for display with date components', () => {
      const result = formatUTCForDisplay('2024-06-15T14:30:00.000Z');
      expect(result).not.toBe('');
      expect(result).toContain('2024');
      expect(result).toMatch(/\d{1,2}/); // Contains day or month number
    });

    it('should return empty string for empty input', () => {
      expect(formatUTCForDisplay('')).toBe('');
    });

    it('should return empty string for invalid date', () => {
      expect(formatUTCForDisplay('invalid')).toBe('');
    });

    it('should accept custom format options', () => {
      const result = formatUTCForDisplay('2024-06-15T14:30:00.000Z', {
        year: 'numeric',
        month: 'long',
      });
      expect(result).not.toBe('');
      expect(result).toContain('2024');
      expect(result).toMatch(/june|Jun|czerw/i); // Month name in English or Polish
    });
  });

  describe('getUserTimezone', () => {
    it('should return a timezone string', () => {
      const timezone = getUserTimezone();
      expect(typeof timezone).toBe('string');
      expect(timezone.length).toBeGreaterThan(0);
    });

    it('should return IANA timezone identifier (UTC or Area/Location)', () => {
      const timezone = getUserTimezone();
      expect(timezone === 'UTC' || timezone.includes('/')).toBe(true);
    });
  });

  describe('isDateInFuture', () => {
    it('should return true for future dates', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      expect(isDateInFuture(futureDate.toISOString())).toBe(true);
    });

    it('should return false for past dates', () => {
      const pastDate = new Date('2020-01-01T00:00:00.000Z');
      expect(isDateInFuture(pastDate.toISOString())).toBe(false);
    });

    it('should return false for empty input', () => {
      expect(isDateInFuture('')).toBe(false);
    });

    it('should return false for invalid date', () => {
      expect(isDateInFuture('invalid')).toBe(false);
    });

    it('should handle null/undefined gracefully', () => {
      // @ts-expect-error Testing edge case
      expect(isDateInFuture(null)).toBe(false);
      // @ts-expect-error Testing edge case
      expect(isDateInFuture(undefined)).toBe(false);
    });
  });

  describe('isCurrentlyAvailable', () => {
    let pastDate: Date;
    let futureDate: Date;

    beforeEach(() => {
      const now = new Date();
      pastDate = new Date(now.getTime() - 86400000); // 1 day ago
      futureDate = new Date(now.getTime() + 86400000); // 1 day from now
    });

    it('should return true when no constraints', () => {
      expect(isCurrentlyAvailable(null, null)).toBe(true);
    });

    it('should return true when after availableFrom', () => {
      expect(isCurrentlyAvailable(pastDate.toISOString(), null)).toBe(true);
    });

    it('should return false when before availableFrom', () => {
      expect(isCurrentlyAvailable(futureDate.toISOString(), null)).toBe(false);
    });

    it('should return true when before availableUntil', () => {
      expect(isCurrentlyAvailable(null, futureDate.toISOString())).toBe(true);
    });

    it('should return false when after availableUntil', () => {
      expect(isCurrentlyAvailable(null, pastDate.toISOString())).toBe(false);
    });

    it('should handle both constraints', () => {
      expect(isCurrentlyAvailable(pastDate.toISOString(), futureDate.toISOString())).toBe(true);
    });

    it('should return false for invalid availableFrom', () => {
      expect(isCurrentlyAvailable('invalid', null)).toBe(false);
    });

    it('should return false for invalid availableUntil', () => {
      expect(isCurrentlyAvailable(null, 'invalid')).toBe(false);
    });
  });

  describe('addTimezoneInfo', () => {
    it('should append timezone to text', () => {
      const result = addTimezoneInfo('Start time');
      expect(result).toContain('Start time');
      expect(result).toMatch(/\(.+\)$/);
    });

    it('should include actual timezone', () => {
      const timezone = getUserTimezone();
      const result = addTimezoneInfo('Time');
      expect(result).toContain(timezone);
    });
  });
});
