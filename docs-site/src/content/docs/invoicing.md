---
title: Invoicing
description: Configure Fakturownia and manage order invoices.
---

In **Settings → Shop → Invoicing**, choose Fakturownia, enter the account domain
(`your-account.fakturownia.pl`) and API token, then **Check connection**. Complete
seller name, tax number and address in the shop's legal settings first.
With **Provider: Disabled** Sellf issues no invoices and the section shows only the provider and
**Save**; the Fakturownia fields are hidden and keep their saved values for when you switch back.
`APP_ENCRYPTION_KEY` must be configured on the server. A blank token field keeps
the saved token; enter a new token when changing the account domain.

Choose **Automatic** to issue invoices after completed payments, or **Manual** to
issue from payment details. Issuance errors do not interrupt order fulfillment.
Invoices appear in the payment list and order details with a link to Fakturownia.
Only failed invoices offer **Retry invoice**. The same order keeps its external
reference across retries, including when the provider accepted a previous attempt.

In **Payments**, use **Search** to find an order by buyer email or order number,
then open **Details**. Search covers the full payment history, including older orders.

Automatic invoicing applies to orders placed from the moment it is enabled.

Set the VAT exemption basis when selling exempt products, and enable the exemption
basis option in Fakturownia. The line template supports `{product}`, `{date}`,
`{session}` and `{tier}`. Prices, quantities, tax and allocated discounts come from
saved order lines; bumps remain separate lines. A separate recipient retains its
name, address and tax number. In the standard checkout buyers can add a recipient only
when Settings → Shop → Invoice recipient is on (off by default; not for subscriptions); a company
bought without a NIP gets an invoice with its name and address and no tax number. A recipient is
always an institution with a Polish NIP, in the profile checkout too.

Schedule `/api/cron?job=invoices-retry` every minute with the existing `CRON_SECRET`
bearer credential. Failed attempts wait 1, 2, 4 and 8 minutes, up to five attempts.
Interrupted attempts can be recovered after ten minutes. The cron also updates
previously unpaid invoices after the order is marked paid.

After a full refund or cancellation, create the correction in Fakturownia using
the invoice link, then choose **Mark as corrected** in payment details. Sellf
records the correction; this button does not create a document at the provider.

Already issued invoices add `invoice.number` and `invoice.viewUrl` to outgoing
purchase events. Invoices issued afterwards become visible in the panel.
The bank-transfer placement integration calls `issueInvoiceForTransaction(id)`;
its order deadline is passed unchanged to Fakturownia.

Fakturownia documents 1,000 requests per IP per minute and two concurrent requests.
Use a separate test account for integration checks; their support can designate it
as a test account. There is no separate public sandbox API host. The optional
connection test requires `FAKTUROWNIA_TEST_DOMAIN` and `FAKTUROWNIA_TEST_TOKEN`.

Exemption text referring to articles 113, 43 or 82 maps to Fakturownia's documented
KSeF exemption choice; the original text is retained in invoice notes. Configure
KSeF authorization and automatic submission in Fakturownia itself.

## Tax ID and company details

The standard checkout and product checkout profiles share one invoice section. A NIP or EU VAT number sets the company country; a Polish NIP can fetch details from GUS when the shop integration is configured. A company without a tax ID or outside the EU selects its country and enters its name and address manually. Street, postal code and city are separate fields. A separate recipient requires a Polish NIP. Online payment and traditional bank transfer use the same details. See [checkout data](/custom-checkout/).

Saved buyer company details from embedded Stripe Checkout are visible in **Payments → Details**, including company name, tax ID and address, even without a checkout profile. A collected Stripe tax ID is treated as an invoice request.

When saving invoice settings, invalid account domains, missing API tokens and invalid description templates are explained next to the corresponding field. Focus moves to the first invalid field; rejected settings are not saved. A blank token retains the saved token only for the same account.
