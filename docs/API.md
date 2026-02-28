# REST API v1

Sellf provides a full REST API for managing products, users, payments, coupons, webhooks, and more. All endpoints are under `/api/v1/`.

**Base URL:** `https://your-domain.com/api/v1`

**Features:**
- 60+ endpoints covering all admin operations
- Fine-grained API keys with 13 permission scopes
- Zero-downtime key rotation with grace period
- Per-key rate limiting (1–1000 req/min)
- Cursor-based pagination
- OpenAPI 3.1 specification

---

## Quick Start

**1. Create an API key** in Settings → API Keys.

**2. Make your first request:**

```bash
curl https://your-domain.com/api/v1/products \
  -H "Authorization: Bearer sf_live_your_key_here"
```

**3. Response:**

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "My Product",
      "slug": "my-product",
      "price": 2900,
      "currency": "USD",
      "is_active": true
    }
  ],
  "pagination": {
    "cursor": null,
    "next_cursor": "eyJpZCI6Ii4uLiJ9",
    "has_more": true,
    "limit": 20
  }
}
```

---

## Authentication

Two methods are supported:

### API Key (recommended for integrations)

Pass the key in the `Authorization` header:

```bash
curl https://your-domain.com/api/v1/products \
  -H "Authorization: Bearer sf_live_a1b2c3d4..."
```

Or use the `X-API-Key` header:

```bash
curl https://your-domain.com/api/v1/products \
  -H "X-API-Key: sf_live_a1b2c3d4..."
```

### Session (admin panel)

The admin panel uses HTTP-only session cookies (Supabase Auth). Session auth grants full access to all endpoints.

### Error responses

| HTTP Status | Error Code | Meaning |
|-------------|------------|---------|
| 401 | `UNAUTHORIZED` | No authentication provided |
| 401 | `INVALID_TOKEN` | Key is invalid, expired, or revoked |
| 403 | `FORBIDDEN` | Key lacks required scope |
| 429 | `RATE_LIMITED` | Too many requests |

---

## API Keys

### Key format

| Prefix | Environment | Example |
|--------|-------------|---------|
| `sf_live_` | Production | `sf_live_a1b2c3d4e5f6...` (72 chars total) |
| `sf_test_` | Testing | `sf_test_a1b2c3d4e5f6...` (72 chars total) |

### Security

- Keys are **SHA-256 hashed** before storage — plaintext is never saved
- The full key is returned **only once** at creation time
- Hash comparison uses **timing-safe comparison** to prevent timing attacks
- The `key_prefix` (first 12 chars) is stored for display: `sf_live_a1b2`

### Creating a key

```bash
curl -X POST https://your-domain.com/api/v1/api-keys \
  -H "Cookie: <session>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI/CD Pipeline",
    "scopes": ["products:read", "products:write"],
    "rate_limit_per_minute": 120
  }'
