---
title: Buyer emails
description: Deliver buyer notifications through signed webhooks or the optional Supabase channel.
---

Sellf sends signed business webhooks by default. Your integration builds and sends buyer emails. Set up [Mailstack](https://github.com/jurczykpawel/mailstack) — free for sending emails — or use your own receiver.

Supabase Auth still sends sign-in and email-confirmation links. A guest who has paid gets a plain authentication link even when transactional emails are disabled. The link claims the purchase and opens the buyer's product; order content is delivered separately through webhooks. Free-product login and ordinary sign-in work the same way.

In **Settings → Shop → Buyer emails**, enable **Send buyer emails through Supabase** to use Sellf's existing templates. This consumes the free Supabase email allowance faster and may require a paid plan. Sellf does not configure a separate SMTP service. On upgrade, existing installations keep this option enabled so buyer messages do not stop unexpectedly. New installations default to off. You can turn it off after connecting and testing your receiver. Pending retries follow the current setting: purchase-access retries become plain sign-in links; notification-only retries are skipped.

## Mailstack example

Create a Sellf webhook endpoint pointing at your Mailstack receiver:

```text
https://your-mailstack.example/v1/hooks/sellf
```

Configure the same signing secret at both ends. Subscribe to `purchase.completed`, `order.placed`, `order.payment_reminder`, `order.cancelled`, `order.participants_needed`, `license.issued` (Pro) and `refund.issued` as needed. Webhook registration requires a Registered license; existing endpoints continue working. See [webhooks](/webhooks/) for signature verification, retries and the complete payload contract.

| Message | Event |
| --- | --- |
| Receipt / payment received | `purchase.completed` (Stripe or bank transfer) |
| Transfer instructions | `order.placed` |
| Payment reminder | `order.payment_reminder` |
| Cancellation with reason | `order.cancelled` |
| Missing participants (two stages) | `order.participants_needed` |
| License delivery | `license.issued` with `licenseKey` — the only event for the license-key email. Sellf emits exactly one per issued license (purchase, free grant, manual, API). `purchase.completed.licenses[]` is informational for integrations; do not send a key email from it. |
| Refund | `refund.issued` |

The receiver must deduplicate by delivery id, validate the signature and send to `customer.email`. Participant links and license keys are confidential delivery data: exclude them from application logs. Transactional messages must not be repurposed as marketing subscriptions.

Mailstack mappings/templates are managed separately in the Mailstack project. Confirm support for the selected events there before turning off Supabase delivery. Avoid enabling equivalent email automation in both channels unless duplicate emails are intentional.
