// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useLatestRequest } from '@/hooks/useLatestRequest';
afterEach(cleanup);
it('expires reads on filter changes before another fetch starts', () => {
  const { result, rerender, unmount } = renderHook(({ key }) => useLatestRequest(key), { initialProps: { key: 'old' } });
  const old = result.current();
  expect(old()).toBe(true);
  rerender({ key: 'new' });
  expect(old()).toBe(false);
  const current = result.current();
  expect(current()).toBe(true);
  unmount();
  expect(current()).toBe(false);
});
it('keeps the scope stable through state rerenders', () => {
  const { result, rerender } = renderHook(() => useLatestRequest('same'));
  let current!: () => boolean;
  act(() => { current = result.current(); });
  rerender();
  expect(current()).toBe(true);
  result.current();
  expect(current()).toBe(false);
});

it('ignores a refresh callback captured before the filter changed', () => {
  const { result, rerender } = renderHook(({ key }) => useLatestRequest(key), { initialProps: { key: 'old' } });
  const previousBegin = result.current;
  rerender({ key: 'current' });
  const current = result.current();
  expect(previousBegin()()).toBe(false);
  expect(current()).toBe(true);
});
