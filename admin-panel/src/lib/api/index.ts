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

// Embed helpers
export {
  type EmbedKey,
  type EmbeddedTaxonomy,
  type EmbeddedCategory,
  type EmbeddedTag,
  parseEmbed,
  buildProductSelect,
  transformEmbeddedRelations,
  BUNDLE_ITEM_COUNT_SELECT,
  flattenBundleItemCount,
} from './embed';

// Filter helpers
export { parseCsvFilter, FILTER_MAX_VALUES, resolveFilterIds, intersectProductIdsByMembership, quoteForPostgrestOr, type ParsedFilter, type FilterTable, type MembershipFilterConfig } from './filters';

// API Keys
export {
  API_SCOPES,
  ALL_SCOPES,
  WILDCARD_SCOPE,
  SCOPE_PRESETS,
  type ApiScope,
  type WildcardScope,
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
  expandScopes,
  enforceApiKeyScopeGate,
  scopeToI18nKey,
} from './api-keys';
