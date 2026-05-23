export const RETRY_DELAYS_SECONDS: readonly number[] = [60, 300, 1800, 7200, 43200];
export const DEFAULT_MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length;

export function computeNextRetry(attemptCount: number, now: Date = new Date()): Date {
  const idx = Math.min(
    Math.max(attemptCount - 1, 0),
    RETRY_DELAYS_SECONDS.length - 1,
  );
  return new Date(now.getTime() + RETRY_DELAYS_SECONDS[idx] * 1000);
}

export function hasMoreAttempts(attemptCount: number, maxAttempts: number): boolean {
  return attemptCount < maxAttempts;
}
