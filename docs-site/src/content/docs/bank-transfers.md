---
title: Traditional bank transfers
description: Configure payment terms, access and invoices for offline orders.
---

Enable **Traditional bank transfer** under **Settings → Payments**. Enter the account holder and a valid Polish IBAN or NRB (checksum verified), optionally the bank name, and a title template containing `{order_number}`. The preview shows the resulting title. Choose a deadline of 1–60 days (default 14), whether to grant access on placement (default on), and the unpaid order limit per email (default 3).

In each product's checkout profile, enable the buyer module and choose eligible buyer types: person, organization, or both. No profile or an empty selection means no transfer. Subscription, bundle and custom-price products do not support this checkout profile. Changing buyer type updates the offered payment methods.

Configure `ALTCHA_HMAC_KEY` on the server: transfer orders always require ALTCHA, including shops that use another captcha for login.

Buyers choose **Pay online** or **Traditional bank transfer**, accept the terms and complete ALTCHA. Transfer orders do not use Stripe. The **Order with obligation to pay** button opens the order's signed instructions link, valid for 61 days. It includes the account, amount, title, deadline and **Print / save PDF**. Keep this private link; it needs no login.

When enabled, access starts on placement; event seats remain reserved until payment or cancellation. Licenses, affiliate commissions and `purchase.completed` wait for payment. In **Payments**, filter **Awaiting bank transfer**, check the deadline and highlighted overdue rows. The dashboard shows the overdue count. **Mark as paid** requires the exact full booked amount and the date received (UTC). **Cancel order** requires a reason, returns seats and coupon use, and removes access granted by that order while preserving other entitlements.

Sellf has no separate transactional email service. When access is granted on placement, the Supabase Auth access link email carries transfer instructions. Update both Auth templates (`magic-link.html`, `confirmation.html`) when self-hosting. Sellers can send their own messages through `order.placed` webhooks (for example n8n or Listmonk). `order.cancelled` and `order.overdue` support follow-up automation; payment uses `purchase.completed`. API automation can use `POST /api/v1/payments/:id/mark-paid` and `/cancel` with `payments:write`.

With invoicing in **auto** mode, placement schedules an unpaid invoice with the order's deadline. Invoice failures do not block the order and retry through `invoices-retry`; payment updates the existing invoice rather than creating another. After cancellation, the invoice section links to the provider for a manual correction; mark it corrected once completed.

Schedule the authenticated `/api/cron` jobs: `bank-transfer-overdue` daily, `fulfillment-resume` and `invoices-retry` every minute, using `CRON_SECRET` as the bearer credential. Overdue orders are never cancelled automatically.
