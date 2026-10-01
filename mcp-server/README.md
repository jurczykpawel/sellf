# Sellf MCP Server

Model Context Protocol (MCP) server for Sellf - enables AI assistants like Claude to manage products, users, payments, coupons, and analytics through natural language.

## Overview

This MCP server acts as a thin wrapper over Sellf's REST API v1, allowing Claude Desktop and other MCP-compatible AI assistants to:

- Manage products (list, create, update, delete, duplicate)
- Handle users and product access (grant, revoke, extend)
- Process payments and refunds
- Manage discount coupons
- View analytics and generate reports
- Configure webhooks
- Monitor system health

## Quick Start

### 1. Install Dependencies

```bash
cd mcp-server
bun install
```

### 2. Create API Key

1. Log into your Sellf admin panel
2. Go to Settings > API Keys
3. Create a new API key with only the scopes needed for your use case (see API Key Scopes below)
4. Copy the key - it will only be shown once

### 3. Configure Claude Desktop

Edit your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the Sellf server:

```json
{
  "mcpServers": {
    "sellf": {
      "command": "bun",
      "args": ["/path/to/mcp-server/src/index.ts"],
      "env": {
        "SELLF_API_KEY": "sf_live_xxx...",
        "SELLF_API_URL": "https://your-sellf-instance.com"
      }
    }
  }
}
```

### 4. Restart Claude Desktop

The Sellf tools should now be available in Claude.

## Available Tools (45 total)

### Products (8 tools)
- `list_products` - List all products with filters
- `get_product` - Get product details
- `create_product` - Create a draft by default; publish explicitly with `update_product` and `is_active: true`
- `update_product` - Update product fields
- `delete_product` - Delete a product
- `toggle_product_status` - Activate/deactivate product
- `duplicate_product` - Copy an existing product
- `get_product_stats` - Payment sample for a product (at most 100 records, with pagination coverage)

### Users (8 tools)
- `list_users` - List users with product access
- `get_user` - Get user details
- `search_users` - Search by email
- `grant_access` - Grant product access
- `revoke_access` - Revoke product access
- `extend_access` - Extend access expiration
- `bulk_grant_access` - Grant access to multiple users
- `get_user_purchases` - Get user's purchase history

### Payments (7 tools)
- `list_payments` - List transactions with filters
- `get_payment` - Get payment details
- `search_payments` - Search payments
- `process_refund` - Process full/partial refund after explicit human confirmation (`payments:refund`)
- `export_payments` - Export as CSV
- `list_failed_payments` - List failed transactions
- `get_payment_stats` - Get payment statistics

### Coupons (7 tools)
- `list_coupons` - List all coupons
- `get_coupon` - Get coupon details
- `create_coupon` - Create new coupon
- `update_coupon` - Update coupon
- `delete_coupon` - Delete coupon
- `get_coupon_stats` - Get usage statistics
- `deactivate_coupon` - Quickly deactivate

### Analytics (8 tools)
- `get_dashboard` - Get dashboard overview
- `get_revenue_stats` - Get revenue statistics
- `get_revenue_by_product` - Revenue breakdown by product
- `get_sales_trends` - Daily sales trends
- `get_top_products` - Best performing products
- `get_conversion_stats` - Registered users with access / all registered users, including free/manual access
- `get_refund_stats` - Refund statistics
- `compare_periods` - Compare two current windows ending now, limited to top 50 products; not prior-week/month comparison

### Webhooks (5 tools)
- `list_webhooks` - List webhook endpoints
- `create_webhook` - Create new webhook
- `update_webhook` - Update webhook config
- `delete_webhook` - Delete webhook
- `get_webhook_logs` - View delivery logs

### System (2 tools)
- `get_system_health` - Check system status
- `get_api_usage` - API usage statistics

## Resources

The server exposes 4 auto-refreshing resources:

| URI | Description |
|-----|-------------|
| `sellf://dashboard` | Dashboard metrics |
| `sellf://products/active` | Active products list |
| `sellf://alerts` | Pending refunds, failed payments |
| `sellf://recent-sales` | Latest 10 transactions |

## Prompts

Pre-built prompts for common workflows:

- `weekly-report` - Generate weekly sales report
- `product-analysis` - Deep dive on a product
- `revenue-forecast` - Historical revenue review (retained prompt identifier; does not request forecasts)
- `user-cohort-analysis` - User segment analysis
- `coupon-effectiveness` - Recorded coupon usage and discounts
- `refund-analysis` - Refund patterns

## Development

### Run in Development Mode

```bash
bun dev
```

### Build for Production

```bash
bun run build
bun start
```

### Run Tests

```bash
bun run test              # Run all tests
bun run test:watch        # Watch mode
bun run test:coverage     # With coverage
```

### Test with MCP Inspector

```bash
bunx @anthropic/mcp-inspector bun src/index.ts
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SELLF_API_KEY` | Yes | API key (sf_live_xxx or sf_test_xxx) |
| `SELLF_API_URL` | Yes | Base URL of your Sellf instance |

## API Key Scopes

