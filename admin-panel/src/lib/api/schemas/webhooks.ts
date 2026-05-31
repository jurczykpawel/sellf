/**
 * Webhook schemas for API v1
 */

import { z } from 'zod';
import {
  UuidSchema,
  DateTimeSchema,
  PaginationQuerySchema,
} from './common';

// ============================================================================
// Webhook Events
// ============================================================================

export const WebhookEventSchema = z.enum([
  'payment.completed',
  'payment.failed',
  'payment.refunded',
  'access.granted',
  'access.revoked',
  'access.expired',
  'user.created',
]).openapi('WebhookEvent');

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

// ============================================================================
// Webhook Schema
// ============================================================================

export const WebhookSchema = z.object({
  id: UuidSchema,
  url: z.string().url().openapi({ example: 'https://api.example.com/webhooks' }),
  events: z.array(WebhookEventSchema).openapi({
    example: ['payment.completed', 'access.granted'],
  }),
  is_active: z.boolean(),
  secret: z.string().optional().openapi({
    description: 'HMAC secret for signature verification (only shown once)',
  }),
  description: z.string().nullable().openapi({ example: 'Main webhook' }),
  product_filter_mode: z.enum(['all', 'selected']).openapi({
    description: 'Whether the endpoint fires for all products or only selected ones (Pro)',
    example: 'all',
  }),
  product_ids: z.array(UuidSchema).openapi({
    description: 'Products this endpoint is scoped to when product_filter_mode is "selected"',
    example: [],
  }),
  last_triggered_at: DateTimeSchema.nullable(),
  failure_count: z.number().int().openapi({ example: 0 }),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).openapi('Webhook');

export type Webhook = z.infer<typeof WebhookSchema>;

// ============================================================================
// Create Webhook
// ============================================================================

export const CreateWebhookSchema = z.object({
  url: z.string().url().openapi({
    description: 'HTTPS endpoint to receive webhook events',
    example: 'https://api.example.com/webhooks',
  }),
  events: z.array(WebhookEventSchema).min(1).openapi({
    description: 'Events to subscribe to',
  }),
  description: z.string().max(255).optional(),
  is_active: z.boolean().default(true),
  product_filter_mode: z.enum(['all', 'selected']).optional().openapi({
    description: 'Per-product scoping mode; "selected" requires a Pro license',
  }),
  product_ids: z.array(UuidSchema).optional().openapi({
    description: 'Required when product_filter_mode is "selected"',
  }),
}).openapi('CreateWebhookRequest');

export type CreateWebhookInput = z.infer<typeof CreateWebhookSchema>;

// ============================================================================
// Update Webhook
// ============================================================================

export const UpdateWebhookSchema = CreateWebhookSchema.partial().openapi('UpdateWebhookRequest');

export type UpdateWebhookInput = z.infer<typeof UpdateWebhookSchema>;

// ============================================================================
// Webhook Log
// ============================================================================

export const WebhookLogSchema = z.object({
  id: UuidSchema,
  webhook_id: UuidSchema,
  event: WebhookEventSchema,
  payload: z.record(z.string(), z.unknown()),
  response_status: z.number().int().nullable().openapi({ example: 200 }),
  response_body: z.string().nullable(),
  success: z.boolean(),
  error_message: z.string().nullable(),
  duration_ms: z.number().int().nullable().openapi({ example: 150 }),
  created_at: DateTimeSchema,
}).openapi('WebhookLog');

export type WebhookLog = z.infer<typeof WebhookLogSchema>;

// ============================================================================
// List Webhooks Query
// ============================================================================

export const ListWebhooksQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['active', 'inactive', 'all']).default('all'),
}).openapi('ListWebhooksQuery');

// ============================================================================
// Response Schemas
// ============================================================================

export const WebhookResponseSchema = z.object({
  success: z.literal(true),
  data: WebhookSchema,
}).openapi('WebhookResponse');

export const WebhookListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(WebhookSchema),
  pagination: z.object({
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
  }),
}).openapi('WebhookListResponse');
