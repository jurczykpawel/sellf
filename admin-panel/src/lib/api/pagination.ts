/**
 * Cursor-based Pagination Utilities for /api/v1/*
 *
 * Cursor pagination is more scalable than offset pagination:
 * - Consistent results even when data changes
 * - Better performance for large datasets
 * - Works well with real-time data
 */

import { CursorPagination } from './types';

// Default and max limits
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

// Cursor format: base64 encoded JSON with field value and direction
interface CursorData {
  field: string;      // Field used for ordering (e.g., 'created_at')
  value: string;      // Value at cursor position
  id: string;         // ID for tie-breaking
  direction: 'asc' | 'desc';
}

/**
 * Encode cursor data to string
 */
export function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

// Allowed field names for cursor ordering (prevent filter injection via field name)
const ALLOWED_CURSOR_FIELDS = new Set([
  'created_at', 'updated_at', 'id', 'name', 'email', 'description',
  // Users
  'user_created_at', 'last_sign_in_at', 'total_products', 'total_value',
  'last_access_granted_at', 'access_created_at',
  // Products
  'price', 'is_active', 'is_featured', 'slug',
  // Payments
  'amount', 'customer_email',
  // Coupons
  'code', 'current_usage_count',
]);

// PostgREST filter metacharacters — commas and parens can inject filter conditions
const POSTGREST_INJECTION_REGEX = /[(),]/;

/**
 * Decode cursor string to data
 */
export function decodeCursor(cursor: string): CursorData | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const data = JSON.parse(decoded);

    // Validate cursor structure
    if (
      typeof data.field !== 'string' ||
      typeof data.value !== 'string' ||
      typeof data.id !== 'string' ||
      (data.direction !== 'asc' && data.direction !== 'desc')
    ) {
      return null;
    }

    // Validate field name against allowlist (defense-in-depth against filter injection)
    if (!ALLOWED_CURSOR_FIELDS.has(data.field)) {
      return null;
    }

    // Reject id or value containing PostgREST filter metacharacters
    if (POSTGREST_INJECTION_REGEX.test(data.id) || POSTGREST_INJECTION_REGEX.test(data.value)) {
      return null;
    }

    return data as CursorData;
  } catch {
    return null;
  }
}

/**
 * Validate cursor format and return error message if invalid
 * Returns null if cursor is valid or empty, error message otherwise
 */
export function validateCursor(cursor: string | null): string | null {
  if (!cursor) return null;

  const decoded = decodeCursor(cursor);
  if (!decoded) {
    return 'Invalid cursor format';
  }

  return null;
}

/**
 * Parse and validate limit parameter
 */
export function parseLimit(limitParam: string | null): number {
  if (!limitParam) return DEFAULT_LIMIT;

  const limit = parseInt(limitParam, 10);
  if (isNaN(limit) || limit < 1) return DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) return MAX_LIMIT;

  return limit;
}

/**
 * Pagination options for custom ID field names
 */
export interface PaginationOptions {
  /** Field name used as unique identifier for tie-breaking (default: 'id') */
  idField?: string;
}

/**
 * Create pagination response from query results
 *
 * @param items - Array of items (must include limit + 1 to detect has_more)
 * @param limit - Page size limit
 * @param orderField - Field used for ordering
 * @param orderDirection - Sort direction
 * @param currentCursor - Current cursor value (for reference in response)
 * @param options - Optional configuration (e.g., custom idField)
 */
export function createPaginationResponse<T extends Record<string, unknown>>(
  items: T[],
  limit: number,
  orderField: string,
  orderDirection: 'asc' | 'desc',
  currentCursor: string | null,
  options?: PaginationOptions
): { items: T[]; pagination: CursorPagination } {
  const idField = options?.idField ?? 'id';

  // We fetch limit + 1 to check if there's more
  const hasMore = items.length > limit;
  const resultItems = hasMore ? items.slice(0, limit) : items;

  let nextCursor: string | null = null;

  if (hasMore && resultItems.length > 0) {
    const lastItem = resultItems[resultItems.length - 1];
    const fieldValue = lastItem[orderField];
    const idValue = lastItem[idField];

    if (idValue != null) {
      nextCursor = encodeCursor({
        field: orderField,
        value: String(fieldValue ?? ''),
        id: String(idValue),
        direction: orderDirection,
      });
    }
  }

  return {
    items: resultItems,
    pagination: {
      cursor: currentCursor,
      next_cursor: nextCursor,
      has_more: hasMore,
      limit,
    },
  };
}

/**
 * Apply cursor to Supabase query
 *
 * For desc order: get items WHERE (field, id) < (cursor_value, cursor_id)
 * For asc order: get items WHERE (field, id) > (cursor_value, cursor_id)
 *
 * @param query - Supabase query builder
 * @param cursor - Cursor string from previous response
 * @param orderField - Field used for ordering
 * @param orderDirection - Sort direction
 * @param options - Optional configuration (e.g., custom idField)
 */
export function applyCursorToQuery(
  query: any, // Supabase query builder
  cursor: string | null,
  orderField: string,
  orderDirection: 'asc' | 'desc',
  options?: PaginationOptions
): any {
  if (!cursor) {
    return query;
  }

  const cursorData = decodeCursor(cursor);
  if (!cursorData) {
    // Invalid cursor, ignore it
    return query;
  }

  // Validate cursor matches current query parameters
  if (cursorData.field !== orderField || cursorData.direction !== orderDirection) {
    // Cursor doesn't match current sort, ignore it
    return query;
  }

  const idField = options?.idField ?? 'id';

  // Apply cursor filter using compound comparison
  // For timestamps, we need special handling
  if (orderDirection === 'desc') {
    // Get items before cursor (older items for desc)
    query = query.or(
      `${orderField}.lt.${cursorData.value},` +
      `and(${orderField}.eq.${cursorData.value},${idField}.lt.${cursorData.id})`
    );
  } else {
    // Get items after cursor (newer items for asc)
    query = query.or(
      `${orderField}.gt.${cursorData.value},` +
      `and(${orderField}.eq.${cursorData.value},${idField}.gt.${cursorData.id})`
    );
  }

  return query;
}
