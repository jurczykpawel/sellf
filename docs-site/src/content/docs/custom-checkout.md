---
title: Custom checkout
description: Collect buyer, recipient, phone and participant details for one-time purchases.
---

A checkout profile controls the data collected for a product. Open the product editor,
choose **Checkout details**, and enable **Custom checkout for this product**.
Products without a profile keep their existing checkout and webhook format.

## Modules

- **Buyer:** allow people, organizations, or both. An organization fills in the same invoice
  section as the ordinary checkout: one "NIP or EU VAT number" field (the number sets the
  company country, a Polish NIP fetches the company from GUS), or "I have no NIP or the company
  is outside the EU" with a country choice; the address always uses separate fields.
- **Recipient:** an organization buyer can name a different recipient — an institution with
  a Polish NIP (for example a school) — inside the same invoice section. Leave it off when the
  buyer is also the recipient.
- **Phone:** optional or required; stored in international E.164 format (for example `+48500100200`).
- **Quantity:** set minimum and maximum seats (1–100). Choose a hidden fixed minimum,
  a checkout selector, or a product-page selector.
- **Participants:** requires Quantity. Collect one first name, last name and unique email per
  seat. Optional participants may be left entirely empty. At one seat, buyer prefill is available.

Profiles support the default checkout template and one-time products. Subscriptions, tips,
pay-what-you-want products, bundles and OTO are unsupported. Products issuing licenses cannot
use quantities above one. Invalid combinations are rejected when saving.

## Company lookup

Set the GUS key once in **Settings → Integrations**. With the integration enabled,
a valid Polish buyer NIP triggers company lookup in both ordinary and profile checkouts.
Without a key, buyers can enter details manually without a configuration error.
The same rules and messages apply to online payment and to a bank transfer order in a
profile checkout.
There is no product GUS switch. Legacy `buyer.gus` values in saved profiles are ignored
and removed by the database upgrade. Omit this field when writing profiles through
API v1 or MCP: it is rejected like other unknown profile fields.

## Example: five training seats

A municipality buys five seats for a school. Configure Buyer (organization), Recipient,
required Phone, Quantity (1–20) and required Participants. The municipality is the **buyer**
and provides its billing address and tax ID. The school is the **recipient** and supplies
its own address and tax ID. The contact provides a phone number and details for five participants.
All names in this example are fictional.

An admin opens **Payments → transaction details → Checkout data** to read the saved buyer,
recipient, phone, quantity and participant table. Additional custom field answers appear in
this section too. An incomplete-details warning means required checkout data was not collected;
the completed payment still grants access.

## Purchase webhook

For a product with a profile, `purchase.completed` adds `orderDetails` with stable keys:
`buyer`, `recipient`, `phone`, `participants`, `quantity`. Missing modules are `null`.
The objects preserve the stored module format: `buyer` has `v: 1`, `type`, name/company,
`nip`, `address`, `postal_code`, `city`, `country` and optional email; `recipient` has `v: 1`,
`differs` and company/address fields. Phone and quantity use `{ "v": 1, "value": ... }`;
participants use `{ "v": 1, "people": [{ "first_name": "Anna", "last_name": "Example", "email": "anna@example.com" }] }`.

For an organization, `invoice` uses the saved buyer: `needsInvoice`, `nip`, `companyName`,
`address`, `city`, `postalCode`, `country`. A different recipient is included as
`invoice.recipient` in its stored snake_case module format. Personal purchases without an
invoice request omit `invoice`. Products without a profile do not receive `orderDetails`
and retain their existing invoice format, plus `invoice.recipient` when the shop collects a recipient ([Webhooks](/webhooks/)). Existing `customFields` continue to carry resolved answers.

See [Webhooks](/webhooks/) for endpoint configuration and delivery settings.

## Changes during Stripe payment

For an eligible open on-site Stripe Checkout Session, changing the cart updates its items in the same session. Changes to language, return URL or buyer email require a replacement session; payments already in progress are left to complete. Sellf records cart versions and fulfills the version Stripe actually charged, including its saved prices and entitlements. This does not add a multi-product shopping cart.

Applying or removing a discount code also keeps the same eligible session and the card details already entered. Sellf applies its codes to the item prices, rather than changing Stripe discounts. While the code is being checked or the cart is being updated, payment is disabled. After the buyer submits payment, cart controls stay disabled until confirmation finishes; the cart is checked again immediately before confirmation. Server updates share a 15-second request budget, shorter than Stripe’s 20-second `runServerUpdate` timeout. The payment form stays mounted and refreshes through Stripe's `runServerUpdate`. Session reuse applies to one-time, non-event payments with at least two minutes left; other checkouts may require a new session.

