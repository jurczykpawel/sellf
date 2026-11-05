---
title: "Purchase sources (attribution)"
description: "Where every purchase came from: UTM tags, referrer, first and last touch, channel, net revenue per source — readable by the API, MCP and webhooks."
---

Every order in Sellf stores **where it came from**, frozen at the moment of purchase. The source
never changes later, so a report for last month gives the same answer next year.

## What is recorded

| Field | Meaning |
|---|---|
| `channel` | Classified channel of the last touch: `email`, `paid_social`, `paid_search`, `organic_social`, `organic_search`, `referral`, `affiliate`, `direct`, `other`, `unknown` (or your own channel names) |
| `last.*` | Touch that led to the purchase: `source`, `medium`, `campaign`, `content`, `term`, `utm_id` (UTM tags), `referrer_host` (host only, no path), `landing_path` (no query string), `at` |
| `first.*`, `first_channel` | First known visit — only with the visitor's analytics consent |
| `sessions_count`, `first_seen_at`, `days_to_purchase` | Visits and time from the first visit to the purchase (with consent) |
| `click` | Ad click id type (`gclid`, `fbclid`, `gbraid`, `wbraid`, `msclkid`, `ttclid`, `twclid`, `li_fat_id`) and the id itself — **only with marketing consent**, erased after the retention you set (default 30 days; the type stays) |
| `device_class`, `country` | `desktop` / `mobile` / `tablet` / `bot` from the User-Agent; country from the CDN header (`cf-ipcountry`) when present |
| `kind` | `payment`, `subscription`, `renewal`, `bank_transfer`, `free` |
| `mode`, `consent` | `url` (from the checkout link only), `stored` (first and last touch), `none` (nothing collected); visitor consent level |

Paid orders (card, BLIK, …), subscriptions (renewals inherit the source of the first checkout),
bank transfers and free products are all covered. A purchase with a partner (affiliate) coupon
is always in the `affiliate` channel.

## Two modes, by consent

- **No cookie consent** — only the address that opened the checkout is used (UTM tags, external
  referrer host, landing path). Nothing is stored in the browser.
- **Analytics consent** — the collector keeps the first and the last touch and a session counter
  in `localStorage` of the page's own domain. Marketing consent additionally keeps the ad click id.

On Sellf's own pages the consent comes from Sellf's cookie banner. On your own pages (embed
checkout, content gate) declare it from your banner:

```html
<script>
  // after your cookie banner decides:
  window.sellfAttributionConsent = 'analytics'; // 'none' | 'analytics' | 'marketing'
</script>
```

The collector runs inside the existing scripts — the embed checkout loader
(`/embed/v1/checkout.js`) and the content gate (`gate.js`); nothing extra to paste. Links from
your page to the Sellf checkout on another domain carry the source in the `sf_a` parameter, so
UTM tags are not lost between domains.

Tag your links consistently, e.g. `utm_source=listmonk&utm_medium=email&utm_campaign=mail-05&utm_content=cta-1`
or `utm_source=facebook&utm_medium=paid_social`.

## Channel rules

**Settings → Purchase sources**: retention of ad click ids (1–365 days) and channel rules. The
first matching active rule (lowest priority number) wins. Default rules can be switched off; your
own rules are added on top (fields `source`, `medium`, `campaign`, `referrer_host`,
`click_id_type`; conditions `in`, `equals`, `contains`, `host_in`, `exists`). Rules apply to new
purchases; recorded purchases keep their channel.

## Reading it

### Panel

**Sales → Sales sources**: last or first touch, a date range, and a table of channel, source,
campaign and partner with orders, gross and net revenue (net of refunds). Every column of a row
comes from the same touch. An ad click id belongs to the visit it arrived with: a later campaign
visit without one replaces it, so the last-touch channel is never taken from an older ad click. Default rules give explicit paid or email campaign labels precedence over a retained click identifier.

### API (aggregates, no personal data) — scope `analytics:read`

```bash
curl -H "X-API-Key: $KEY" "https://shop.example.com/api/v1/analytics/attribution?days=3"
```

Parameters: `days` (default 30) or `from`/`to` (ISO), `touch=last|first`,
`group_by` (CSV of `channel, source, medium, campaign, content, term, referrer_host, landing_path,
product, country, device_class, affiliate, kind, day`; default `channel,source,medium,campaign,content`),
`product_id`. Each row: dimensions + `currency, orders, paid_orders, free_orders, customers, gross,
refunded, net, net_per_customer, avg_days_to_purchase`. Amounts are in **major units**, per
currency; `net` subtracts refunds, a disputed payment counts as fully refunded. Small groups are
not merged.

```json
{ "data": { "rows": [
  { "channel": "email", "source": "listmonk", "medium": "email", "campaign": "mail-05", "content": "cta-1",
    "currency": "PLN", "orders": 4, "paid_orders": 4, "free_orders": 0, "customers": 4,
    "gross": 396, "refunded": 0, "net": 396, "net_per_customer": 99, "avg_days_to_purchase": 0.4 }
] } }
```

### Per order — scope `payments:read`

`GET /api/v1/payments?embed=attribution` adds `attribution` to every payment (or `null`).

### MCP (agents)

`get_purchase_attribution` — no arguments means "last 3 days, last touch". Ask your agent:
*"Where did purchases from the last 3 days come from?"*. `list_payments` accepts
`embed: "attribution"`.

### Webhook

`purchase.completed` carries `attribution` (channel, last/first touch, device, country,
`clickIdType`) — never the click id itself. See [Webhooks](/webhooks/).

### SQL (self-hosted)

```sql
SELECT public.get_attribution_report(now() - interval '3 days', now(), 'last', NULL, NULL);
```
