// @vitest-environment happy-dom
/**
 * Requests interrupted by leaving the page are not application errors.
 * @see src/lib/api/client.ts
 */
import { expect, it } from 'vitest';
import { ApiError, isExpectedApiError } from '@/lib/api/client';

it('treats cancellation, expired session and aborted Server Actions as expected', () => {
  expect(isExpectedApiError(new DOMException('Cancelled', 'AbortError'))).toBe(true);
  expect(isExpectedApiError(new ApiError('SESSION_EXPIRED', 'Session expired', 401))).toBe(true);
});

const unexpected = () => new Error('An unexpected response was received from the server.');

it('keeps reporting "unexpected response" (a real server error) while the page and caller are alive', () => {
  expect(isExpectedApiError(unexpected())).toBe(false);
  expect(isExpectedApiError(unexpected(), false)).toBe(false);
});

it('silences "unexpected response" and failed fetch when the caller is unmounted or the page is leaving', () => {
  expect(isExpectedApiError(unexpected(), true)).toBe(true);
  expect(isExpectedApiError(new TypeError('Failed to fetch'), true)).toBe(true);
  window.dispatchEvent(new Event('pagehide'));
  expect(isExpectedApiError(unexpected())).toBe(true);
  window.dispatchEvent(new Event('pageshow'));
});

it('treats a failed fetch as expected only while the page is being left', () => {
  const failure = new TypeError('Failed to fetch');
  expect(isExpectedApiError(failure)).toBe(false);
  window.dispatchEvent(new Event('pagehide'));
  expect(isExpectedApiError(failure)).toBe(true);
  window.dispatchEvent(new Event('pageshow'));
  expect(isExpectedApiError(failure)).toBe(false);
});

it('still reports real failures', () => {
  expect(isExpectedApiError(new ApiError('UNKNOWN_ERROR', 'boom', 500))).toBe(false);
  expect(isExpectedApiError(new Error('Database down'))).toBe(false);
});
