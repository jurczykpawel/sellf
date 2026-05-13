/**
 * Product schemas for API v1
 */

import { z } from 'zod';
import {
  UuidSchema,
  SlugSchema,
  CurrencySchema,
  PriceSchema,
  DateTimeSchema,
  SortOrderSchema,
  PaginationQuerySchema,
} from './common';

// ============================================================================
// Content Item Schema (for product content)
// ============================================================================

export const ContentItemConfigSchema = z.object({
  embed_url: z.string().url().max(2048).optional(),
  autoplay: z.boolean().optional(),
  loop: z.boolean().optional(),
  muted: z.boolean().optional(),
  controls: z.boolean().optional(),
  download_url: z.string().url().max(2048).optional(),
  file_name: z.string().max(255).optional(),
  file_size: z.string().max(50).optional(),
  hosted_file_id: z.string().max(255).optional(),
  mime_type: z.string().max(255).optional(),
  thumbnail_url: z.string().url().max(2048).optional(),
  duration: z.string().max(50).optional(),
  access_level: z.enum(['basic', 'premium', 'vip']).optional(),
}).strict().openapi('ContentItemConfig');

export const ContentItemSchema = z.object({
  id: z.string().min(1).max(128).openapi({ example: 'item-1' }),
  type: z.enum(['video_embed', 'download_link', 'hosted_video', 'hosted_file']).openapi({ example: 'video_embed' }),
  title: z.string().min(1).max(255).openapi({ example: 'Introduction' }),
  description: z.string().max(2000).optional(),
  config: ContentItemConfigSchema,
  order: z.number().int().min(0).openapi({ example: 0 }),
  is_active: z.boolean().default(true),
}).strict().openapi('ContentItem');

export const ContentConfigSchema = z.object({
  content_items: z.array(ContentItemSchema).default([]),
}).openapi('ContentConfig');

// ============================================================================
// Product Schemas
// ============================================================================

export const ProductSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(255).openapi({ example: 'Premium Course' }),
  slug: SlugSchema,
  description: z.string().openapi({ example: 'Complete course for beginners' }),
  price: PriceSchema,
  currency: CurrencySchema,
  is_active: z.boolean().openapi({ example: true }),
  is_featured: z.boolean().openapi({ example: false }),
  icon: z.string().nullable().openapi({ example: 'https://...' }),
  content_delivery_type: z.enum(['content', 'redirect']).default('content'),
  content_config: ContentConfigSchema.nullable(),
  available_from: DateTimeSchema.nullable(),
  available_until: DateTimeSchema.nullable(),
  auto_grant_duration_days: z.number().int().nullable().openapi({ example: 365 }),
  stripe_product_id: z.string().nullable(),
  stripe_price_id: z.string().nullable(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).openapi('Product');

export type Product = z.infer<typeof ProductSchema>;

// ============================================================================
// Create Product
// ============================================================================

export const CreateProductSchema = z.object({
  name: z.string().min(1).max(255).openapi({
    description: 'Product name',
    example: 'Premium Course',
  }),
  slug: SlugSchema.openapi({
    description: 'URL-friendly identifier (must be unique)',
  }),
  description: z.string().default('').openapi({
    description: 'Product description (supports markdown)',
    example: 'Complete course for beginners',
  }),
  price: z.number().min(0).openapi({
    description: 'Price in currency units (e.g., 99.00 for 99 PLN)',
    example: 99,
  }),
  currency: CurrencySchema.default('PLN'),
  is_active: z.boolean().default(true).openapi({
    description: 'Whether product is visible and purchasable',
  }),
  is_featured: z.boolean().default(false).openapi({
    description: 'Show in featured section',
  }),
  icon: z.string().url().optional().openapi({
    description: 'Product icon URL',
  }),
  content_delivery_type: z.enum(['content', 'redirect']).default('content'),
  content_config: ContentConfigSchema.optional(),
  available_from: z.string().datetime().nullable().optional(),
  available_until: z.string().datetime().nullable().optional(),
  auto_grant_duration_days: z.number().int().min(1).nullable().optional(),
}).openapi('CreateProductRequest');

export type CreateProductInput = z.infer<typeof CreateProductSchema>;

// ============================================================================
// Update Product
// ============================================================================

export const UpdateProductSchema = CreateProductSchema.partial().openapi('UpdateProductRequest');

export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

// ============================================================================
// List Products Query
// ============================================================================

export const ListProductsQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional().openapi({
    description: 'Search in name and description',
    example: 'course',
  }),
  status: z.enum(['active', 'inactive', 'all']).default('all').openapi({
    description: 'Filter by active status',
  }),
  sort_by: z.enum(['name', 'price', 'created_at', 'updated_at']).default('created_at').openapi({
    description: 'Sort field',
  }),
  sort_order: SortOrderSchema,
}).openapi('ListProductsQuery');

export type ListProductsQuery = z.infer<typeof ListProductsQuerySchema>;

// ============================================================================
// Product Response Schemas (for OpenAPI docs)
// ============================================================================

export const ProductResponseSchema = z.object({
  success: z.literal(true),
  data: ProductSchema,
}).openapi('ProductResponse');

export const ProductListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(ProductSchema),
  pagination: z.object({
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
  }),
}).openapi('ProductListResponse');