## Checkout recovery and validation

The server returns the remaining session lifetime in seconds. The page counts from receipt of the response, independently of the buyer’s system clock; an API `409 checkout_session_expired` response is authoritative. Local expiry does not interrupt an ongoing payment authentication such as 3DS.

An expired payment session shows **Your payment session has expired** and **Start a new checkout**, instead of inviting the buyer to retry saving details. The new checkout checks current availability and prices again; an event seat is reserved again only if still available. Buyer values held by the page remain available, but the new Stripe form needs payment details again.

Email format and length errors appear beside the email field in the page language. An email address can have at most 254 characters. Correcting the field clears its error.

After a full refund, reopening the original payment-status link shows **Payment refunded**. Verification returns the terminal `payment_status: "refunded"` state without another fulfillment or access grant. It does not report a payment-processing failure or ask the buyer to check order details.

A partial refund preserves the completed-payment verification path and any remaining access. An open payment dispute shows **Payment disputed**, returns `payment_status: "disputed"`, and grants no access or new fulfillment.

If the cart changes during payment preparation, Sellf stops before confirmation and asks the buyer to review the cart before trying again. If the bundle preview cannot be read, checkout stays available without the component preview or savings claim. Returning to the payment confirmation page after a partial refund preserves access according to the order, but does not generate a post-purchase offer coupon.

## Access from several purchases

A full refund removes only the entitlement from that order. The buyer keeps the product while another qualifying purchase, paid bank transfer, bundle, order bump or active subscription still grants it. Refunding the last qualifying order removes the corresponding access.

Orders in `disputed` status, including a lost dispute, do not retain access after another order is refunded.

For time-limited products, another order retains access only until its own period ends. After a full refund, the deadline becomes the latest unexpired deadline among the remaining sources; a remaining unlimited source keeps unlimited access. Each new order records its duration and grant start, including add-on overrides (zero means unlimited), bundle components and guest claims. Two 30-day grants still add up before a refund; refunding either leaves 30 days from the remaining grant's own start, without transferring the refunded extension. Active subscriptions keep their subscription-managed open access while their current period is valid; a cancelled subscription can retain its already-paid period. Administrator grants and manual deadline changes are independent entitlements: a refund never shortens them, including unlimited access. A purchase made afterwards can extend access, but refunding it removes only that purchased extension. Repeated or delayed refund notifications preserve subsequent manual changes. An order-independent free grant records only the days it adds, separately from any paid period already on the access row. Refunding the paid order retains those free days until their own deadline. A free claim that leaves existing access unchanged adds no new period. A finite free grant onto a paid unlimited deadline adds no days; an explicit unlimited free grant remains an independent entitlement. A later purchase does not move the start of that free period. An open dispute retains the grant identity across refunds, including when another paid period stays active; a later win restores the remaining disputed period without the refunded extension. Manual deadline or duration changes made after the refund take precedence over that restoration. During the 2026.11.1 upgrade, Sellf saves the existing access deadline on older qualifying orders that lack grant terms, including bundle components, components of bundles sold as add-ons and claimed guest orders. Rows owned by another placement transfer or a subscription do not contribute their deadline to older one-time orders. The current product duration is never used to discard a known legacy deadline: it does not prove the original purchase terms. Later product-duration changes do not shorten that known period during another order's refund. Historical contributions to a combined deadline cannot be separated reliably, so each matching legacy order conservatively retains the known deadline; a refund can therefore retain more time than an exact historical split would. During the 2026.11.1 upgrade, existing manual, free and unknown-source access rows conservatively keep their entire current deadline as independent access, even if that deadline includes an older paid period that cannot be separated. Only orders without a matching access record use the claim/payment/placement date and available product or add-on duration as a fallback. For older placement transfers whose original effect can no longer be reconstructed after a later purchase, this conservative rule also retains the known deadline. New placement attempts that grant no access record no period. Unknown-source rows currently owned by a subscription or placement transfer follow that source instead of becoming independent grants.

Video loading and unavailable messages follow the buyer view language (English or Polish).

Cancelling an unpaid bank transfer with access granted on placement removes that order's period even if a later purchase extended the same product. Refunding a subscription invoice ends that subscription's rights while preserving separately purchased periods and administrator grants.