Use separate keys with minimal scopes for each workflow. Do not use `*` as the default.

| Use case | Minimal scopes |
| --- | --- |
| Read-only reporting from aggregate analytics | `analytics:read` |
| Product editing, including inspecting products | `products:read`, `products:write` |
| Refund review and processing | `payments:read`, `payments:refund` |

For reporting that inspects transactions or calls `get_product_stats`, add `payments:read`; `get_product_stats` also needs `products:read`. Add `users:read` only for user-level reports and `coupons:read` only for coupon reports. Refunds require explicit human confirmation of the payment, currency and amount before invoking `process_refund`; the description is guidance for the caller, not a server-enforced approval gate. `payments:write` alone does not authorize refunds.

Other scopes, only when needed:
- `products:read`, `products:write`
- `users:read`, `users:write`
- `analytics:read`
- `payments:read`, `payments:write`, `payments:refund`
- `coupons:read`, `coupons:write`
- `webhooks:read`, `webhooks:write`
- `system:read`

Product inputs mirror persisted fields in the REST product DTO, including full descriptions, media, feature sections, sale prices, custom pricing, subscription billing/trials, VAT, refunds, redirects, licenses, and category/tag/bundle relations. DTO-only fields `tip_icon`, `suggested_amounts`, `min_amount`, and `metadata` have no product database columns and are omitted from MCP inputs.

## Money units

Values are forwarded without rescaling. Major units: `49.99` means 49.99 in the specified currency. Minor units: `4999` means 49.99 for PLN/USD; use the currency's minor-unit convention for Stripe amounts.

| API endpoint used by MCP | Fields | Unit |
| --- | --- | --- |
| `/api/v1/products`, `/api/v1/products/:id` (GET/POST/PATCH) | `price`, `sale_price`, `recurring_price`, `custom_price_min`, each `custom_price_presets` | Major, in product currency |
| `/api/v1/coupons`, `/api/v1/coupons/:id` (GET/POST/PATCH) | Fixed `discount_value` | Major, in coupon currency; percentage values are percent (`25` = 25%) |
| `/api/v1/coupons/:id/stats` | `summary.total_discount_amount`, `recent_redemptions[].discount_amount`, `daily_usage[].amount`, `usage_by_product[].amount` | Major, recorded discounts; paid redemptions may record zero; no currency conversion |
| `/api/v1/payments` | `amount`, `refunded_amount`, `refund.amount`, `net_total`, `tax_total`, line item `net_amount`, `tax_amount`, tax breakdown amounts | Minor, in payment/line currency |
| `/api/v1/payments` | Line item `unit_price`, `total_price` (including order bumps) | Major, in line currency |
| `/api/v1/payments/:id` | `amount`, `refund.amount`, `net_total`, `tax_total` | Minor, in payment currency |
| `/api/v1/payments/:id` | `product.price` | Major, in product currency |
| `/api/v1/payments/:id/refund` (POST) | Input `amount`; output `refund.amount`, `total_refunded` | Integer minor units; omission requests a full refund |
| `/api/v1/payments/stats` | `total_revenue`, `refunded_amount`, `today_revenue`, `this_month_revenue`, all currency breakdown amounts | Minor |
| `/api/v1/analytics/dashboard` | All `revenue` amounts, `refunds.total_refunded`, `recent_activity[].revenue` | Minor |
| `/api/v1/analytics/top-products` | `current_price` | Major, in `current_currency` |
| `/api/v1/analytics/top-products` | `revenue`, `average_price`, `summary.total_revenue`, `by_currency.*.revenue` | Minor |
| `/api/v1/users`, `/api/v1/users/:id`, access updates | `product_price`, `stats.total_value` where returned | Major; `total_value` sums list prices and is not customer spending |

`get_product_stats` combines product prices in major units with sampled payment revenue in minor units. `get_sales_trends`, `get_refund_stats`, and `compare_periods` retain minor units for derived revenue/refund amounts. Aggregate totals can mix currencies; use per-currency breakdowns, and do not present mixed sums as one currency. Percentage/share/change-rate fields are percentages, not money.

There is no dedicated order-bump tool in this MCP server. The REST `/api/v1/order-bumps` `bump_price` uses major units, consistent with checkout's price-to-minor-unit conversion. Bump line prices returned through payment tools also use major units.

## Analytics coverage

`get_product_stats` reports a sample of the first 100 payments with `has_more` and `next_cursor`; it is not a lifetime total. `get_conversion_stats` reports `users_with_access_percent`, including free/manual access, rather than visit-to-purchase conversion. `compare_periods` retains its argument names but compares two current windows ending now (today, trailing 7 days, month-to-date, trailing 3 months, or year-to-date in the API server timezone). Each summary covers only the top 50 returned products. Windows may overlap. Prompts report observed data and coverage without forecasting.

## Security Notes

- API keys are never logged or stored by the MCP server
- Use test mode keys (`sf_test_xxx`) for development
- Rotate keys regularly via the admin panel
- The server respects all API key scopes and rate limits

## License

MIT
