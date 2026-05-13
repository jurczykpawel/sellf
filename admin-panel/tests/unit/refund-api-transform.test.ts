import { describe, expect, it } from 'vitest';
import { transformRefundRequestListItem } from '@/lib/refunds/api-transform';

describe('refund request API transforms', () => {
  it('exposes product_name and purchase_date expected by the admin table', () => {
    const transformed = transformRefundRequestListItem({
      id: 'refund-1',
      user_id: 'user-1',
      product_id: 'product-1',
      transaction_id: 'transaction-1',
      customer_email: 'buyer@example.com',
      requested_amount: 4900,
      currency: 'PLN',
      reason: 'Changed my mind',
      status: 'pending',
      admin_response: null,
      processed_at: null,
      created_at: '2026-05-08T10:00:00.000Z',
      updated_at: '2026-05-08T10:00:00.000Z',
      product: {
        id: 'product-1',
        name: 'Test Product',
        slug: 'test-product',
      },
      transaction: {
        id: 'transaction-1',
        customer_email: 'buyer@example.com',
        amount: 4900,
        currency: 'PLN',
        created_at: '2026-05-07T09:30:00.000Z',
      },
    });

    expect(transformed.product_name).toBe('Test Product');
    expect(transformed.purchase_date).toBe('2026-05-07T09:30:00.000Z');
  });
});
