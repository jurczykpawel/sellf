---
title: "REST API v1"
description: "Sellf provides a full REST API for managing products, users, payments, refunds, coupons, webhooks, and more. Admin API endpoints are under /api/v1/."
---

Sellf provides a full REST API for managing products, users, payments, refunds, coupons, webhooks, and more. Admin API endpoints are under `/api/v1/`.

For Claude Code, Claude Desktop, Codex and Cursor setup with scoped keys and tested recipes, see [Connect your AI agent](/connect-ai-agent/).

**Base URL:** `https://your-domain.com/api/v1`

**Features:**
- 60+ endpoints covering all admin operations
- Fine-grained API keys with 13 permission scopes
- Zero-downtime key rotation with grace period
- Per-key rate limiting (1–1000 req/min)
- Cursor-based pagination
- OpenAPI 3.1 specification

Customer checkout, embedded checkout, Stripe webhook, waitlist signup, and subscription self-service routes live outside `/api/v1` because they use browser sessions, public tokens, or Stripe signatures instead of API keys.

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
      "price": 29,
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

## Amount units in v1

Units are part of the v1 contract and are not converted automatically. **Major units** mean `49.99` = 49.99 PLN/USD; **minor units** mean `4999` = 49.99 PLN/USD. Interpret minor units using the currency's exponent (for example, JPY has no decimal places). Averages may contain fractions of a minor unit.

All paths below are relative to `/api/v1`. Units apply to both input and output where applicable.

| Endpoint | Fields | Unit |
|---|---|---|
| `GET/POST /products`, `GET/PATCH /products/{id}` | `price`, `sale_price`, `recurring_price`, `custom_price_min`, each `custom_price_presets` entry | Major |
| `GET/POST /order-bumps`, `GET/PATCH /order-bumps/{id}` | `bump_price`, nested product prices | Major |
| `GET/PUT /products/{id}/oto` | `discount_value`, `downsell_discount_value` | Major when the corresponding discount type is `fixed`; percentage points when `percentage` (`25` = 25%) |
| `GET/POST /coupons`, `GET/PATCH /coupons/{id}` | `discount_value` | Major for `fixed`; percentage points for `percentage` |
| `GET /coupons/{id}/stats` | `summary.total_discount_amount`, redemption `discount_amount`, `daily_usage[].amount`, `usage_by_product[].amount` | Major |
| `GET /payments`, `GET /payments/{id}`, `PATCH /payments/{id}` | `amount`, `refunded_amount`, `refund.amount`, `net_total`, `tax_total` where returned | Minor |
| `GET /payments` | `line_items[].unit_price`, `line_items[].total_price` | Major |
| `GET /payments` | `line_items[].net_amount`, `line_items[].tax_amount` | Minor |
| `GET /payments/{id}` | `product.price` | Major |
| `POST /payments/export` | CSV amount, refunded amount, net total, tax total | Major (since 2026.10.7; headers end with `(major units)`, dot as decimal separator; zero-decimal currencies such as JPY are whole units). Before 2026.10.7 the CSV used minor units |
| `POST /payments/{id}/refund` | Request `amount`, response `amount` and `refunded_amount` where returned | Minor; request amount must be an integer |
| `GET /payments/stats` | Revenue/refund amounts, averages and currency breakdown amounts | Minor |
| `GET /analytics/dashboard` | `revenue.*` amounts, `refunds.total_refunded`, `recent_activity[].revenue` | Minor |
| `GET /analytics/revenue` | Summary amounts including `average_order_value`, breakdown revenue, comparison revenue and currency breakdown amounts | Minor |
| `GET /analytics/top-products` | `revenue`, `average_price`, summary revenue and currency breakdown revenue | Minor |
| `GET /analytics/top-products` | `current_price` | Major |
| `GET /refund-requests`, `GET/PATCH /refund-requests/{id}` | `requested_amount`, nested transaction `amount`, refund amounts where returned | Minor |
| `GET /users`, `GET /users/{id}`, access endpoints | Nested product prices | Major |

