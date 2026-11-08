import { useCallback, useEffect, useRef } from 'react';

/** Latest-wins guard shared by filtered reads and refreshes. */
export function useLatestRequest(key = ''): () => () => boolean {
  const requestRef = useRef({ key, version: 0, active: true });
  useEffect(() => {
    const state = requestRef.current;
    state.key = key;
    state.active = true;
    state.version++;
    return () => { state.active = false; state.version++; };
  }, [key]);
  return useCallback(() => {
    const state = requestRef.current;
    if (!state.active || state.key !== key) return () => false;
    const version = ++state.version;
    return () => state.active && state.key === key && version === state.version;
  }, [key]);
}
