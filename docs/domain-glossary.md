# Sellf domain glossary

Use these terms in code, UI and discussion. English identifiers remain English;
Polish translations are UI labels for the same concepts.

| Canonical term | Definition | Code or schema evidence |
|---|---|---|
| API key | An owner's credential for scoped API calls; activation, rotation grace and permanent revocation jointly determine whether it works. | `public.api_keys`; `admin-panel/src/lib/api/api-key-status.ts` → `getApiKeyStatus` |
| Rotation grace period | A retired API key's limited period of continued use, unless revoked or expired. `is_active=false` denotes retirement; `rotation_grace_until` bounds continued use. | `public.api_keys.rotation_grace_until`; `public.verify_api_key` |
| Dispute | A Stripe payment dispute with its own processor status and outcome, reported independently of product licenses. | `admin-panel/src/app/api/webhooks/stripe/route.ts` → `handleChargeDisputeCreated`, `dispute.created`, `dispute.closed` |
| Refund | A return of a payment amount whose processor status is distinct from the payment status. | `public.payment_refunds`; `admin-panel/src/lib/refunds/payment-status.ts` |
| Refund status version | A stored observation version used to order and deduplicate a refund’s status notifications. | `public.payment_refund_events`; `refund.statusVersion` |
| Business event | A committed order, access or reservation change captured transactionally for signed webhook delivery. | `public.business_events`; `admin-panel/src/lib/services/business-events.ts` |
| Free grant context | Validated checkout answers stored before the sign-in email and bound to a verified buyer and product when free access is granted. | `public.free_grant_contexts`; `admin-panel/src/lib/services/free-grant-context.ts` |
