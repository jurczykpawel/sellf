import { expect, it } from 'vitest';
import { formatAdminDate } from '@/lib/timezone';
it('uses one locale-aware calendar style for payment timestamps and dates', () => {
  expect(formatAdminDate('2026-10-17T12:00:00Z', 'pl', false)).toBe('17 paź 2026');
  expect(formatAdminDate('2026-10-17T12:00:00Z', 'en', false)).toBe('Oct 17, 2026');
  expect(formatAdminDate('2026-06-25T12:00:00Z', 'pl')).toContain('25 cze 2026');
  expect(formatAdminDate(null, 'pl')).toBe('—');
  expect(formatAdminDate('invalid', 'pl')).toBe('—');
});