Counts, durations, VAT rates, percentage discounts and percentage changes are not monetary amounts. Cross-currency totals are arithmetic sums, not currency conversions: use currency breakdowns where available. Do not treat a product price as a payment amount without explicitly converting units.

## Product input compatibility

For `POST /products` and `PATCH /products/{id}`, v1 ignores unknown top-level product fields, including read-only fields copied from a response. They are not persisted. Invalid values for recognized fields return HTTP **400** (`VALIDATION_ERROR`).

These legacy fields are recognized and validated but **ignored**, because they have no product database columns:

| Field | Legacy accepted value | Persisted alternative |
|---|---|---|
| `custom_price_label` | String, max 80 characters | None |
| `tip_icon` | String, max 8 characters | `icon` for the product icon |
| `suggested_amounts` | Up to 20 nonnegative numbers | `custom_price_presets` (major units) |
| `min_amount` | Nonnegative number or null | `custom_price_min` (major units; nonnegative number) |
| `metadata` | Object | None; payment metadata is a separate contract |

These are not aliases: v1 does not map them to the alternative fields, store them or return them. Older MCP clients may send `custom_price_label`; the current MCP tool schema omits all five fields. This keeps existing v1 callers compatible without forwarding unsupported columns to storage.

`categories`, `tags` and `bundleItemIds` are supported relation inputs, handled separately from the product row. They are not unknown fields. Other endpoints have their own validation rules.

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
| `analytics:read` | View analytics and reports (aggregates only) |
| `payments:read` | View payment transactions and export them as CSV |
| `payments:write` | Update payment metadata |
| `webhooks:read` | View webhook configurations |
| `webhooks:write` | Manage webhooks (create, update, delete, test) |
| `integrations:write` | Manage tracking and consent integrations |
| `refund-requests:read` | View refund requests |
| `refund-requests:write` | Process refund requests |
| `system:read` | View system status and update info |
| `licenses:read` | List issued licenses and read one license with its token (Pro) |
| `licenses:write` | Issue and revoke licenses (Pro) |
| `*` | Full access to all resources |

### Write implies read

A key with `products:write` automatically has `products:read` permission. You don't need to include both.

### Presets

Common scope combinations for quick setup:

| Preset | Scopes | Use case |
|--------|--------|----------|
| **Full Access** | `*` | Integrations that explicitly need every permission |
| **Read Only** | All `:read` scopes | Dashboards, BI tools, reporting |
| **Analytics** | `analytics:read` | Revenue dashboards (aggregates only — add `payments:read` for individual transactions) |
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

`discount_type` accepts `percentage`, `fixed` and `set_price`.
For `set_price`, `discount_value` is the final unit price of the main product in
`currency` (required, must match the product). For example, `30` PLN charges 30 PLN
at either the 47 or 67 PLN event tier. Quantity multiplies this price; bumps keep
their price regardless of `exclude_order_bumps`. A higher set price never raises
the current price. Zero uses the existing free-access flow; embed directs buyers
to the standard checkout for free access. JPY requires integers. Coupons do not
change Omnibus lowest-price history. This type is available to all sellers.

