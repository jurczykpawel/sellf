---
title: Custom checkout
description: Collect buyer, recipient, phone and participant details for one-time purchases.
---

A checkout profile controls the data collected for a product. Open the product editor,
choose **Sales and settings → Checkout**, and enable **Custom checkout for this product**.
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
