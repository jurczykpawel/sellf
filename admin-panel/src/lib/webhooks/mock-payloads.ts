/**
 * Mock payloads for webhook testing and preview.
 * Used by both server-side WebhookService and client-side WebhookTestModal.
 */
export const WEBHOOK_MOCK_PAYLOADS: Record<string, any> = {
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
    email: 'customer@example.com',
    amount: 4999,
    currency: 'usd',
    reason: 'requested_by_customer'
  },
  'test.event': {
    message: 'This is a test event from Sellf',
    system: { version: '1.0.0', environment: 'production' }
  }
};
