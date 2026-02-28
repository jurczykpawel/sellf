/**
 * API Middleware for /api/v1/*
 *
 * Provides authentication, authorization, and common utilities
 * for the public API endpoints.
 *
 * Supports TWO authentication methods:
 * 1. Session/JWT (for frontend admin panel)
 * 2. API Key (for external integrations, MCP server)
 *
 * CSRF Protection:
 * - API Key auth: immune to CSRF (custom Authorization header cannot be set by forms/links)
 * - Session/JWT auth: protected by SameSite=Lax cookies + strict CORS origin checks
 *   in Next.js middleware. Browsers block cross-origin credentialed requests unless
 *   CORS allows the origin, and SameSite prevents cookie attachment from foreign sites.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  errorResponse,
  ErrorCodes,
  ErrorHttpStatus,
} from './types';
import {
  parseApiKeyFromHeader,
  hashApiKey,
  hasScope,
  ApiScope,
  API_SCOPES,
} from './api-keys';
import { checkRateLimit } from '@/lib/rate-limiting';

/**
 * Check rate limit for API key using distributed backend (Upstash Redis or Supabase DB)
 * Returns true if request is allowed, false if rate limited
 */
async function checkApiKeyRateLimit(keyId: string, limitPerMinute: number): Promise<boolean> {
  return checkRateLimit(`api_key:${keyId}`, limitPerMinute, 1);
}

// Auth method used
export type AuthMethod = 'session' | 'api_key';

// Auth result for session-based auth
export interface SessionAuthResult {
  method: 'session';
  supabase: SupabaseClient;
  admin: {
    userId: string;
    adminId: string;
    email: string;
  };
  scopes: string[]; // Session auth has full access
}

// Auth result for API key auth
export interface ApiKeyAuthResult {
  method: 'api_key';
  supabase: SupabaseClient; // Admin client for API key auth
  admin: {
    userId: string;
    adminId: string;
    email: string | null;
  };
  apiKey: {
    id: string;
    name: string;
    scopes: string[];
    rateLimitPerMinute: number;
  };
  scopes: string[];
}

export type AuthResult = SessionAuthResult | ApiKeyAuthResult;

/**
 * CORS headers for API v1 endpoints
 */
export function getApiCorsHeaders(origin: string | null): Record<string, string> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;

  const isAllowed = origin && (
    origin === siteUrl ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:')
  );

  const headers: Record<string, string> = {
    // CORS
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    // Security hardening — prevent caching of sensitive API responses
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    // Defense-in-depth headers
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };

  // Only set Access-Control-Allow-Origin when we have a valid origin to reflect.
  // Omitting the header (instead of 'null' or '*') cleanly blocks the request
  // per CORS spec — browser won't expose the response to JS.
  if (isAllowed) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else if (siteUrl) {
    headers['Access-Control-Allow-Origin'] = siteUrl;
  }
  // If no siteUrl configured and origin not allowed: omit header entirely → CORS blocked

  return headers;
}

/**
 * Handle CORS preflight requests
 */
export function handleCorsPreFlight(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');
  return new NextResponse(null, {
    status: 200,
    headers: getApiCorsHeaders(origin),
  });
}

/**
 * Create JSON response with CORS headers
 */
export function jsonResponse<T>(
  data: T,
  request: NextRequest,
  status: number = 200
): NextResponse {
  const origin = request.headers.get('origin');
  return NextResponse.json(data, {
    status,
    headers: getApiCorsHeaders(origin),
  });
}

/**
 * Create 204 No Content response (for DELETE operations)
 */
export function noContentResponse(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');
  return new NextResponse(null, {
    status: 204,
    headers: getApiCorsHeaders(origin),
  });
}

/**
 * Create error response with appropriate status code
 */
export function apiError(
  request: NextRequest,
  code: keyof typeof ErrorCodes,
  message: string,
  details?: Record<string, string[]>
): NextResponse {
  const errorCode = ErrorCodes[code];
  const status = ErrorHttpStatus[errorCode];
  return jsonResponse(errorResponse(errorCode, message, details), request, status);
}

/**
 * Authenticate via session (JWT/cookies)
 */
async function authenticateViaSession(request: NextRequest): Promise<SessionAuthResult | null> {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user || !user.email) {
      return null;
    }

    // Check admin status
    const { data: adminRecord, error: adminError } = await supabase
      .from('admin_users')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (adminError || !adminRecord) {
      return null;
    }

    return {
      method: 'session',
      supabase,
      admin: {
        userId: user.id,
        adminId: adminRecord.id,
        email: user.email,
      },
      scopes: [API_SCOPES.FULL_ACCESS], // Session auth has full access
    };
  } catch {
    return null;
  }
}

/**
 * Authenticate via API key
 */
