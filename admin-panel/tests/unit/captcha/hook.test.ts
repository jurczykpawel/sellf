// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useCaptcha } from '@/hooks/useCaptcha';

afterEach(cleanup);
it('waits for verification on the first render and after reset', () => {
  const { result } = renderHook(useCaptcha);
  expect(result.current.isLoading).toBe(true);
  expect(result.current.token).toBeNull();
  act(() => result.current.onVerify('solved'));
  expect(result.current.isLoading).toBe(false);
  expect(result.current.token).toBe('solved');
  act(() => result.current.reset());
  expect(result.current.isLoading).toBe(true);
  expect(result.current.token).toBeNull();
  expect(result.current.resetTrigger).toBe(1);
});
it('clears an expired token and ends loading after timeout or error', () => {
  const { result } = renderHook(useCaptcha);
  act(() => result.current.onVerify('old'));
  act(() => result.current.onTimeout());
  expect(result.current.token).toBeNull();
  expect(result.current.isLoading).toBe(false);
  act(() => result.current.reset());
  act(() => result.current.onError());
  expect(result.current.token).toBeNull();
  expect(result.current.isLoading).toBe(false);
});
