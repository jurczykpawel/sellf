/**
 * OpenAPI Registry and Spec Generator
 *
 * Uses @asteasolutions/zod-to-openapi to generate OpenAPI 3.1 spec from Zod schemas.
 */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Extend Zod with OpenAPI methods
extendZodWithOpenApi(z);

// Import all schemas
import {
  // Common
  ErrorResponseSchema,
  PaginationQuerySchema,
  UuidSchema,
  // Products
  ProductSchema,
  CreateProductSchema,
  UpdateProductSchema,
  ProductResponseSchema,
  ProductListResponseSchema,
  ListProductsQuerySchema,
  // Users
  UserSchema,
  UserAccessSchema,
  GrantAccessSchema,
  ExtendAccessSchema,
  UserResponseSchema,
  UserListResponseSchema,
  ListUsersQuerySchema,
  // Coupons
  CouponSchema,
  CreateCouponSchema,
  UpdateCouponSchema,
  CouponResponseSchema,
  CouponListResponseSchema,
  ListCouponsQuerySchema,
  // Payments
  PaymentSchema,
  PaymentRefundInputSchema,
  PaymentStatsSchema,
  PaymentResponseSchema,
  PaymentListResponseSchema,
  ListPaymentsQuerySchema,
  // Webhooks
  WebhookSchema,
  CreateWebhookSchema,
  UpdateWebhookSchema,
  WebhookLogSchema,
  WebhookResponseSchema,
  WebhookListResponseSchema,
  ListWebhooksQuerySchema,
  // API Keys
  ApiKeySchema,
  ApiScopeSchema,
  CreateApiKeySchema,
  CreateApiKeyResponseSchema,
  UpdateApiKeySchema,
  RotateApiKeySchema,
  RotateApiKeyResponseSchema,
  RevokeApiKeyQuerySchema,
  ApiKeyResponseSchema,
  ApiKeyListResponseSchema,
  ListApiKeysQuerySchema,
  // Analytics
  DashboardSchema,
  DashboardQuerySchema,
  DashboardResponseSchema,
  RevenueSchema,
  RevenueQuerySchema,
  RevenueResponseSchema,
  TopProductsSchema,
  TopProductsQuerySchema,
  TopProductsResponseSchema,
  // Refund Requests
  RefundRequestSchema,
  ProcessRefundRequestSchema,
  RefundRequestResponseSchema,
  RefundRequestListResponseSchema,
  ProcessRefundResponseSchema,
  ListRefundRequestsQuerySchema,
  // System
  SystemStatusSchema,
  SystemStatusResponseSchema,
} from './index';

// Simple success response schema for DELETE operations
const SimpleSuccessResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional().openapi({ example: 'Operation completed successfully' }),
}).openapi('SimpleSuccessResponse');

// Create registry
const registry = new OpenAPIRegistry();

// ============================================================================
// Register Security Scheme
// ============================================================================

registry.registerComponent('securitySchemes', 'ApiKeyAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'X-API-Key',
  description: 'API key authentication. Get your key from the admin panel.',
});

registry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Bearer token authentication using API key.',
});

// ============================================================================
// Register Common Schemas
// ============================================================================

registry.register('Error', ErrorResponseSchema);
registry.register('Success', SimpleSuccessResponseSchema);

