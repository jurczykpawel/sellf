---
title: Events and price tiers
description: Schedule sessions, limit seats and increase prices automatically.
---

In a product's sales settings, enable **Event mode** and open **Dates and prices**. Events support one-time products; bundles, subscriptions and custom pricing cannot use event mode. Repeat purchases are enabled automatically when event mode is first enabled.

Add a session with start/end dates, time zone, title, venue, optional additional days and total seats. Date inputs use UTC; the selected time zone controls buyer presentation. Leave capacity empty for unlimited seats. The online link must use HTTPS and is shown only in purchased-event access and access emails. Close sales to stop new purchases without removing the session.

Every session needs at least one price tier. For example, offer **30 seats at PLN 47** until a chosen date, followed by **PLN 67** with no tier limit. Tier seats and total session seats are separate limits. Sellf selects the cheapest available tier; reserved seats count against availability for 30 minutes. Schedule `/api/cron?job=seat-reservations-expire` every minute with the existing `CRON_SECRET` so expired reservations return their seats. Enter each tier's label, price, seat limit, optional sale end and unique order.

Save the product, reopen its settings and select **What buyers will see / orders**. The preview uses the same availability calculation as checkout and shows remaining seats at the current price, the next price and the sale deadline. The session overview shows sold, reserved and available seats, and pages of orders with participants. **Export participants CSV** exports confirmed participants and requires the same Sellf license as payment CSV exports.

You can update a purchased session's date or venue. Sessions and tiers referenced by reservations cannot be removed; close sales instead. API v1 product GET responses include `event_mode` and `sessions`, with nested `tiers`. POST/PATCH accepts the same fields. Omit `sessions` to retain it or send a complete replacement list, preserving existing session/tier IDs. Removing referenced entries returns HTTP 409. The MCP product tools support the same input.

The `purchase.completed` product and bump entries include `sessionId`, `sessionStartsAt`, `sessionLabel`, `tierId` and `tierLabel` for event lines only. Date and labels are order snapshots. Online links are excluded from this webhook.

For your external page, allow its origin in embed settings and read public availability:

```js
const response = await fetch(
  'https://shop.example.com/api/public/products/workshop/availability',
  { cache: 'no-store' }
);
if (!response.ok) throw new Error('Availability unavailable');
const { currency, sessions } = await response.json();
for (const session of sessions) {
  console.log(session.startsAt, session.currentTier?.price, currency,
    session.currentTier?.seatsLeft, session.nextTierPrice);
}
```

The public response contains neither online links nor participant data. Refresh it when starting checkout; availability can change while a visitor reads the page.

**Omnibus:** Sellf treats rising event tiers as a planned price schedule and does not present a 30-day lowest-price comparison for events. This is a seller decision to confirm for their offer and applicable requirements.

Self-hosters should update the magic-link template from `admin-panel/public/auth-email-templates/magic-link.html` to display event dates and online links in access emails. Existing custom templates need the optional `event_date` and `event_online_url` data fields.
