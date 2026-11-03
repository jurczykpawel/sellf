---
title: Traditional bank transfers
description: Configure payment terms, access and invoices for offline orders.
---

Enable **Traditional bank transfer** under **Settings → Payments**. Enter the account holder and a valid Polish IBAN or NRB (checksum verified), optionally the bank name, and a title template containing `{order_number}`. The preview shows the resulting title. Choose a deadline of 1–60 days (default 14), whether to grant access on placement (default on), and the unpaid order limit per email (default 3).

In each product's checkout profile, enable the buyer module and choose eligible buyer types: person, organization, or both. No profile or an empty selection means no transfer. Subscription, bundle and custom-price products do not support this checkout profile. Changing buyer type updates the offered payment methods.

Configure `ALTCHA_HMAC_KEY` on the server: transfer orders always require ALTCHA, including shops that use another captcha for login.

Buyers choose **Pay online** or **Traditional bank transfer**, accept the terms and complete ALTCHA. Transfer orders do not use Stripe. The **Order with obligation to pay** button opens the order's signed instructions link, valid for 61 days. It includes the account, amount, title, deadline and **Print / save PDF**. Keep this private link; it needs no login.

When enabled, access starts on placement; event seats remain reserved until payment or cancellation. Licenses, affiliate commissions and `purchase.completed` wait for payment. In **Payments**, filter **Awaiting bank transfer**, check the deadline and highlighted overdue rows. The dashboard shows the overdue count. **Mark as paid** requires the exact full booked amount and the date received (UTC). **Cancel order** requires a reason, returns seats and coupon use, and removes access granted by that order while preserving other entitlements.

Sellf has no separate transactional email service. Transfer instructions, the reminder and the cancellation notice are sent through the Supabase Auth email (with the order link) for every transfer order. When self-hosting, update both Auth templates (`magic-link.html`, `confirmation.html`) and their subjects (`mail_kind`) in the Auth configuration. Sellers can send their own messages through `order.placed` webhooks (for example n8n or Listmonk). `order.cancelled` and `order.overdue` support follow-up automation; payment uses `purchase.completed`. API automation can use `POST /api/v1/payments/:id/mark-paid` and `/cancel` with `payments:write`.

With invoicing in **auto** mode, placement schedules an unpaid invoice with the order's deadline. Invoice failures do not block the order and retry through `invoices-retry`; payment updates the existing invoice rather than creating another. After cancellation, the invoice section links to the provider for a manual correction; mark it corrected once completed.

Schedule the authenticated `/api/cron` jobs: `bank-transfer-overdue` daily, `fulfillment-resume` and `invoices-retry` every minute, `transfer-reservations` every 5 minutes, using `CRON_SECRET` as the bearer credential. Orders without a timed reservation are never cancelled automatically.

**Timed reservation (events).** In the transfer settings configure: timed reservation (on by default), reminder after N hours (default 24), release after N hours (default 48; must be later than the reminder) and the extension after "I have sent the transfer" (default 72 h). The payment term (invoice deadline) stays the configured number of days; the reservation is separate. After the reminder the buyer gets a mail with the order link; on that page they can click **I have sent the transfer** once (with a short note), which extends the hold and shows a badge in the payment details so you check the statement. After the deadline the order is cancelled automatically: the seat, tier price and coupon use return to the pool, access from that order is withdrawn and the buyer gets a mail. A transfer is not offered when the session starts before the end of the reservation window. Regular products never expire.

**Invoice = no expiry.** When an invoice is issued for an unpaid order (in Sellf, or an integration reports it with `POST /api/v1/payments/:id/invoice-issued`; in the panel: **Invoice issued outside Sellf**), the order is "invoice issued, awaiting payment": the seat is held without expiry, even past the due date. Only **Cancel order** releases it; then issue a correction. In invoicing **auto** mode Sellf issues the invoice at placement, so such orders do not expire.

**Transfer after cancellation.** The system never revives a cancelled order on its own. In the cancelled order's details the administrator chooses **Accept late transfer at order price** (full amount, receipt date, reason; the seat may exceed the limit and is marked oversold) or returns the money outside Sellf. An order whose invoice was corrected cannot be reopened.

Every state change sends a signed webhook: `order.placed`, `order.payment_reminder`, `order.transfer_declared`, `order.invoice_issued`, `order.cancelled`, `order.reopened`, `purchase.completed` (see [Webhooks](/webhooks/)).

**Pay online from the link.** The order page (linked from the mails and from `payUrl` in webhooks) has a **Pay online** button. An unpaid order is paid at its saved amount (price and seat stay reserved) through Stripe Checkout. An order cancelled after its window can be paid online only while its price is still current, seats remain and the coupon is valid; the same order is then restored (`order.reopened`, then `purchase.completed`). If price or availability changed, the page leads to a new order at the current price. An order paid online stays a transfer order but carries a Stripe payment, so refunds work as for card orders. If an administrator marks the transfer paid while an online payment is in progress, the second payment is refunded automatically.