// ============================================================================
// Products Endpoints
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/v1/products',
  summary: 'List products',
  description: 'Get a paginated list of products with optional filters.',
  tags: ['Products'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    query: ListProductsQuerySchema,
  },
  responses: {
    200: {
      description: 'List of products',
      content: {
        'application/json': {
          schema: ProductListResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized - invalid or missing API key',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/products',
  summary: 'Create product',
  description: 'Create a new product.',
  tags: ['Products'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateProductSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Product created successfully',
      content: {
        'application/json': {
          schema: ProductResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid input',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/products/{id}',
  summary: 'Get product',
  description: 'Get a specific product by ID.',
  tags: ['Products'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Product ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Product details',
      content: {
        'application/json': {
          schema: ProductResponseSchema,
        },
      },
    },
    404: {
      description: 'Product not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/products/{id}',
  summary: 'Update product',
  description: 'Update an existing product.',
  tags: ['Products'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Product ID' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateProductSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Product updated successfully',
      content: {
        'application/json': {
          schema: ProductResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/products/{id}',
  summary: 'Delete product',
  description: 'Delete a product (soft delete).',
  tags: ['Products'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Product ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Product deleted successfully',
      content: {
        'application/json': {
          schema: SimpleSuccessResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Users Endpoints
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/v1/users',
  summary: 'List users',
  description: 'Get a paginated list of users.',
  tags: ['Users'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    query: ListUsersQuerySchema,
  },
  responses: {
    200: {
      description: 'List of users',
      content: {
        'application/json': {
          schema: UserListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/users/{id}',
  summary: 'Get user',
  description: 'Get a specific user by ID with their product access.',
  tags: ['Users'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'User ID' }),
    }),
  },
  responses: {
    200: {
      description: 'User details with access',
      content: {
        'application/json': {
          schema: UserResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/users/{id}/access',
  summary: 'Grant access',
  description: 'Grant a user access to a product.',
  tags: ['Users'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'User ID' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: GrantAccessSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Access granted successfully',
      content: {
        'application/json': {
          schema: SimpleSuccessResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/users/{id}/access/{accessId}',
  summary: 'Extend access',
  description: 'Extend or modify user product access.',
  tags: ['Users'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'User ID' }),
      accessId: UuidSchema.openapi({ description: 'Access ID' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: ExtendAccessSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Access extended successfully',
      content: {
        'application/json': {
          schema: SimpleSuccessResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/users/{id}/access/{accessId}',
  summary: 'Revoke access',
  description: 'Revoke user access to a product.',
  tags: ['Users'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'User ID' }),
      accessId: UuidSchema.openapi({ description: 'Access ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Access revoked successfully',
      content: {
        'application/json': {
          schema: SimpleSuccessResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Coupons Endpoints
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/v1/coupons',
  summary: 'List coupons',
  description: 'Get a paginated list of coupons.',
  tags: ['Coupons'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    query: ListCouponsQuerySchema,
  },
  responses: {
    200: {
      description: 'List of coupons',
      content: {
        'application/json': {
          schema: CouponListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/coupons',
  summary: 'Create coupon',
  description: 'Create a new coupon.',
  tags: ['Coupons'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateCouponSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Coupon created successfully',
      content: {
        'application/json': {
          schema: CouponResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/coupons/{id}',
  summary: 'Get coupon',
  description: 'Get a specific coupon by ID.',
  tags: ['Coupons'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Coupon ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Coupon details',
      content: {
        'application/json': {
          schema: CouponResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/coupons/{id}',
  summary: 'Update coupon',
  description: 'Update an existing coupon.',
  tags: ['Coupons'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Coupon ID' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateCouponSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Coupon updated successfully',
      content: {
        'application/json': {
          schema: CouponResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/coupons/{id}',
  summary: 'Delete coupon',
  description: 'Delete a coupon.',
  tags: ['Coupons'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Coupon ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Coupon deleted successfully',
      content: {
        'application/json': {
          schema: SimpleSuccessResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Payments Endpoints
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/v1/payments',
  summary: 'List payments',
  description: 'Get a paginated list of payment transactions.',
  tags: ['Payments'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    query: ListPaymentsQuerySchema,
  },
  responses: {
    200: {
      description: 'List of payments',
      content: {
        'application/json': {
          schema: PaymentListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/payments/{id}',
  summary: 'Get payment',
  description: 'Get a specific payment by ID.',
  tags: ['Payments'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Payment ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Payment details',
      content: {
        'application/json': {
          schema: PaymentResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/payments/{id}/refund',
  summary: 'Refund payment',
  description: 'Process a refund for a payment (full or partial).',
  tags: ['Payments'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Payment ID' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: PaymentRefundInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Refund processed successfully',
      content: {
        'application/json': {
          schema: PaymentResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Webhooks Endpoints
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/v1/webhooks',
  summary: 'List webhooks',
  description: 'Get a list of webhook endpoints.',
  tags: ['Webhooks'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    query: ListWebhooksQuerySchema,
  },
  responses: {
    200: {
      description: 'List of webhooks',
      content: {
        'application/json': {
          schema: WebhookListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/webhooks',
  summary: 'Create webhook',
  description: 'Create a new webhook endpoint.',
  tags: ['Webhooks'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateWebhookSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Webhook created successfully',
      content: {
        'application/json': {
          schema: WebhookResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/webhooks/{id}',
  summary: 'Get webhook',
  description: 'Get a specific webhook by ID.',
  tags: ['Webhooks'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Webhook ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Webhook details',
      content: {
        'application/json': {
          schema: WebhookResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/webhooks/{id}',
  summary: 'Update webhook',
  description: 'Update an existing webhook.',
  tags: ['Webhooks'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Webhook ID' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateWebhookSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Webhook updated successfully',
      content: {
        'application/json': {
          schema: WebhookResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/webhooks/{id}',
  summary: 'Delete webhook',
  description: 'Delete a webhook endpoint.',
  tags: ['Webhooks'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Webhook ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Webhook deleted successfully',
      content: {
        'application/json': {
          schema: SimpleSuccessResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// API Keys Endpoints
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/v1/api-keys',
  summary: 'List API keys',
  description: 'Get a list of API keys (secrets are never shown).',
  tags: ['API Keys'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    query: ListApiKeysQuerySchema,
  },
  responses: {
    200: {
      description: 'List of API keys',
      content: {
        'application/json': {
          schema: ApiKeyListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/api-keys',
  summary: 'Create API key',
  description: 'Create a new API key. The secret is only shown once in the response.',
  tags: ['API Keys'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateApiKeySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'API key created successfully. Save the key immediately - it will not be shown again!',
      content: {
        'application/json': {
          schema: CreateApiKeyResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/api-keys/{id}',
  summary: 'Get API key',
  description: 'Get API key details (secret is never shown).',
  tags: ['API Keys'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'API Key ID' }),
    }),
  },
  responses: {
    200: {
      description: 'API key details',
      content: {
        'application/json': {
          schema: ApiKeyResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/api-keys/{id}',
  summary: 'Update API key',
  description: 'Update API key name, scopes, or rate limit.',
  tags: ['API Keys'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'API Key ID' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateApiKeySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'API key updated successfully',
      content: {
        'application/json': {
          schema: ApiKeyResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/api-keys/{id}',
  summary: 'Revoke API key',
  description: 'Revoke an API key (soft delete for audit trail).',
  tags: ['API Keys'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'API Key ID' }),
    }),
    query: RevokeApiKeyQuerySchema,
  },
  responses: {
    200: {
      description: 'API key revoked successfully',
      content: {
        'application/json': {
          schema: SimpleSuccessResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/api-keys/{id}/rotate',
  summary: 'Rotate API key',
  description: 'Generate a new API key with optional grace period for the old key.',
  tags: ['API Keys'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'API Key ID' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: RotateApiKeySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'API key rotated successfully. Save the new key immediately!',
      content: {
        'application/json': {
          schema: RotateApiKeyResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Analytics Endpoints
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/v1/analytics/dashboard',
  summary: 'Get dashboard',
  description: 'Get dashboard overview with key metrics.',
  tags: ['Analytics'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    query: DashboardQuerySchema,
  },
  responses: {
    200: {
      description: 'Dashboard data',
      content: {
        'application/json': {
          schema: DashboardResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/analytics/revenue',
  summary: 'Get revenue statistics',
  description: 'Get detailed revenue statistics for a time period.',
  tags: ['Analytics'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    query: RevenueQuerySchema,
  },
  responses: {
    200: {
      description: 'Revenue statistics',
      content: {
        'application/json': {
          schema: RevenueResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/analytics/top-products',
  summary: 'Get top products',
  description: 'Get best selling products ranked by revenue or sales count.',
  tags: ['Analytics'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    query: TopProductsQuerySchema,
  },
  responses: {
    200: {
      description: 'Top products list',
      content: {
        'application/json': {
          schema: TopProductsResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Refund Requests Endpoints
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/v1/refund-requests',
  summary: 'List refund requests',
  description: 'Get a paginated list of refund requests.',
  tags: ['Refund Requests'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    query: ListRefundRequestsQuerySchema,
  },
  responses: {
    200: {
      description: 'List of refund requests',
      content: {
        'application/json': {
          schema: RefundRequestListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/refund-requests/{id}',
  summary: 'Get refund request',
  description: 'Get details of a specific refund request.',
  tags: ['Refund Requests'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Refund Request ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Refund request details',
      content: {
        'application/json': {
          schema: RefundRequestResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/refund-requests/{id}',
  summary: 'Process refund request',
  description: 'Approve or reject a refund request.',
  tags: ['Refund Requests'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  request: {
    params: z.object({
      id: UuidSchema.openapi({ description: 'Refund Request ID' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: ProcessRefundRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Refund request processed',
      content: {
        'application/json': {
          schema: ProcessRefundResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// System Endpoints
// ============================================================================

registry.registerPath({
  method: 'get',
  path: '/api/v1/system/status',
  summary: 'Get system status',
  description: 'Get detailed system status including database health, counts, and version info.',
  tags: ['System'],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  responses: {
    200: {
      description: 'System status',
      content: {
        'application/json': {
          schema: SystemStatusResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Generate OpenAPI Document
// ============================================================================

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Sellf API',
      version: '1.0.0',
      description: `
# Sellf API v1

Sellf is a self-hosted platform for selling and protecting digital products.
This API allows you to manage products, users, payments, coupons, webhooks, and more.

## Authentication

All endpoints require authentication using an API key. You can create API keys in the admin panel.

### Using API Key

Include your API key in either:
- Header: \`X-API-Key: sf_live_xxx...\`
- Bearer token: \`Authorization: Bearer sf_live_xxx...\`

### Scopes

API keys can have limited scopes:
- \`*\` - Full access to all endpoints
- \`products:read\` - Read products
- \`products:write\` - Create/update/delete products
- \`users:read\` / \`users:write\` - User management
- \`coupons:read\` / \`coupons:write\` - Coupon management
- \`analytics:read\` - View analytics and reports
- \`webhooks:read\` / \`webhooks:write\` - Webhook management
- \`refund-requests:read\` / \`refund-requests:write\` - Refund request management
- \`system:read\` - View system status

## Rate Limiting

Each API key has a configurable rate limit (default: 60 requests/minute).
Rate limit headers are included in responses:
- \`X-RateLimit-Limit\` - Max requests per minute
- \`X-RateLimit-Remaining\` - Remaining requests
- \`X-RateLimit-Reset\` - When the limit resets (Unix timestamp)

## Pagination

List endpoints use cursor-based pagination:
- \`cursor\` - Pagination cursor (from previous response)
- \`limit\` - Number of items per page (default: 50, max: 100)

Response includes:
\`\`\`json
{
  "data": [...],
  "pagination": {
    "has_more": true,
    "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAyNS0wMS0xMFQxMjowMDowMFoifQ=="
  }
}
\`\`\`
      `.trim(),
      contact: {
        name: 'Sellf Support',
        url: 'https://github.com/sellf/sellf',
      },
      license: {
        name: 'AGPL-3.0',
        url: 'https://www.gnu.org/licenses/agpl-3.0.html',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local development',
      },
      {
        url: 'https://demo.sellf.app',
        description: 'Production',
      },
    ],
    tags: [
      { name: 'Products', description: 'Product management' },
      { name: 'Users', description: 'User management and access control' },
      { name: 'Payments', description: 'Payment transactions and refunds' },
      { name: 'Coupons', description: 'Coupon codes and discounts' },
      { name: 'Webhooks', description: 'Webhook endpoints for event notifications' },
      { name: 'API Keys', description: 'API key management' },
      { name: 'Analytics', description: 'Dashboard and revenue analytics' },
      { name: 'Refund Requests', description: 'Customer refund request management' },
      { name: 'System', description: 'System health and status' },
    ],
  });
}

export { registry };
