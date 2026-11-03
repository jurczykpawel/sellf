---
title: Taxes
description: Fixed rates, Stripe Tax and international B2B sales.
---

## International B2B sales

Sellf stores the buyer's country and NIP / VAT number with the order. A separate
recipient does not determine tax. Order details remain available in payments and
purchase webhooks. The company country decides the rule: Poland requires a valid
NIP (checksum); other EU countries require a VAT number in that country's format
(the country prefix is added if the buyer leaves it out; Greece uses EL); outside
the EU any identifier is accepted without a format check (optional, up to 40
characters, no `<` or `>`). The order, the invoice, `purchase.completed`
(`invoice.taxIdType`, `invoice.taxIdCountry`) and the payments API carry the type
(`pl_nip`, `eu_vat`, `other`) and country. GUS lookup is offered only for Poland.

**Optional VIES check.** Set `SELLF_VIES_CHECK_ENABLED=true` to ask the EU VIES
service about EU VAT numbers when the order is placed. It never blocks the order:
after 3 seconds or on an outage the result is `unavailable`. The result is stored as
`tax_id_vies` (`valid`, `invalid`, `unavailable`) on the buyer in `order_details`.

With **Stripe Tax**, Sellf sends the buyer's address and EU VAT number to the Stripe
Customer. Stripe calculates tax and can apply reverse charge for eligible sales
to businesses in another EU country. Domestic VAT numbers do not trigger cross-border
reverse charge. Stripe performs VIES verification, but tax treatment depends on
the required number format even when government verification is still pending or
unsuccessful; the seller remains responsible for checking buyer information.
See [Stripe's EU rules](https://docs.stripe.com/tax/supported-countries/european-union)
and [tax ID validation](https://docs.stripe.com/billing/customer/tax-ids).

Enable Stripe Tax, configure the business address and tax registrations in Stripe,
choose the correct product tax codes, and select Stripe Tax in Sellf's tax settings.
Check both a domestic and an international business purchase in test mode.
With **fixed local rates**, Sellf keeps the configured rate regardless of a foreign
VAT number. There is no automatic reverse charge or VIES lookup in this mode.

When Stripe returns `reverse_charge` in the saved tax result, the Fakturownia
integration sends the NP rate and the reverse-charge annotation. Zero tax alone
does not activate that annotation. Confirm the applicable NP sale classification
in Fakturownia with your accountant, especially for KSeF; Sellf does not infer
that classification from the buyer's country.
See [Fakturownia's API](https://github.com/fakturownia/API).
