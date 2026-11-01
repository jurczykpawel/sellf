# Recorded Stripe test-mode contracts

Recorded on 2026-10-28 through real Stripe API operations: confirmed PaymentIntents
with `pm_card_visa`, full and partial refunds, `pm_card_pendingRefund`,
`pm_card_refundFail`, `pm_card_createDispute` with `winning_evidence` / `losing_evidence`, and a monthly subscription advanced on a test clock through
renewal and invoice finalization. Events were fetched from `/v1/events`; refund
lists from `/v1/refunds?charge=…`. Event API version is `2025-09-30.clover` (the
account's event version); requests used the application's `2026-08-26.dahlia`.

IDs have consistent replacements. Personal fields, client secrets, receipt links,
payment fingerprints, request identifiers, and metadata were cleared. No financial
amount, status, line-parent shape, line period, or paid timestamp was changed.
`charge_refunded_full.json` genuinely has no `refunds` field.

Tests derive missing-field and wrong-subscription/proration variants by deleting
or changing only the field being exercised on a clone of these recordings.
Receiver rules: a full refund requires a real refund ID, succeeded status, positive
payment amount and a cumulative full refund; pending/failed must stay unconfirmed.
Renewal requires invoice/subscription/product/customer bindings, a paid amount and
paidAt, and the period of that invoice's own recurring line. Never infer it from
delivery time or the latest subscription state.

The clock (including its customer/subscription) was deleted. The test product and
price were archived; ordinary test payments were refunded. The pending-refund
payment method was recorded in pending state, with its eventual state tracked in
the private verification report.

Dispute fixtures include genuine `charge.dispute.created` and `charge.dispute.closed`
for won/lost outcomes. No product license was needed to produce these events.

Additional lifecycle recordings cover a declined renewal followed by immediate
cancellation (`ended_at` before the unpaid item's period end), plus scheduled
cancellation and its paid invoice. `consumer_subscription_canceled_legacy.json` is
the independent consumer's already-anonymized payload from 2026-10-28, with further
identifier/personal-field cleanup; its old endsAt demonstrates the reported mismatch.

`invoice_expanded_payments.json` records a paid invoice retrieved with
`expand[]=payments`; its test clock/customer were deleted and price/product archived.
The regression removes both optional `parent` and `payments` from the event and
checks that the receiver's payment/refund correlation still gets the real intent ID.

The `checkout_completed_receiver`, `dispatch_refund_*` and `unmatched_refund`
recordings were captured on 2026-10-31 from Stripe test-mode `GET /v1/events`.
Checkout uses the provider's [Stripe CLI fixture](https://github.com/stripe/stripe-cli/blob/master/pkg/fixtures/triggers/checkout.session.completed.json)
with an explicit test price and local product binding. Refunds follow real
`pm_card_visa` PaymentIntents and `refunds.create`, including successive partial
refunds. IDs/emails are anonymized and personal fields/client secrets removed.
The integration tests consume fresh provider events, not reconstructed event
objects; `RECORD_STRIPE_FIXTURES=1` records their sanitized reference copies.

`dispute_payment_intent_{won,refund}` were recorded on 2026-11-01 in the
API retest of ordinary, unlicensed products. They preserve the provider's
product/user metadata for installation ownership checks. Client secrets, receipt
fields and personal payment details are removed; customer email aliases are
anonymized. No new remote environment is required to exercise these recordings.
