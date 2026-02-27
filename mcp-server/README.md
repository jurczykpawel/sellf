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
3. Create a new API key with `*` (full access) scope
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
        "SELLF_API_KEY": "gf_live_xxx...",
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
- `create_product` - Create a new product
- `update_product` - Update product fields
- `delete_product` - Delete a product
- `toggle_product_status` - Activate/deactivate product
- `duplicate_product` - Copy an existing product
- `get_product_stats` - Get sales stats for product

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
- `process_refund` - Process full/partial refund
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
- `get_conversion_stats` - Conversion metrics
- `get_refund_stats` - Refund statistics
- `compare_periods` - Compare time periods

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
- `revenue-forecast` - Revenue projections
- `user-cohort-analysis` - User segment analysis
- `coupon-effectiveness` - Coupon ROI analysis
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
| `SELLF_API_KEY` | Yes | API key (gf_live_xxx or gf_test_xxx) |
| `SELLF_API_URL` | Yes | Base URL of your Sellf instance |

## API Key Scopes

For full functionality, create an API key with `*` (full access) scope.

For limited access, use specific scopes:
- `products:read`, `products:write`
- `users:read`, `users:write`
- `analytics:read`
- `coupons:read`, `coupons:write`
- `webhooks:read`, `webhooks:write`
- `system:read`

## Security Notes

- API keys are never logged or stored by the MCP server
- Use test mode keys (`gf_test_xxx`) for development
- Rotate keys regularly via the admin panel
- The server respects all API key scopes and rate limits

## License

MIT