async function authenticateViaApiKey(request: NextRequest): Promise<ApiKeyAuthResult | null> {
  // Check for API key in Authorization header or X-API-Key header
  const authHeader = request.headers.get('authorization');
  const xApiKey = request.headers.get('x-api-key');

  const apiKey = parseApiKeyFromHeader(authHeader) || xApiKey;

  if (!apiKey) {
    return null;
  }

  const keyHash = hashApiKey(apiKey);
  const adminClient = createAdminClient();

  // Verify API key using database function
  const { data: verifyResult, error: verifyError } = await adminClient
    .rpc('verify_api_key', { p_key_hash: keyHash });

  if (verifyError) {
    console.error('Error verifying API key:', verifyError);
    return null;
  }

  if (!verifyResult || verifyResult.length === 0) {
    return null;
  }

  const keyData = verifyResult[0];

  if (!keyData.is_valid) {
    throw new ApiAuthError('INVALID_TOKEN', keyData.rejection_reason || 'Invalid API key');
  }

  // Get admin user details
  const { data: adminUser, error: adminError } = await adminClient
    .from('admin_users')
    .select('id, user_id')
    .eq('id', keyData.admin_user_id)
    .single();

  if (adminError || !adminUser) {
    throw new ApiAuthError('FORBIDDEN', 'API key owner not found');
  }

  // Get the key name for logging
  const { data: keyInfo } = await adminClient
    .from('api_keys')
    .select('name')
    .eq('id', keyData.key_id)
    .single();

  // Update last used IP
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] ||
    request.headers.get('x-real-ip') ||
    'unknown';

  await adminClient
    .from('api_keys')
    .update({ last_used_ip: clientIp })
    .eq('id', keyData.key_id);

  // Cast scopes from Json to string[]
  const scopes = Array.isArray(keyData.scopes) ? keyData.scopes as string[] : [];

  return {
    method: 'api_key',
    supabase: adminClient,
    admin: {
      userId: adminUser.user_id,
      adminId: adminUser.id,
      email: null, // Not available for API key auth
    },
    apiKey: {
      id: keyData.key_id,
      name: keyInfo?.name || 'Unknown',
      scopes,
      rateLimitPerMinute: keyData.rate_limit_per_minute || 60,
    },
    scopes,
  };
}

/**
 * Main authentication function
 *
 * Tries session auth first (for frontend), then API key auth (for external).
 * Use `requiredScopes` to enforce specific permissions.
 */
export async function authenticate(
  request: NextRequest,
  requiredScopes?: ApiScope[]
): Promise<AuthResult> {
  // Try session auth first
  const sessionAuth = await authenticateViaSession(request);
  if (sessionAuth) {
    // Session auth always has full access, but still check scopes for consistency
    if (requiredScopes && requiredScopes.length > 0) {
      // Session has full access, so this always passes
    }
    return sessionAuth;
  }

  // Try API key auth
  const apiKeyAuth = await authenticateViaApiKey(request);
  if (apiKeyAuth) {
    // Check rate limit for API key
    const rateLimitAllowed = await checkApiKeyRateLimit(
      apiKeyAuth.apiKey.id,
      apiKeyAuth.apiKey.rateLimitPerMinute
    );
    if (!rateLimitAllowed) {
      throw new ApiAuthError(
        'RATE_LIMITED',
        `Rate limit exceeded. Maximum ${apiKeyAuth.apiKey.rateLimitPerMinute} requests per minute.`
      );
    }

    // Check required scopes for API key
    if (requiredScopes && requiredScopes.length > 0) {
      for (const scope of requiredScopes) {
        if (!hasScope(apiKeyAuth.scopes, scope)) {
          throw new ApiAuthError(
            'FORBIDDEN',
            `Missing required permission: ${scope}`
          );
        }
      }
    }
    return apiKeyAuth;
  }

  // No valid auth found
  throw new ApiAuthError('UNAUTHORIZED', 'Authentication required');
}

/**
 * Backwards-compatible function for existing endpoints
 * @deprecated Use `authenticate()` with scopes instead
 */
export async function authenticateAdmin(request: NextRequest): Promise<AuthResult> {
  return authenticate(request);
}

/**
 * Check if auth result has required scope
 */
export function requireScope(auth: AuthResult, scope: ApiScope): void {
  if (!hasScope(auth.scopes, scope)) {
    throw new ApiAuthError('FORBIDDEN', `Missing required permission: ${scope}`);
  }
}

/**
 * Custom error class for API authentication errors
 */
export class ApiAuthError extends Error {
  code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_TOKEN' | 'RATE_LIMITED';

  constructor(code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID_TOKEN' | 'RATE_LIMITED', message: string) {
    super(message);
    this.code = code;
    this.name = 'ApiAuthError';
  }
}

/**
 * Custom error class for validation errors
 */
export class ApiValidationError extends Error {
  details?: Record<string, string[]>;

  constructor(message: string, details?: Record<string, string[]>) {
    super(message);
    this.details = details;
    this.name = 'ApiValidationError';
  }
}

/**
 * Handle errors in API routes
 */
export function handleApiError(error: unknown, request: NextRequest): NextResponse {
  // Handle known auth errors
  if (error instanceof ApiAuthError) {
    return apiError(request, error.code, error.message);
  }

  // Handle validation errors
  if (error instanceof ApiValidationError) {
    return apiError(request, 'VALIDATION_ERROR', error.message, error.details);
  }

  // Handle legacy error format from requireAdminApi
  if (error instanceof Error) {
    if (error.message === 'Unauthorized') {
      return apiError(request, 'UNAUTHORIZED', 'Authentication required');
    }
    if (error.message === 'Forbidden') {
      return apiError(request, 'FORBIDDEN', 'Admin access required');
    }
  }

  // Log unexpected errors — extract safe properties only to prevent log injection
  const safeMessage = error instanceof Error ? error.message : 'Unknown error';
  const safeName = error instanceof Error ? error.name : typeof error;
  console.error('[handleApiError]', safeName, safeMessage);

  return apiError(request, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

/**
 * Wrapper for API route handlers with authentication and scope checking
 */
export function withAuth<T>(
  handler: (request: NextRequest, auth: AuthResult) => Promise<NextResponse<T>>,
  requiredScopes?: ApiScope[]
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const auth = await authenticate(request, requiredScopes);
      return await handler(request, auth);
    } catch (error) {
      return handleApiError(error, request);
    }
  };
}

/**
 * Parse and validate request body as JSON
 */
export async function parseJsonBody<T>(request: NextRequest): Promise<T> {
  try {
    return await request.json();
  } catch {
    throw new ApiValidationError('Invalid JSON in request body');
  }
}
