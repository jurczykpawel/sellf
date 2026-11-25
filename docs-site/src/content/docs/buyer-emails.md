---
title: Buyer emails
description: Deliver buyer notifications through signed webhooks or the optional Supabase channel.
---

Sellf sends signed business webhooks by default. Your integration builds and sends buyer emails. Set up [Mailstack](https://github.com/jurczykpawel/mailstack) — free for sending emails — or use your own receiver.

Supabase Auth still sends sign-in and email-confirmation links. A guest who has paid gets a plain authentication link even when transactional emails are disabled. The link claims the purchase and opens the buyer's product; order content is delivered separately through webhooks. Free-product login and ordinary sign-in work the same way.

After a guest pays for a subscription, the checkout confirmation requests the first access email even if the invoice is already recorded. A new buyer opens the link to confirm their address and activate access.

In **Settings → Shop → Buyer emails**, enable **Send buyer emails through Supabase** to use Sellf's existing templates. This consumes the free Supabase email allowance faster and may require a paid plan. Sellf does not configure a separate SMTP service. On upgrade, existing installations keep this option enabled so buyer messages do not stop unexpectedly. New installations default to off. You can turn it off after connecting and testing your receiver. Pending retries follow the current setting: purchase-access retries become plain sign-in links; notification-only retries are skipped.

When a recorded payment is still being fulfilled after the initial short wait, its first access email waits in the authentication-mail queue. Once fulfillment finishes, delivery reads the current purchase details and includes the product and paid amount when buyer emails are enabled. This applies to subscriptions and one-time purchases, including a buyer's first email confirmation. The first retry is due after two minutes. Keep the retry worker running as described below.

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

## Delivery limits and pending mail

Sign-in mail requests and the retry worker share a limit of **5 attempts per inbox in 24 hours**. Address variants delivered to the same inbox, including plus tags and Gmail dots, share that limit. This is separate from Supabase Auth and SMTP-provider limits. A queued message that hits the daily limit waits another 24 hours without consuming a retry attempt.

The authentication-mail queue makes up to six retry attempts. A successful access or license grant stays successful while its email waits. For API grants, inspect `license.email_pending`; `POST /api/v1/licenses` uses `emailPending`. Repeating **Grant access** can resume an abandoned license email. See [SMTP and the retry schedule](/email-setup/).

On a long-running production server, the app checks the queue every minute. For deployments without a persistent process, schedule `/api/cron?job=auth-mail-retry` every minute with `Authorization: Bearer <CRON_SECRET>`. Keep that credential in the scheduler's secret store. This job is separate from webhook delivery retries.

## Recovering access after payment

After requesting a fresh sign-in link successfully, the login page clears the previous expired-link warning. A refused send keeps that warning visible.

Withdrawing or archiving an offer after checkout has started does not cancel a completed payment: its confirmation page still offers a sign-in link, and confirming that email claims the paid product. The offer remains unavailable for new purchases.

In **My purchases**, subscription cards retain the purchased name, price, currency and billing cadence when an offer is deactivated or archived.

A paused offer keeps its recorded purchase and access in the buyer library, with a paused message instead of an unavailable content link. Archived content remains open to its buyers. For subscriptions created before this update, the summary uses the first saved positive paid invoice amount (including its VAT and discounts); if no paid invoice exists, it uses the catalogue terms available during the update.

## Refund decisions

Buyers check a refund request’s status in **My purchases**. Sellf does not send a native Supabase email for approval or rejection. Optional decision emails depend on the seller’s webhook receiver: `refund.request_approved` and `refund.request_rejected` describe the decision; `refund.issued` describes the processor refund. Enabling Supabase buyer emails alone does not enable decision notifications. The request modal therefore does not promise an email response.

## Sign-in link limits and language

When the daily inbox allowance is exhausted, sign-in forms show that cause and a retry time in the current language. The gateway returns HTTP 429 with `code: address_rate_limited` and `Retry-After` in seconds. The database daily window resets at 00:00 UTC; for Upstash, the suggested retry is conservatively 24 hours later. Existing IP and Auth-provider limits remain unchanged. Ordinary sign-in links preserve the requested Polish or English language and the role-based destination. Email-confirmed forms open the destination in the language saved with the submission, including on another device or with different language cookies. Explicit product-access destinations retain their own language.
