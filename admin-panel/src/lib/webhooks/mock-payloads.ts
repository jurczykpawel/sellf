/**
 * Mock payloads for webhook testing and preview.
 * Used by both server-side WebhookService and client-side WebhookTestModal.
 */
export const WEBHOOK_MOCK_PAYLOADS: Record<string, any> = {
  ...Object.fromEntries(['order.placed', 'order.cancelled', 'order.overdue'].map(event => [event, {
    order: { orderId: '00000000-0000-4000-8000-000000000001', orderNumber: 1001, amount: 9400, currency: 'PLN', dueAt: '2099-06-15T12:00:00Z',
      transfer: { holder: 'Example Workshops', account: 'PL61109010140000071219812874', bank: 'Example Bank', title: 'Zamówienie 1001' } },
    orderDetails: { buyer: { type: 'organization', company_name: 'Example' } }, lines: [],
  }])),
  'purchase.completed': {
    customer: {
      email: 'customer@example.com',
      firstName: 'Jan',
      lastName: 'Kowalski',
      userId: null
    },
    product: {
      id: 'prod_12345678',
      name: 'Premium Course',
      slug: 'premium-course',
      price: 4999,
      currency: 'usd',
      icon: '🎓'
    },
    bumpProduct: null,
    order: {
      amount: 4999,
      currency: 'usd',
      sessionId: 'cs_test_a1b2c3d4e5f6g7h8i9j0',
      paymentIntentId: 'pi_test_123',
      couponId: null,
      isGuest: false
    },
    invoice: {
      needsInvoice: true,
      nip: '1234567890',
      companyName: 'Przykładowa Firma Sp. z o.o.',
      address: 'ul. Testowa 123/45',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL'
    }
  },
  'lead.captured': {
    leadId: 'lead_example',
    source: 'https://example.com/video.mp4',
    marketingConsent: true,
    consentVersion: '1:en',
    consentConfirmedAt: '2026-10-28T12:00:00.000Z',
    customer: {
      email: 'lead@example.com',
      userId: 'user_123abc'
    },
    product: {
      id: 'prod_free_123',
      name: 'Free Tutorial',
      slug: 'free-tutorial',
      price: 0,
      currency: 'USD',
      icon: '📚'
    },
    license: {
      token: 'eyJhbGciOiJFUzI1NiJ9.example.signature',
      kid: 'kid-example',
      jwksUrl: 'https://example.com/api/licenses/jwks?seller=seller-id'
    }
  },
  'access.expired': {
    customer: {
      email: 'customer@example.com',
      userId: 'user_123abc'
    },
    product: {
      id: 'prod_12345678',
      name: 'Premium Course',
      slug: 'premium-course',
      price: 4999,
      currency: 'usd',
      icon: '🎓'
    },
    access: {
      grantedAt: '2026-01-01T00:00:00.000Z',
      expiredAt: new Date().toISOString()
    }
  },
  'waitlist.signup': {
    customer: {
      email: 'interested@example.com'
    },
    product: {
      id: 'prod_upcoming_123',
      name: 'Upcoming Course',
      slug: 'upcoming-course',
      price: 9900,
      currency: 'PLN',
      icon: '🚀'
    }
  },
  'subscription.created': {
    customer: { email: 'subscriber@example.com', userId: null },
    product: { id: 'prod_sub_123', name: 'Monthly Plan', slug: 'monthly-plan', currency: 'PLN' },
    subscription: {
      stripeSubscriptionId: 'sub_test_123',
      stripeCustomerId: 'cus_test_123',
      status: 'trialing',
      billingInterval: 'month',
      billingIntervalCount: 1,
      recurringPrice: 49.00,
      trialEnd: '2026-05-14T00:00:00.000Z',
      currentPeriodEnd: '2026-05-30T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    },
  },
  'subscription.updated': {
    customer: { email: 'subscriber@example.com', userId: 'user_123abc' },
    product: { id: 'prod_sub_123', name: 'Monthly Plan', slug: 'monthly-plan', currency: 'PLN' },
    subscription: {
      stripeSubscriptionId: 'sub_test_123',
      status: 'active',
      cancelAtPeriodEnd: false,
      previousAttributes: { status: 'trialing' },
    },
  },
  'subscription.canceled': {
    customer: { email: 'subscriber@example.com', userId: 'user_123abc' },
    product: { id: 'prod_sub_123', name: 'Monthly Plan', slug: 'monthly-plan', currency: 'PLN' },
    subscription: {
      stripeSubscriptionId: 'sub_test_123',
      status: 'canceled',
      canceledAt: new Date().toISOString(),
      cancelAtPeriodEnd: true,
      endsAt: '2026-05-30T00:00:00.000Z',
    },
  },
  'subscription.trial_ending': {
    customer: { email: 'subscriber@example.com', userId: 'user_123abc' },
    product: { id: 'prod_sub_123', name: 'Monthly Plan', slug: 'monthly-plan', currency: 'PLN' },
    subscription: {
      stripeSubscriptionId: 'sub_test_123',
      trialEnd: '2026-05-07T00:00:00.000Z',
    },
  },
  'subscription.renewal_upcoming': {
    customer: { email: 'subscriber@example.com', userId: 'user_123abc' },
    product: { id: 'prod_sub_123', name: 'Monthly Plan', slug: 'monthly-plan', currency: 'PLN' },
    subscription: {
      stripeSubscriptionId: 'sub_test_123',
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: '2026-05-30T00:00:00.000Z',
    },
    invoice: {
      stripeInvoiceId: 'in_upcoming_123',
      amountDue: 49.00,
      currency: 'PLN',
      nextPaymentAttempt: '2026-05-30T00:00:00.000Z',
      billingReason: 'subscription_cycle',
    },
  },
  'invoice.paid': {
    customer: { email: 'subscriber@example.com', userId: 'user_123abc' },
    product: { id: 'prod_sub_123', name: 'Monthly Plan', slug: 'monthly-plan', currency: 'PLN' },
    subscription: { stripeSubscriptionId: 'sub_test_123' },
    invoice: {
      stripeInvoiceId: 'in_test_123',
      amountPaid: 49.00,
      currency: 'PLN',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/...',
      invoicePdfUrl: 'https://invoice.stripe.com/.../pdf',
      paidAt: new Date().toISOString(),
    },
  },
  'invoice.payment_failed': {
    customer: { email: 'subscriber@example.com', userId: 'user_123abc' },
    product: { id: 'prod_sub_123', name: 'Monthly Plan', slug: 'monthly-plan', currency: 'PLN' },
    subscription: { stripeSubscriptionId: 'sub_test_123', status: 'past_due' },
    invoice: {
      stripeInvoiceId: 'in_test_123',
      amountDue: 49.00,
      currency: 'PLN',
      attemptCount: 1,
      nextPaymentAttempt: '2026-05-03T00:00:00.000Z',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/...',
    },
  },
  'refund.issued': {
    customer: { email: 'customer@example.com', userId: 'user_123abc' },
    product: {
      id: 'prod_12345678',
      name: 'Premium Course',
      slug: 'premium-course',
      price: 4999,
      currency: 'USD',
      icon: '🎓'
    },
    payment: {
      id: 'pay_12345678',
      amount: 4999,
      currency: 'USD',
      sessionId: 'cs_test_a1b2c3d4e5f6g7h8i9j0',
      paymentIntentId: 'pi_test_123',
      statusBefore: 'completed',
      statusAfter: 'refunded'
    },
    refund: {
      stripeRefundId: 're_test_123',
      amount: 4999,
      currency: 'USD',
      reason: 'requested_by_customer',
      status: 'succeeded',
      isFullRefund: true,
      totalRefunded: 4999,
      refundedAt: new Date().toISOString(),
      source: 'admin',
      // VAT breakdown of the refund (MINOR units) for credit notes — present when the
      // order has a tax snapshot. net + tax = amount; vatRate = order effective rate.
      net: 4064,
      tax: 935,
      vatRate: 23
    }
  },
  'license.revoked': {
    license: {
      id: 'lic_12345678',
      order: 'cs_test_a1b2c3d4e5f6g7h8i9j0',
      email: 'customer@example.com',
      tier: 'pro',
      domain: 'customer.example.com',
      issuanceSource: 'purchase',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      revokedAt: new Date().toISOString()
    },
    product: { id: 'prod_12345678', name: 'Premium Plugin', slug: 'premium-plugin' },
    crlUrl: 'https://example.com/api/licenses/revoked?seller=seller-id'
  },
  'test.event': {
    message: 'This is a test event from Sellf',
    system: { version: '1.0.0', environment: 'production' }
  }
};
