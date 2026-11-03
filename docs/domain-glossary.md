# Sellf domain glossary

Use these terms in code, UI and discussion. English identifiers remain English;
Polish translations are UI labels for the same concepts.

| Canonical term | Definition | Code or schema evidence |
|---|---|---|
| API key | An owner's credential for scoped API calls; activation, rotation grace and permanent revocation jointly determine whether it works. | `public.api_keys`; `admin-panel/src/lib/api/api-key-status.ts` → `getApiKeyStatus` |
| Rotation grace period | A retired API key's limited period of continued use, unless revoked or expired. `is_active=false` denotes retirement; `rotation_grace_until` bounds continued use. | `public.api_keys.rotation_grace_until`; `public.verify_api_key` |
| Dispute | A Stripe payment dispute with its own processor status and outcome, reported independently of product licenses. | `public.payment_disputes`; `admin-panel/src/app/api/webhooks/stripe/dispute-handlers.ts` → `handleChargeDispute`, `dispute.created`, `dispute.closed` |
| Refund | A return of a payment amount whose processor status is distinct from the payment status. | `public.payment_refunds`; `admin-panel/src/lib/refunds/payment-status.ts` |
| Refund status version | A stored observation version used to order and deduplicate a refund’s status notifications. | `public.payment_refund_events`; `refund.statusVersion` |
| Business event | A committed order, access or reservation change captured transactionally for signed webhook delivery. | `public.business_events`; `admin-panel/src/lib/services/business-events.ts` |
| Free grant context | Validated checkout answers stored before the sign-in email and bound to a verified buyer and product when free access is granted. | `public.free_grant_contexts`; `admin-panel/src/lib/services/free-grant-context.ts` |
| Suspended access | An inactive grant retained with its original identity and term while a payment dispute awaits resolution. Manual deletion or a full refund prevents its restoration. | `public.apply_payment_dispute`; `public.payment_disputes.account_access` |
| Free trial (okres próbny) | A fixed-price subscription starts with no charge for the configured number of elapsed 24-hour days; recurring billing begins when that period ends. The checkout date preview uses the buyer’s timezone; the persisted billing date is authoritative after signup. | `products.trial_days`; `subscriptions.trial_end`; `admin-panel/src/lib/checkout/trial-display.ts` |
| License revocation by dispute | A revocation whose recorded owner is the dispute that changed the license. A later manual or refund decision removes that ownership; won restores only licenses still owned by its dispute. | `issued_licenses.revoked_by_dispute_id`; `payment_disputes.revoked_license_ids` |
| Purchase source (źródło zakupu) | Where an order came from — UTM tags, referrer host, landing page, device, country — frozen once when the order becomes a purchase (paid, bank-transfer order, free grant); renewals inherit the first checkout's source. | `public.purchase_attribution`; `public.snapshot_purchase_attribution`; `admin-panel/src/lib/attribution/` |
| Touch (kontakt): first / last | A recorded visit with its marketing labels. Last touch = the visit that led to the purchase (always, from the checkout link); first touch = the first known visit (only with the visitor's analytics consent). | `purchase_attribution.last_*` / `first_*`; `admin-panel/src/lib/attribution/collect.ts` |
| Channel (kanał) | Classification of a touch (`email`, `paid_social`, `paid_search`, `organic_social`, `organic_search`, `referral`, `affiliate`, `direct`, `other`, `unknown`) by the seller's ordered channel rules; a partner coupon always yields `affiliate`. | `public.attribution_channel_rules`; `public.classify_attribution_channel` |
| Click id retention | Seller-set number of days an ad click identifier (gclid, fbclid…) stays stored; kept only with marketing consent, then erased while its type remains. | `public.attribution_settings.click_id_retention_days`; `public.purge_attribution_click_ids` |
