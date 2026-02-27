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
            text: `Please generate a comprehensive weekly sales report for Sellf.

Use the following tools to gather data:
1. get_dashboard - Get overall metrics
2. get_top_products - Get best selling products for the week (period: week)
3. get_payment_stats - Get payment statistics
4. get_refund_stats - Get refund information

The report should include:
- Executive Summary (2-3 sentences)
- Revenue Overview (this week vs previous patterns)
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
            text: `Please perform a comprehensive analysis of product: ${args.product_id}

Use the following tools:
1. get_product - Get product details
2. get_product_stats - Get sales statistics for this product
3. search_payments - Search for payments related to this product
4. get_dashboard with product_id filter - Get product-specific metrics

The analysis should include:
- Product Overview (name, price, status)
- Sales Performance (total sales, revenue)
- Customer Patterns
- Recommendations for improvement

Provide actionable insights for optimizing this product's performance.`,
          },
        },
      ],
    })
  );

  // Revenue forecast prompt
  server.prompt(
    'revenue-forecast',
    'Project future revenue based on historical trends',
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Please create a revenue forecast for Sellf.

Use these tools to gather historical data:
1. get_dashboard - Get current metrics
2. get_sales_trends - Get daily activity trends
3. compare_periods - Compare current month vs previous month
4. get_top_products (period: month, quarter) - Identify revenue drivers

Based on the data, provide:
- Current Revenue Trajectory
- Month-over-Month Trends
- Projected Revenue (next 30 days)
- Key Growth Drivers
- Potential Risks
- Recommendations to Accelerate Growth

Use conservative, moderate, and optimistic scenarios where appropriate.`,
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
            text: `Please analyze user cohorts and purchasing behavior in Sellf.

Use these tools:
1. list_users with different sort options - Understand user distribution
2. get_conversion_stats - Get conversion metrics
3. get_dashboard - Get user statistics
4. list_payments - Analyze purchasing patterns

The analysis should cover:
- User Acquisition Overview
- Conversion Funnel Analysis
- High-Value User Segment
- Product Access Distribution
- User Lifetime Value Indicators
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
    'Analyze coupon performance and ROI',
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Please analyze coupon effectiveness and ROI for Sellf.

Use these tools:
1. list_coupons - Get all coupons
2. get_coupon_stats - Get usage stats for each coupon
3. get_payment_stats - Get overall payment metrics for comparison

The analysis should include:
- Active Coupon Summary
- Usage Statistics (total uses, per-coupon breakdown)
- Revenue Impact Analysis
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
            text: `Please analyze refund patterns in Sellf.

Use these tools:
1. get_refund_stats - Get refund statistics
2. list_payments with status=refunded - Get refunded transactions
3. get_dashboard - Get overall context
4. get_top_products - Identify which products have most refunds

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
