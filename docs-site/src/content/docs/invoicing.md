---
title: Invoicing
description: Configure Fakturownia and manage order invoices.
---

In **Settings → Shop → Invoicing**, choose Fakturownia, enter the account domain
(`your-account.fakturownia.pl`) and API token, then **Check connection**. Complete
seller name, tax number and address in the shop's legal settings first.
`APP_ENCRYPTION_KEY` must be configured on the server. A blank token field keeps
the saved token; enter a new token when changing the account domain.

Choose **Automatic** to issue invoices after completed payments, or **Manual** to
issue from payment details. Issuance errors do not interrupt order fulfillment.
Invoices appear in the payment list and order details with a link to Fakturownia.
Only failed invoices offer **Retry invoice**. The same order keeps its external
reference across retries, including when the provider accepted a previous attempt.

Set the VAT exemption basis when selling exempt products, and enable the exemption
basis option in Fakturownia. The line template supports `{product}`, `{date}`,
`{session}` and `{tier}`. Prices, quantities, tax and allocated discounts come from
saved order lines; bumps remain separate lines. A separate recipient retains its
name, address and tax number.

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
