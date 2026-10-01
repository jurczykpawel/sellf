/**
 * Prompts Module
 *
 * MCP prompts guide Claude through common Sellf workflows.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  // Weekly report prompt
  server.prompt(
    'weekly-report',
    'Generate a comprehensive weekly sales report',
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `State date windows, pagination/sample coverage and money units. Keep currencies separate. Do not forecast from these numbers.

Please generate a comprehensive weekly sales report for Sellf.

Use the following tools to gather data:
1. get_dashboard - Get overall metrics
2. get_top_products - Get best selling products for the week (period: week)
3. get_payment_stats - Get payment statistics
4. get_refund_stats - Get refund information

The report should include:
- Executive Summary (2-3 sentences)
- Revenue Overview (state the reported window and currency; do not infer previous-week comparisons)
- Top Performing Products (with revenue and sales count)
- Transaction Summary
- Refund Analysis
- Key Insights and Recommendations

Format the report in a clear, professional markdown format suitable for stakeholders.`,
          },
        },
      ],
    })
  );

  // Product analysis prompt
  server.prompt(
    'product-analysis',
    'Perform a deep analysis of a specific product',
    {
      product_id: z.string().uuid().describe('UUID of the product to analyze'),
    },
    (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `State date windows, pagination/sample coverage and money units. Keep currencies separate. Do not forecast from these numbers.

Please perform a comprehensive analysis of product: ${args.product_id}

Use the following tools:
1. get_product - Get product details
2. get_product_stats - Get sales statistics for this product
3. search_payments - Search for payments related to this product
4. get_dashboard with product_id filter - Get product-specific metrics

The analysis should include:
- Product Overview (name, price, status)
- Sales Performance (get_product_stats is a sample of at most 100 payments; report sample coverage and separate currencies)
- Customer Patterns
- Recommendations for improvement

Provide actionable insights for optimizing this product's performance.`,
          },
        },
      ],
    })
  );

  // Historical revenue review prompt
  server.prompt(
    'revenue-forecast',
    'Review observed revenue and its data limitations',
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `State date windows, pagination/sample coverage and money units. Keep currencies separate. Do not forecast from these numbers.

Please review observed revenue for Sellf. Do not forecast revenue from these metrics.

Use these tools to gather historical data:
1. get_dashboard - Get current metrics
2. get_sales_trends - Get daily activity trends
3. compare_periods - Compare two current windows ending now, limited to top 50 products; these are not previous-month comparisons
4. get_top_products (period: month, quarter) - Identify revenue drivers

Based on the data, provide:
- Observed Revenue by Currency
- Reported Date Windows and Coverage
- Observed Revenue Drivers
- Data Limitations
- Questions for Further Measurement

Report only observed values. Do not infer future growth or historical periods absent from the response.`,
          },
        },
      ],
    })
  );

  // User cohort analysis prompt
  server.prompt(
    'user-cohort-analysis',
    'Analyze user segments and their purchasing behavior',
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `State date windows, pagination/sample coverage and money units. Keep currencies separate. Do not forecast from these numbers.

Please analyze user cohorts and purchasing behavior in Sellf.

Use these tools:
1. list_users with different sort options - Understand user distribution
2. get_conversion_stats - Get users-with-access share; includes free/manual access, not visitor conversion
3. get_dashboard - Get user statistics
4. list_payments - Analyze purchasing patterns

The analysis should cover:
- Registered User Overview
- Users-with-Access Share
- Product Access Distribution
- Observed Payments by Currency (product list value is not spending or lifetime value)
- Recommendations for User Engagement

Identify patterns that could inform marketing and product decisions.`,
          },
        },
      ],
    })
  );

  // Coupon effectiveness prompt
  server.prompt(
    'coupon-effectiveness',
    'Review recorded coupon usage and discounts',
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `State date windows, pagination/sample coverage and money units. Keep currencies separate. Do not forecast from these numbers.

Please review recorded coupon usage and discounts for Sellf. These data do not establish ROI or incremental revenue.

Use these tools:
1. list_coupons - Get all coupons
2. get_coupon_stats - Get usage stats for each coupon
3. get_payment_stats - Get overall payment metrics for comparison

The analysis should include:
- Active Coupon Summary
- Usage Statistics (total uses, per-coupon breakdown)
- Recorded Discount Amounts (paid redemptions may record zero; do not infer measured savings)
- Best Performing Coupons
- Underperforming Coupons
- Coupon Strategy Recommendations

Provide specific recommendations for coupon optimization.`,
          },
        },
      ],
    })
  );

  // Refund analysis prompt
  server.prompt(
    'refund-analysis',
    'Analyze refund patterns and identify issues',
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `State date windows, pagination/sample coverage and money units. Keep currencies separate. Do not forecast from these numbers.

Please analyze refund patterns in Sellf.

Use these tools:
1. get_refund_stats - Get refund statistics
2. list_payments - Inspect refunded_amount (including partial refunds on completed payments); paginate before aggregating by product
3. get_dashboard - Get overall context

The analysis should cover:
- Refund Rate Overview
- Refund by Product Analysis
- Common Refund Reasons
- Temporal Patterns (when do refunds happen?)
- Financial Impact
- Recommendations to Reduce Refunds

Identify actionable steps to improve customer satisfaction and reduce refund rates.`,
          },
        },
      ],
    })
  );
}
