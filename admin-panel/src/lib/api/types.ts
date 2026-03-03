/**
 * Standardized API Response Types for /api/v1/*
 *
 * These types ensure consistent response format across all API endpoints
 * for frontend, MCP server, and external integrations.
 */

// Cursor-based pagination
export interface CursorPagination {
  cursor: string | null;      // Current cursor position
  next_cursor: string | null; // Cursor for next page (null if no more)
  has_more: boolean;          // Whether more items exist
  limit: number;              // Items per page
  total?: number;             // Total count (when available via count: 'exact')
}

// Success response with data
export interface ApiSuccessResponse<T> {
  data: T;
  pagination?: CursorPagination;
}

// Error response
export interface ApiErrorResponse {
  error: {
    code: string;           // Machine-readable error code (e.g., 'VALIDATION_ERROR')
    message: string;        // Human-readable message
    details?: Record<string, string[]>;  // Field-level errors for validation
  };
}

// Union type for API responses
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// Type guard for error responses
export function isApiError(response: ApiResponse<unknown>): response is ApiErrorResponse {
  return 'error' in response;
}

// Standard error codes
export const ErrorCodes = {
  // Authentication/Authorization
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_TOKEN: 'INVALID_TOKEN',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',

  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // Server errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// Helper to create success response
export function successResponse<T>(data: T, pagination?: CursorPagination): ApiSuccessResponse<T> {
  const response: ApiSuccessResponse<T> = { data };
  if (pagination) {
    response.pagination = pagination;
  }
  return response;
}

// Helper to create error response
export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: Record<string, string[]>
): ApiErrorResponse {
  const response: ApiErrorResponse = {
    error: { code, message }
  };
  if (details) {
    response.error.details = details;
  }
  return response;
}

// HTTP status codes mapping for error codes
export const ErrorHttpStatus: Record<ErrorCode, number> = {
  [ErrorCodes.UNAUTHORIZED]: 401,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.INVALID_TOKEN]: 401,
  [ErrorCodes.VALIDATION_ERROR]: 400,
  [ErrorCodes.INVALID_INPUT]: 400,
  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.CONFLICT]: 409,
  [ErrorCodes.ALREADY_EXISTS]: 409,
  [ErrorCodes.INTERNAL_ERROR]: 500,
  [ErrorCodes.SERVICE_UNAVAILABLE]: 503,
  [ErrorCodes.RATE_LIMITED]: 429,
};
