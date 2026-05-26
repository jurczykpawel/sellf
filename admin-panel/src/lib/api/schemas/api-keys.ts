/**
 * API Key schemas for API v1
 */

import { z } from 'zod';
import {
  UuidSchema,
  DateTimeSchema,
  PaginationQuerySchema,
} from './common';
import { ALL_SCOPES, WILDCARD_SCOPE } from '../api-keys';

// ============================================================================
// API Scopes
// ============================================================================

// Stored scope: every concrete value in ALL_SCOPES. The wildcard marker is
// never persisted — it is resolved to ALL_SCOPES by `expandScopes` before
// hitting the database.
export const ApiScopeSchema = z.enum(ALL_SCOPES as readonly [string, ...string[]]).openapi('ApiScope');

export type ApiScope = z.infer<typeof ApiScopeSchema>;

// Input scope: accepts either a concrete scope or the wildcard marker. Used
// only for CreateApiKey requests; backend expands the wildcard at create-time.
export const ApiScopeInputSchema = z.union([ApiScopeSchema, z.literal(WILDCARD_SCOPE)]).openapi('ApiScopeInput');

// ============================================================================
// API Key Schema
// ============================================================================

export const ApiKeySchema = z.object({
  id: UuidSchema,
  name: z.string().openapi({ example: 'Production API Key' }),
  key_prefix: z.string().openapi({
    description: 'First 12 characters of the key',
    example: 'sf_live_a1b2',
  }),
  scopes: z.array(ApiScopeSchema).openapi({
    example: ['products:read', 'users:read'],
  }),
  rate_limit_per_minute: z.number().int().openapi({ example: 60 }),
  is_active: z.boolean(),
  expires_at: DateTimeSchema.nullable(),
  last_used_at: DateTimeSchema.nullable(),
  last_used_ip: z.string().nullable().openapi({ example: '192.168.1.1' }),
  usage_count: z.number().int().openapi({ example: 1250 }),
  revoked_at: DateTimeSchema.nullable(),
  revoked_reason: z.string().nullable(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).openapi('ApiKey');

export type ApiKey = z.infer<typeof ApiKeySchema>;

// ============================================================================
// Create API Key
// ============================================================================

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100).openapi({
    description: 'Descriptive name for the API key',
    example: 'Production API Key',
  }),
  scopes: z.array(ApiScopeInputSchema).default([WILDCARD_SCOPE]).openapi({
    description: 'Permissions to grant. "*" expands to every scope known at creation time; new scopes added later are not auto-granted.',
    example: ['products:read', 'users:read'],
  }),
  rate_limit_per_minute: z.number().int().min(1).max(1000).default(60).openapi({
    description: 'Max requests per minute',
  }),
  expires_at: z.string().datetime().nullable().optional().openapi({
    description: 'When the key expires (null = never)',
  }),
}).openapi('CreateApiKeyRequest');

export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

// ============================================================================
// Create API Key Response (includes secret)
// ============================================================================

export const CreateApiKeyResponseSchema = z.object({
  success: z.literal(true),
  data: ApiKeySchema.extend({
    key: z.string().openapi({
      description: 'Full API key - ONLY shown once at creation!',
      example: 'sf_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6',
    }),
    warning: z.string().openapi({
      example: 'Save this key now - it will not be shown again!',
    }),
  }),
}).openapi('CreateApiKeyResponse');

// ============================================================================
// Update API Key
// ============================================================================

// `scopes` is intentionally NOT updatable: each key carries the snapshot
// it was issued with. To change a key's scopes, rotate or re-issue it.
export const UpdateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  rate_limit_per_minute: z.number().int().min(1).max(1000).optional(),
  is_active: z.boolean().optional(),
}).openapi('UpdateApiKeyRequest');

export type UpdateApiKeyInput = z.infer<typeof UpdateApiKeySchema>;

// ============================================================================
// Rotate API Key
// ============================================================================

export const RotateApiKeySchema = z.object({
  grace_period_hours: z.number().int().min(0).max(168).default(24).openapi({
    description: 'Hours to keep old key valid (0 = immediate revocation)',
    example: 24,
  }),
}).openapi('RotateApiKeyRequest');

export type RotateApiKeyInput = z.infer<typeof RotateApiKeySchema>;

export const RotateApiKeyResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    new_key: ApiKeySchema.extend({
      key: z.string(),
      warning: z.string(),
    }),
    old_key: z.object({
      id: UuidSchema,
      grace_until: DateTimeSchema.nullable(),
      message: z.string(),
    }),
  }),
}).openapi('RotateApiKeyResponse');

// ============================================================================
// Revoke API Key
// ============================================================================

export const RevokeApiKeyQuerySchema = z.object({
  reason: z.string().max(255).optional().openapi({
    description: 'Reason for revocation (for audit log)',
    example: 'Key compromised',
  }),
}).openapi('RevokeApiKeyQuery');

// ============================================================================
// List API Keys Query
// ============================================================================

export const ListApiKeysQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['active', 'inactive', 'revoked', 'all']).default('all'),
}).openapi('ListApiKeysQuery');

// ============================================================================
// Response Schemas
// ============================================================================

export const ApiKeyResponseSchema = z.object({
  success: z.literal(true),
  data: ApiKeySchema,
}).openapi('ApiKeyResponse');

export const ApiKeyListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(ApiKeySchema),
  pagination: z.object({
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
  }),
}).openapi('ApiKeyListResponse');
