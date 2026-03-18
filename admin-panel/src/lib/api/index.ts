/**
 * API v1 Utilities
 *
 * Central export for all API-related types and utilities.
 */

// Types
export {
  type ApiSuccessResponse,
  type ApiErrorResponse,
  type ApiResponse,
  type CursorPagination,
  type ErrorCode,
  ErrorCodes,
  ErrorHttpStatus,
  isApiError,
  successResponse,
  errorResponse,
} from './types';

// Middleware
export {
  type AuthMethod,
  type SessionAuthResult,
  type ApiKeyAuthResult,
  type AuthResult,
  getApiCorsHeaders,
  handleCorsPreFlight,
  jsonResponse,
  noContentResponse,
  apiError,
  authenticate,
  authenticateAdmin, // deprecated, use authenticate
  authenticatePlatformAdmin,
  requireScope,
  ApiAuthError,
  ApiValidationError,
  handleApiError,
  withAuth,
  parseJsonBody,
} from './middleware';

// Pagination
export {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  encodeCursor,
  decodeCursor,
  parseLimit,
  createPaginationResponse,
  applyCursorToQuery,
  validateCursor,
  type PaginationOptions,
} from './pagination';

// API Keys
export {
  API_SCOPES,
  SCOPE_PRESETS,
  type ApiScope,
  type ScopePreset,
  type GeneratedApiKey,
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  hasScope,
  hasAllScopes,
  hasAnyScope,
  parseApiKeyFromHeader,
  maskApiKey,
  validateScopes,
  getScopeDescription,
  isValidScope,
  enforceApiKeyScopeGate,
} from './api-keys';
