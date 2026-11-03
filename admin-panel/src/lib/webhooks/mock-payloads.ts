/**
 * Mock payloads for webhook testing and preview.
 * Used by both server-side WebhookService and client-side WebhookTestModal.
 */
const ACCESS_SAMPLE = {
  customer: { email: 'customer@example.com', userId: '00000000-0000-4000-8000-000000000002' }, product: { id: '00000000-0000-4000-8000-000000000003', name: 'Example course', slug: 'example-course' },
  actor: { type: 'system', id: null }, reason: 'access_change', sourceOrder: null, sourceOrders: [],
  accessGrantedAt: '2099-01-01T00:00:00Z', accessExpiresAt: '2099-01-08T00:00:00Z',
};
const SYSTEM_ACTOR = { type: 'system', id: null };
const SAMPLE_TIME = '2099-01-01T00:00:00Z';
const SAMPLE_PRODUCT = ACCESS_SAMPLE.product;
const SAMPLE_PARTNER = { memberId: '00000000-0000-4000-8000-000000000031', code: 'demo-partner', displayName: 'Demo Partner', status: 'approved', userId: '00000000-0000-4000-8000-000000000032' };
export const WEBHOOK_MOCK_PAYLOADS: Record<string, any> = {
  ...Object.fromEntries(['order.placed', 'order.cancelled', 'order.overdue', 'order.payment_reminder', 'order.transfer_declared', 'order.invoice_issued', 'order.reopened'].map(event => [event, {
    amountUnit: 'minor', access: { policy: 'after_payment', grants: [{ productId: '00000000-0000-4000-8000-000000000003', status: 'pending_payment', grantedAt: null, expiresAt: null }] },
    order: { orderId: '00000000-0000-4000-8000-000000000001', orderNumber: 1001, amount: 9400, grossTotal: 9400, netTotal: null, taxTotal: null, taxSnapshotStatus: 'unavailable', currency: 'PLN', dueAt: '2099-06-15T12:00:00Z',
      transfer: { holder: 'Example Workshops', account: 'PL61109010140000071219812874', bank: 'Example Bank', title: 'Zamówienie 1001' },
      status: 'awaiting_payment', payUrl: 'https://shop.example/pl/order/00000000-0000-4000-8000-000000000001/transfer?token=4102444800.sample', payUrlExpiresAt: '2099-08-01T12:00:00.000Z',
      reservation: 'timed', reminderAt: '2099-06-14T12:00:00Z', releaseAt: '2099-06-15T12:00:00Z', invoiceHoldAt: null, transferDeclaredAt: null, transferDeclaredNote: null, cancelReason: null, reopenedAt: null },
    orderDetails: { buyer: { type: 'organization', company_name: 'Example' } }, lines: [],
  }])),
  'order.participants_updated': {
    customer: ACCESS_SAMPLE.customer, product: ACCESS_SAMPLE.product, actor: { type: 'customer', id: null },
    reason: 'participants_added_after_payment', occurredAt: '2099-01-01T00:30:00Z',
    order: { orderId: '00000000-0000-4000-8000-000000000001', orderNumber: 1001, status: 'completed' },
    orderDetails: { quantity: { v: 1, value: 2 }, participants: { v: 1, people: [
      { first_name: 'Jan', last_name: 'Nowak', email: 'jan@example.com' }, { first_name: 'Anna', last_name: 'Kowalska', email: 'anna@example.com' }] } },
  },
  'order.abandoned': {
    amountUnit: 'minor', customer: ACCESS_SAMPLE.customer, product: ACCESS_SAMPLE.product, actor: ACCESS_SAMPLE.actor,
    reason: 'checkout_expired', occurredAt: '2099-01-01T00:30:00Z', lines: [],
    order: { orderId: '00000000-0000-4000-8000-000000000001', orderNumber: 1001, amount: 9400, grossTotal: 9400,
      currency: 'PLN', netTotal: null, taxTotal: null, taxSnapshotStatus: 'unavailable', paymentProvider: 'stripe', sessionId: 'cs_test_sample', paymentIntentId: null, statusBefore: 'pending', statusAfter: 'abandoned' },
  },
  'purchase.completed': {
    amountUnit: 'minor',
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
      orderId: '00000000-0000-4000-8000-000000000001', orderNumber: 1001,
      amount: 4999, grossTotal: 4999, netTotal: null, taxTotal: null, taxSnapshotStatus: 'unavailable',
      currency: 'usd',
      sessionId: 'cs_test_a1b2c3d4e5f6g7h8i9j0',
      paymentIntentId: 'pi_test_123',
      couponId: null,
      isGuest: false
    },
    attribution: {
      channel: 'email', firstChannel: 'paid_social', kind: 'payment', mode: 'stored',
      last: { source: 'newsletter', medium: 'email', campaign: 'autumn-launch', content: 'cta-1', term: null, utm_id: null, referrer_host: null, landing_path: '/offer', at: '2026-11-03T10:00:00.000Z' },
      first: { source: 'facebook', medium: 'paid_social', campaign: 'autumn', content: null, term: null, utm_id: null, referrer_host: null, landing_path: '/', at: '2026-10-30T10:00:00.000Z' },
      sessionsCount: 3, daysToPurchase: 4, clickIdType: null, deviceClass: 'mobile', country: 'PL', affiliateMemberId: null
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
  ...Object.fromEntries(['granted', 'updated', 'revoked', 'expired'].map(status => [`access.${status}`, {
    ...ACCESS_SAMPLE, occurredAt: status === 'expired' ? ACCESS_SAMPLE.accessExpiresAt : '2099-01-01T00:00:00Z', reason: status === 'expired' ? 'expired' : 'access_change',
    ...(status === 'granted' || status === 'updated' ? { grantSource: 'purchase' } : {}),
    access: { id: '00000000-0000-4000-8000-000000000004', grantedAt: ACCESS_SAMPLE.accessGrantedAt, expiresAt: ACCESS_SAMPLE.accessExpiresAt,
      expiredAt: status === 'expired' ? ACCESS_SAMPLE.accessExpiresAt : null, revokedAt: status === 'revoked' ? '2099-01-04T00:00:00Z' : null,
      statusBefore: status === 'granted' ? 'none' : 'active', statusAfter: status === 'expired' || status === 'revoked' ? status : 'active' },
  }])),
  ...Object.fromEntries(['held', 'confirmed', 'released'].map(status => [`seats.${status}`, {
    customer: ACCESS_SAMPLE.customer, product: ACCESS_SAMPLE.product, actor: ACCESS_SAMPLE.actor,
    reason: status === 'held' ? 'checkout_started' : status === 'confirmed' ? 'payment_confirmed' : 'order_abandoned',
    order: { orderId: '00000000-0000-4000-8000-000000000001', orderNumber: 1001 },
    occurredAt: '2099-01-01T00:00:00Z',
    reservation: { id: '00000000-0000-4000-8000-000000000005', sessionId: '00000000-0000-4000-8000-000000000006', tierId: '00000000-0000-4000-8000-000000000007', quantity: 2,
      sessionStartsAt: '2099-06-01T12:00:00Z', statusBefore: status === 'held' ? null : 'held', statusAfter: status },
  }])),
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
  ...Object.fromEntries(['dispute.created', 'dispute.closed'].map(event => [event, {
    customer: { email: 'customer@example.com', userId: null },
    product: { id: '00000000-0000-4000-8000-000000000001' },
    payment: { id: '00000000-0000-4000-8000-000000000002', amount: 1100, currency: 'PLN',
      sessionId: 'cs_example', paymentIntentId: 'pi_example', stripeInvoiceId: null, subscriptionId: null },
    dispute: { stripeDisputeId: 'dp_example', stripeChargeId: 'ch_example',
      status: event === 'dispute.created' ? 'needs_response' : 'lost', reason: 'fraudulent',
      amount: 1100, currency: 'PLN', createdAt: '2026-10-01T00:00:00Z', accessRevoked: true, accessRestored: false, licenseRestored: false, restoredLicenses: [], restoredAccess: [] },
  }])),
  'refund.updated': {
    customer: { email: 'customer@example.com', userId: null }, product: { id: 'product_example' },
    payment: { id: 'payment_example', statusAfter: 'refunded' },
    refund: { stripeRefundId: 're_example', previousStatus: 'pending', status: 'succeeded',
      statusVersion: 2, amount: 1100, totalRefunded: 1100, currency: 'PLN', isFullRefund: true },
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
  'license.restored': {
    license: {
      id: 'lic_12345678', order: 'cs_test_a1b2c3d4e5f6g7h8i9j0', email: 'customer@example.com',
      tier: 'pro', domain: 'customer.example.com', issuanceSource: 'purchase',
      issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z',
      revokedAt: null, restoredAt: '2026-02-01T00:00:00.000Z',
    },
    product: { id: 'prod_12345678', name: 'Premium Plugin', slug: 'premium-plugin' },
    crlUrl: 'https://example.com/api/licenses/revoked?seller=seller-id',
  },
  ...Object.fromEntries((['issued', 'failed', 'corrected'] as const).map(status => [`invoicing.${status}`, {
    amountUnit: 'minor', actor: SYSTEM_ACTOR, occurredAt: SAMPLE_TIME,
    invoice: { id: '00000000-0000-4000-8000-000000000041', provider: 'fakturownia', providerInvoiceId: status === 'failed' ? null : '998877',
      number: status === 'failed' ? null : 'FV/1/2026', viewUrl: status === 'failed' ? null : 'https://example.fakturownia.pl/invoice/998877',
      statusBefore: status === 'corrected' ? 'issued' : 'issuing', statusAfter: status, attempt: 1,
      error: status === 'failed' ? 'Provider timeout' : null, willRetry: status === 'failed', paymentSynced: false },
    order: { orderId: '00000000-0000-4000-8000-000000000001', orderNumber: 1001, amount: 12300, currency: 'PLN', paymentProvider: 'stripe', status: 'completed' },
    customer: { userId: null, email: 'customer@example.com' }, product: SAMPLE_PRODUCT,
  }])),
  ...Object.fromEntries((['accrued', 'reversed'] as const).map(kind => [`commission.${kind}`, {
    amountUnit: 'minor', actor: SYSTEM_ACTOR, occurredAt: SAMPLE_TIME, partner: SAMPLE_PARTNER, product: SAMPLE_PRODUCT,
    commission: { id: '00000000-0000-4000-8000-000000000051', ledgerEntryId: '00000000-0000-4000-8000-000000000052', amount: kind === 'accrued' ? 2460 : -2460,
      currency: 'PLN', baseAmount: 12300, accruedAmount: 2460, paidAt: SAMPLE_TIME, eligibleAt: '2026-03-31T00:00:00Z', selfReferral: false, livemode: true },
    order: { orderId: '00000000-0000-4000-8000-000000000001', orderNumber: 1001, amount: 12300, currency: 'PLN', paymentProvider: 'stripe', status: kind === 'accrued' ? 'completed' : 'refunded' },
  }])),
  ...Object.fromEntries((['reserved', 'paid', 'cancelled'] as const).map(status => [`payout.${status}`, {
    amountUnit: 'minor', actor: SYSTEM_ACTOR, occurredAt: SAMPLE_TIME, partner: SAMPLE_PARTNER, product: null,
    payout: { id: '00000000-0000-4000-8000-000000000061', statusBefore: status === 'reserved' ? 'none' : 'reserved', statusAfter: status, amount: 2460, currency: 'PLN',
      cutoff: SAMPLE_TIME, payeeReference: 'partner-iban-ref', bankReference: status === 'paid' ? 'bank-123' : null, invoiceReference: status === 'paid' ? 'invoice-123' : null,
      bankAmount: status === 'paid' ? 2460 : null, paidAt: status === 'paid' ? SAMPLE_TIME : null, livemode: true, needsReview: false,
      commissionIds: ['00000000-0000-4000-8000-000000000051'] },
  }])),
  ...Object.fromEntries((['submitted', 'approved', 'rejected', 'cancelled'] as const).map(event => [event === 'submitted' ? 'refund.requested' : `refund.request_${event}`, {
    amountUnit: 'minor', actor: SYSTEM_ACTOR, occurredAt: SAMPLE_TIME, product: SAMPLE_PRODUCT,
    refundRequest: { id: '00000000-0000-4000-8000-000000000071', statusBefore: event === 'submitted' ? 'none' : 'pending', statusAfter: event === 'submitted' ? 'pending' : event,
      requestedAmount: 4900, currency: 'PLN', reason: 'Not what I expected', adminResponse: event === 'rejected' ? 'Course already consumed' : null,
      createdAt: SAMPLE_TIME, processedAt: event === 'submitted' ? null : SAMPLE_TIME },
    order: { orderId: '00000000-0000-4000-8000-000000000001', orderNumber: 1001, amount: 4900, currency: 'PLN', paymentProvider: 'stripe', status: 'completed' },
    customer: { userId: '00000000-0000-4000-8000-000000000081', email: 'customer@example.com' },
  }])),
  ...Object.fromEntries((['published', 'unpublished'] as const).map(state => [`product.${state}`, {
    actor: SYSTEM_ACTOR, occurredAt: SAMPLE_TIME, deleted: false,
    product: { ...SAMPLE_PRODUCT, isActive: state === 'published', availableFrom: null, availableUntil: null, productType: 'one_time' },
    availability: { before: state === 'published' ? 'unpublished' : 'published', after: state },
  }])),
  'product.price_changed': {
    amountUnit: 'minor', actor: SYSTEM_ACTOR, occurredAt: SAMPLE_TIME,
    product: { ...SAMPLE_PRODUCT, isActive: true, availableFrom: null, availableUntil: null, productType: 'one_time' },
    price: { before: { price: 10000, salePrice: null, salePriceUntil: null, recurringPrice: null, currency: 'PLN' },
      after: { price: 12000, salePrice: null, salePriceUntil: null, recurringPrice: null, currency: 'PLN' } },
  },
  'product.sold_out': {
    actor: SYSTEM_ACTOR, occurredAt: SAMPLE_TIME, product: SAMPLE_PRODUCT,
    session: { id: '00000000-0000-4000-8000-000000000091', label: 'Workshop', startsAt: '2099-06-15T10:00:00Z', capacity: 20, taken: 20, remaining: 0, salesOpen: true },
    reservation: { id: '00000000-0000-4000-8000-000000000092', status: 'held', quantity: 2 },
  },
  'test.event': {
    message: 'This is a test event from Sellf',
    system: { version: '1.0.0', environment: 'production' }
  }
};
