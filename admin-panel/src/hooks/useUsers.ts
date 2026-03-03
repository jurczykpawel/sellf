/**
 * Users Hook for v1 API
 *
 * Provides a consistent interface for users operations,
 * translating between the v1 API cursor pagination and the
 * frontend's offset-based pagination UI.
 */

import { useState, useCallback, useRef } from 'react';
import { UserWithAccess } from '@/types';
import { api, ApiError } from '@/lib/api/client';

interface UseUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface UseUsersResult {
  users: UserWithAccess[];
  loading: boolean;
  error: string | null;
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    hasMore: boolean;
  };
  fetchUsers: () => Promise<void>;
}

/**
 * Hook for users list operations using v1 API
 */
export function useUsers(params: UseUsersParams = {}): UseUsersResult {
  const {
    page = 1,
    limit = 10,
    search = '',
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = params;

  const [users, setUsers] = useState<UserWithAccess[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    hasMore: false,
  });

  // Maps page number → cursor to use when fetching that page.
  // Page 1 always uses no cursor (null). Populated as pages are visited.
  const cursorMapRef = useRef<Map<number, string | null>>(new Map([[1, null]]));
  // Detects filter changes so the cursor map can be reset.
  const prevFilterKeyRef = useRef<string>('');

  /**
   * Fetch users from v1 API with cursor-based pagination.
   *
   * Translates the offset-based page param into the correct cursor by
   * tracking next_cursor values as pages are visited sequentially.
   */
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Reset cursor map when filters change so stale cursors aren't reused.
      const filterKey = `${search}|${sortBy}|${sortOrder}|${limit}`;
      if (filterKey !== prevFilterKeyRef.current) {
        cursorMapRef.current = new Map([[1, null]]);
        prevFilterKeyRef.current = filterKey;
      }

      const cursor = cursorMapRef.current.get(page) ?? null;

      const response = await api.list<UserWithAccess>('users', {
        limit: limit + 1,
        search: search || undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
        cursor: cursor || undefined,
      });

      const allUsers = response.data;
      const hasMore = allUsers.length > limit;
      const pageUsers = allUsers.slice(0, limit);

      // Store cursor for the next page so forward navigation works.
      const nextCursor = response.pagination?.next_cursor;
      if (nextCursor) {
        cursorMapRef.current.set(page + 1, nextCursor);
      }

      const total = response.pagination?.total;
      const totalPages = total
        ? Math.ceil(total / limit)
        : hasMore ? page + 1 : page;

      setUsers(pageUsers);
      setPagination({
        currentPage: page,
        totalPages,
        totalItems: total ?? 0,
        hasMore,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load users. Please try again later.');
      }
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, sortBy, sortOrder]);

  return {
    users,
    loading,
    error,
    pagination,
    fetchUsers,
  };
}
