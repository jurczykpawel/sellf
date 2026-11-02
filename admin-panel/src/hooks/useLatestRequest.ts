import { useCallback, useRef } from 'react';

/**
 * Latest-wins guard for overlapping async loads (StrictMode double effects,
 * filter changes, refetch after a mutation) that can settle out of order.
 * `begin()` starts a request and returns a check that stays true only until the
 * next `begin()`.
 */
export function useLatestRequest(): () => () => boolean {
  const latestRef = useRef(0);
  return useCallback(() => {
    const id = ++latestRef.current;
    return () => id === latestRef.current;
  }, []);
}