```

Response (key shown only once):

```json
{
  "data": {
    "id": "...",
    "name": "CI/CD Pipeline",
    "key": "sf_live_a1b2c3d4e5f6...",
    "key_prefix": "sf_live_a1b2",
    "scopes": ["products:read", "products:write"],
    "rate_limit_per_minute": 120,
    "created_at": "2026-02-28T12:00:00Z"
  }
}
```

> **Note:** API key management endpoints (`/api/v1/api-keys/*`) require session auth — you cannot create keys using another key.

---

## Scopes & Permissions

Each API key has a `scopes` array that controls what it can access.

### Available scopes

| Scope | Description |
|-------|-------------|
| `products:read` | View products |
| `products:write` | Create, update, delete products |
| `users:read` | View users and access records |
| `users:write` | Manage user access (grant, revoke, extend) |
| `coupons:read` | View coupons |
| `coupons:write` | Create, update, delete coupons |
| `analytics:read` | View analytics, reports, and payment data |
| `webhooks:read` | View webhook configurations |
| `webhooks:write` | Manage webhooks (create, update, delete, test) |
| `refund-requests:read` | View refund requests |
| `refund-requests:write` | Process refund requests |
| `system:read` | View system status and update info |
| `*` | Full access to all resources |

### Write implies read

A key with `products:write` automatically has `products:read` permission. You don't need to include both.

### Presets

Common scope combinations for quick setup:

| Preset | Scopes | Use case |
|--------|--------|----------|
| **Full Access** | `*` | Admin integrations, MCP server |
| **Read Only** | All `:read` scopes | Dashboards, BI tools, reporting |
| **Analytics** | `analytics:read` | Revenue dashboards |
| **Support** | `products:read`, `users:read`, `coupons:read` | Customer support team |

---

## Key Rotation

Rotate keys with zero downtime using a grace period:

```bash
curl -X POST https://your-domain.com/api/v1/api-keys/{id}/rotate \
  -H "Cookie: <session>" \
  -H "Content-Type: application/json" \
  -d '{ "grace_period_hours": 24 }'
```

During the grace period (0–168 hours, default 24):
- The **new key** is active immediately
- The **old key** continues to work until the grace period expires
- The new key inherits all scopes from the old key

This allows you to update your integration without any downtime.

---

## Rate Limiting

Each API key has a configurable rate limit (default: 60 requests/minute, range: 1–1000).

When exceeded, the API returns:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Maximum 60 requests per minute."
  }
}
```

HTTP status: **429 Too Many Requests**

---

## Response Format

### Success

```json
{
  "data": { ... }
}
```

### Success (paginated)

```json
{
  "data": [ ... ],
  "pagination": {
    "cursor": "eyJpZCI6Ii4uLiJ9",
    "next_cursor": "eyJpZCI6Ii4uLiJ9",
    "has_more": true,
    "limit": 20
  }
}
```

### Error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": {
      "name": ["Name is required"],
      "price": ["Price must be positive"]
    }
  }
}
```

### Error codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | No authentication provided |
| `INVALID_TOKEN` | 401 | Invalid, expired, or revoked key |
| `FORBIDDEN` | 403 | Missing required scope |
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `INVALID_INPUT` | 400 | Malformed request body |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource conflict |
| `ALREADY_EXISTS` | 409 | Duplicate resource |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

---

## Pagination

All list endpoints use **cursor-based pagination**.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `limit` | 20 | Items per page (max 100) |
| `cursor` | — | Cursor from `next_cursor` of previous response |
| `search` | — | Search query (where supported) |
| `sort_by` | varies | Sort field |
| `sort_order` | `desc` | `asc` or `desc` |

Example:

```bash
# First page
curl ".../api/v1/products?limit=10"

# Next page (use next_cursor from previous response)
curl ".../api/v1/products?limit=10&cursor=eyJpZCI6Ii4uLiJ9"
```

---

## Endpoints

All endpoints are prefixed with `/api/v1`. Every endpoint also supports `OPTIONS` for CORS preflight.

### Products

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/products` | `products:read` | List products |
| POST | `/products` | `products:write` | Create product |
| GET | `/products/{id}` | `products:read` | Get product |
| PATCH | `/products/{id}` | `products:write` | Update product |
| DELETE | `/products/{id}` | `products:write` | Delete product |
| GET | `/products/{id}/oto` | `products:read` | Get one-time offer config |
| PUT | `/products/{id}/oto` | `products:write` | Set one-time offer |
| DELETE | `/products/{id}/oto` | `products:write` | Remove one-time offer |

### Users & Access

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/users` | `users:read` | List users |
| GET | `/users/{id}` | `users:read` | Get user |
| GET | `/users/{id}/access` | `users:read` | List user's product access |
| POST | `/users/{id}/access` | `users:write` | Grant product access |
| GET | `/users/{id}/access/{accessId}` | `users:read` | Get access record |
| PATCH | `/users/{id}/access/{accessId}` | `users:write` | Extend/modify access |
| DELETE | `/users/{id}/access/{accessId}` | `users:write` | Revoke access |

### Coupons

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/coupons` | `coupons:read` | List coupons |
| POST | `/coupons` | `coupons:write` | Create coupon |
| GET | `/coupons/{id}` | `coupons:read` | Get coupon |
| PATCH | `/coupons/{id}` | `coupons:write` | Update coupon |
| DELETE | `/coupons/{id}` | `coupons:write` | Delete coupon |
| GET | `/coupons/{id}/stats` | `coupons:read` | Get usage statistics |

### Payments

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/payments` | `analytics:read` | List payments |
| GET | `/payments/{id}` | `analytics:read` | Get payment details |
| GET | `/payments/stats` | `analytics:read` | Payment statistics |
| POST | `/payments/export` | `analytics:read` | Export payments (CSV) |
| POST | `/payments/{id}/refund` | `refund-requests:write` | Refund a payment |

### Order Bumps

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/order-bumps` | `products:read` | List order bumps |
| POST | `/order-bumps` | `products:write` | Create order bump |
| GET | `/order-bumps/{id}` | `products:read` | Get order bump |
| PATCH | `/order-bumps/{id}` | `products:write` | Update order bump |
| DELETE | `/order-bumps/{id}` | `products:write` | Delete order bump |

### Webhooks

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/webhooks` | `webhooks:read` | List webhooks |
| POST | `/webhooks` | `webhooks:write` | Create webhook |
| GET | `/webhooks/{id}` | `webhooks:read` | Get webhook |
| PATCH | `/webhooks/{id}` | `webhooks:write` | Update webhook |
| DELETE | `/webhooks/{id}` | `webhooks:write` | Delete webhook |
| POST | `/webhooks/{id}/test` | `webhooks:write` | Send test event |
| GET | `/webhooks/logs` | `webhooks:read` | List delivery logs |
| POST | `/webhooks/logs/{logId}/retry` | `webhooks:write` | Retry failed delivery |
| POST | `/webhooks/logs/{logId}/archive` | `webhooks:write` | Archive log entry |

### Analytics

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/analytics/dashboard` | `analytics:read` | Dashboard overview |
| GET | `/analytics/revenue` | `analytics:read` | Revenue breakdown |
| GET | `/analytics/top-products` | `analytics:read` | Top performing products |

### Refund Requests

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/refund-requests` | `refund-requests:read` | List refund requests |
| GET | `/refund-requests/{id}` | `refund-requests:read` | Get request details |
| PATCH | `/refund-requests/{id}` | `refund-requests:write` | Process (approve/deny) |

### Variant Groups

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/variant-groups` | `products:read` | List variant groups |
| POST | `/variant-groups` | `products:write` | Create variant group |
| GET | `/variant-groups/{id}` | `products:read` | Get variant group |
| PATCH | `/variant-groups/{id}` | `products:write` | Update variant group |
| DELETE | `/variant-groups/{id}` | `products:write` | Delete variant group |

### System

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/system/status` | `system:read` | System status and version |
| GET | `/system/update-check` | `system:read` | Check for updates |
| POST | `/system/upgrade` | `system:read` | Trigger self-upgrade |
| GET | `/system/upgrade-status` | `system:read` | Poll upgrade progress |

### API Keys (session auth only)

These endpoints require admin session authentication — API keys cannot manage other keys.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api-keys` | List your API keys |
| POST | `/api-keys` | Create new key (returns secret once) |
| GET | `/api-keys/{id}` | Get key details |
| PATCH | `/api-keys/{id}` | Update key (name, scopes, rate limit) |
| DELETE | `/api-keys/{id}` | Revoke key |
| POST | `/api-keys/{id}/rotate` | Rotate with grace period |

---

## OpenAPI Specification

The full OpenAPI 3.1 spec is available at:

```
GET /api/v1/docs/openapi.json
```

Import it into your favorite tool:
- **Postman:** Import → Link → paste URL
- **Swagger UI:** paste the URL in the explore bar
- **Bruno:** Import Collection → OpenAPI