### Payments

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/payments` | `payments:read` | List payments (`?embed=attribution` adds the frozen purchase source) |
| GET | `/payments/{id}` | `payments:read` | Get payment details |
| PATCH | `/payments/{id}` | `payments:write` | Update payment metadata |
| GET | `/payments/stats` | `analytics:read` | Payment statistics (aggregates only) |
| GET | `/analytics/attribution` | `analytics:read` | Where purchases came from — aggregates by channel / UTM, net of refunds, major units ([Purchase sources](/purchase-attribution/)) |
| POST | `/payments/export` | `payments:read` | Export payments (CSV) |
| POST | `/payments/{id}/refund` | `payments:refund` | Refund a payment, including partial refunds |

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

### Integrations

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| PATCH | `/integrations` | `integrations:write` | Update tracking and consent integrations |

Supported fields: `gtm_container_id`, `gtm_server_container_url`, `gtm_ss_enabled`, `google_ads_conversion_id`, `google_ads_conversion_label`, `facebook_pixel_id`, `facebook_capi_token`, `facebook_test_event_code`, `fb_capi_enabled`, `send_conversions_without_consent`, `umami_website_id`, `umami_script_url`, `cookie_consent_enabled`, `consent_logging_enabled`.

`facebook_capi_token` is write-only: it is stored encrypted and never returned. Omit the field to keep the stored token; send `null` to remove it.

Supported outgoing event types include purchases, leads, waitlist signups, `refund.issued`, `refund.updated`, `dispute.created`, `dispute.closed`, `license.issued`, `license.revoked`, `license.restored`, `license.expired` (all Pro; `license.updated` reserved), subscription lifecycle events, and invoice payment events.

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

### Licenses (Pro)

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/licenses` | `licenses:read` | List; filters `product_id`, `email`, `status` (`active`/`expired`/`revoked`), `source` (`purchase`/`manual`/`api`); no tokens |
| POST | `/licenses` | `licenses:write` | Issue `{ productId, email, domain?, customFieldValues?, sendEmail? = true, locale? }`; returns the license with `token`, `jwksUrl`, `crlUrl`, `emailSent` |
| GET | `/licenses/{id}` | `licenses:read` | One license including its signed `token` |
| DELETE | `/licenses/{id}` | `licenses:write` | Permanent revocation (same as the panel) |

Issuance and revocation send `license.issued` / `license.revoked`. The product must have
license issuance enabled and the seller an active signing key, otherwise `409 CONFLICT`.

**CLI.** `admin-panel/scripts/issue-license.ts` issues through this endpoint
(`SELLF_URL`, `SELLF_API_KEY`); `--offline` signs locally with the seller's private key
using the same token format, but such a license is not recorded: it cannot be revoked in
Sellf and sends no webhook or mail. Sellf's own Pro licenses are issued the same way by
the TSA instance, so there is no separate generator.

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

## Public, Session, And Stripe-Signed Routes

These routes are intentionally not part of API-key authenticated `/api/v1`.

### Embedded Checkout

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/embed/checkout-session` | Public origin validation | Create an embedded checkout session for an allowed origin |
| POST | `/api/embed/free-access` | Public origin validation | Grant access for free embedded products |
| GET | `/embed/v1/checkout.js` | Public script | Self-hosted checkout embed script for external pages |

Paid embeds show a coupon field above the checkout. Buyers can type a code and press Apply; the discount is validated on the server with the same rules and limits as the storefront checkout (per-code attempt throttle, captcha as for any paid embed). A rejected code shows an error under the field and leaves the current checkout payable.

To prefill a code, for example from a seller or affiliate link, add `data-coupon` to the embed element. The buyer can still change it:

```html
<div data-sellf-embed data-product-slug="my-course" data-coupon="SPRING25"></div>
<script src="https://YOUR_SELLF/embed/v1/checkout.js"></script>
```

`POST /api/embed/checkout-session` accepts an optional `couponCode` (letters, digits, `_`, `.`, `-`; up to 64 characters). An invalid or unusable code returns `400` with an `error` message; no session is created.

### Customer Subscriptions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/subscriptions` | Session | List the current customer's subscriptions |
| POST | `/api/subscriptions/{id}/cancel` | Session | Cancel at period end |
| POST | `/api/subscriptions/{id}/resume` | Session | Resume before the current period ends |

### Stripe Webhook

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/webhooks/stripe` | Stripe signature | Process checkout, refund, dispute, subscription, upcoming renewal, and invoice events |

Subscribe the Stripe endpoint to the events listed by `STRIPE_WEBHOOK_EVENTS` in `admin-panel/src/lib/constants.ts`.

### Waitlist

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/waitlist/signup` | Public or session | Capture waitlist signups and dispatch `waitlist.signup` outgoing webhooks |


## PlayerStack leads

[Email-confirmed lead forms and marketing consent](/playerstack-leads/).
