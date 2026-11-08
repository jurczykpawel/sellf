// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useProducts } from '@/hooks/useProducts';
import { useUsers } from '@/hooks/useUsers';
const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { list }, ApiError: class extends Error {}, isExpectedApiError: () => false }));
afterEach(() => { cleanup(); list.mockReset(); vi.clearAllMocks(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const page = (id: string) => ({ data: [{ id }], pagination: { total: 1, has_more: false, next_cursor: 'cursor-' + id } });
for (const kind of ['products', 'users'] as const) {
  const useList = (search: string) => {
    const products = useProducts({ search });
    const users = useUsers({ search });
    return kind === 'products'
      ? { fetch: products.fetchProducts, rows: products.products, loading: products.loading, error: products.error }
      : { fetch: users.fetchUsers, rows: users.users, loading: users.loading, error: users.error };
  };
  it(`${kind} retains the latest result when earlier responses arrive later`, async () => {
    const old = deferred<ReturnType<typeof page>>();
    list.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page('new'));
    const { result, rerender } = renderHook(({ search }) => useList(search), { initialProps: { search: 'old' } });
    let first!: Promise<void>;
    act(() => { first = result.current.fetch(); });
    rerender({ search: 'new' });
    await act(async () => { await result.current.fetch(); });
    await act(async () => { old.resolve(page('old')); await first; });
    expect(result.current.rows.map(row => row.id)).toEqual(['new']);
  });
  it(`${kind} ignores an earlier error while the latest request is pending`, async () => {
    const old = deferred<ReturnType<typeof page>>();
    const current = deferred<ReturnType<typeof page>>();
    list.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { result } = renderHook(() => useList('same'));
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => { first = result.current.fetch(); second = result.current.fetch(); });
    await act(async () => { old.reject(new Error('old')); await first; });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => { current.resolve(page('new')); await second; });
    expect(result.current.rows.map(row => row.id)).toEqual(['new']);
  });
}

for (const kind of ['products', 'users'] as const) {
  it(`${kind} ignores a refresh captured before the query changed`, async () => {
    list.mockResolvedValueOnce(page('new')).mockResolvedValueOnce(page('old'));
    const useList = (search: string) => {
      const products = useProducts({ search }); const users = useUsers({ search });
      return kind === 'products'
        ? { fetch: products.fetchProducts, rows: products.products, loading: products.loading }
        : { fetch: users.fetchUsers, rows: users.users, loading: users.loading };
    };
    const { result, rerender } = renderHook(({ search }) => useList(search), { initialProps: { search: 'old' } });
    const earlierRefresh = result.current.fetch;
    rerender({ search: 'new' });
    await act(async () => { await result.current.fetch(); });
    await act(async () => { await earlierRefresh(); });
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.current.rows.map(row => row.id)).toEqual(['new']);
    expect(result.current.loading).toBe(false);
  });
}
