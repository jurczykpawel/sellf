# Cookie Consent & Tracking Setup

Sellf includes a built-in cookie consent management system powered by [Klaro](https://klaro.org/) v0.7. It supports Google Tag Manager, Meta Pixel (with Conversions API), Umami Analytics, and custom scripts — all configurable from the admin panel with zero environment variables required.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Quick Setup](#quick-setup)
- [Detailed Configuration](#detailed-configuration)
  - [1. Enable Consent Banner](#1-enable-consent-banner)
  - [2. Meta Pixel & Conversions API](#2-meta-pixel--conversions-api)
  - [3. Google Tag Manager](#3-google-tag-manager)
  - [4. Umami Analytics](#4-umami-analytics)
  - [5. Custom Scripts](#5-custom-scripts)
  - [6. Conversions Without Consent](#6-conversions-without-consent)
  - [7. Consent Logging](#7-consent-logging)
- [How It Works](#how-it-works)
  - [Consent Flow](#consent-flow)
  - [Script Injection](#script-injection)
  - [Google Consent Mode V2](#google-consent-mode-v2)
  - [Server-Side Conversions (CAPI)](#server-side-conversions-capi)
  - [Event Tracking](#event-tracking)
- [Database Schema](#database-schema)
- [Common Scenarios](#common-scenarios)
- [Verification & Debugging](#verification--debugging)
- [Key Files](#key-files)

---

## Architecture Overview

```
Admin Panel (/dashboard/integrations)
  │
  ▼
integrations_config table (singleton row, id=1)
  │
  ▼
get_public_integrations_config() RPC (public, safe subset of config)
  │
  ▼
Root Layout (server component) fetches config
  │
  ├─► TrackingProvider (injects scripts + Klaro)
  └─► TrackingConfigProvider (React context for event tracking hooks)
```

All configuration is stored in the database and managed through the admin UI at `/dashboard/integrations`. No environment variables are needed for consent or tracking.

---

## Quick Setup

1. Go to `/dashboard/integrations` → **Consents** tab
2. Enable **"Require Consent"** → Save
3. (Optional) Add tracking IDs in **Analytics** or **Marketing** tabs
4. Done — Klaro banner appears on all pages

---

## Detailed Configuration

### 1. Enable Consent Banner

**Admin Panel:** `/dashboard/integrations` → Consents tab

| Setting | Effect |
|---------|--------|
| Require Consent | Shows Klaro banner, blocks non-essential scripts until user consents |
| Consent Logging | Logs each user's consent choices to `consent_logs` table (for GDPR auditing) |
| Send conversions without consent | Sends Purchase/Lead events via CAPI even if user declines cookies (legitimate interest) |

When consent is enabled, tracking scripts are injected with `type="text/plain"` and a `data-name` attribute. Klaro intercepts these and only converts them to executable JavaScript after the user consents to that specific service.

### 2. Meta Pixel & Conversions API

**Admin Panel:** `/dashboard/integrations` → Marketing tab

| Field | Format | Where to find |
|-------|--------|---------------|
| Pixel ID | 10-20 digit number | Meta Events Manager → Settings |
| CAPI Token | Access token string | Events Manager → Settings → Generate Access Token |
| Test Event Code | `TEST12345` | Events Manager → Test Events (for debugging) |
| Enable CAPI | Checkbox | Enables server-side conversion tracking |

**What gets tracked (client-side, requires consent):**

| User Action | Pixel Event | GTM Event |
|-------------|------------|-----------|
| Views product page | `ViewContent` | `view_item` |
| Clicks "Buy" | `InitiateCheckout` | `begin_checkout` |
| Enters payment info | `AddPaymentInfo` | `add_payment_info` |
| Completes purchase | `Purchase` | `purchase` |
| Signs up / free product | `Lead` | `generate_lead` |

**What gets tracked (server-side via CAPI):**
- `Purchase` and `Lead` events only
- Bypasses adblockers
- Can work without cookie consent (see [Conversions Without Consent](#6-conversions-without-consent))
- Deduplication with client-side Pixel via shared `event_id`

### 3. Google Tag Manager

**Admin Panel:** `/dashboard/integrations` → Analytics tab

| Field | Format | Example |
|-------|--------|---------|
| Container ID | `GTM-XXXXXXX` | `GTM-ABC123` |
| Server Container URL | `https://...` (optional) | `https://gtm.yourdomain.com` |

The Server Container URL is for GTM Server-Side Tagging — it proxies tracking requests through your domain, bypassing most adblockers. Requires separate infrastructure (e.g., [Stape.io](https://stape.io/) or self-hosted).

Google Consent Mode V2 is automatically configured:
- Defaults to `denied` for all consent types before Klaro loads
- Updates to `granted` when user accepts via Klaro callback

### 4. Umami Analytics

**Admin Panel:** `/dashboard/integrations` → Analytics tab

| Field | Format | Default |
|-------|--------|---------|
| Website ID | UUID | — |
| Script URL | HTTPS URL | `https://cloud.umami.is/script.js` |

Umami is a privacy-focused alternative to Google Analytics. Sign up at [umami.is](https://umami.is/).

### 5. Custom Scripts

**Admin Panel:** `/dashboard/integrations` → Script Manager tab

Add any third-party script with:
- **Location:** `head` or `body`
- **Category:** `essential` (no consent needed), `analytics`, or `marketing` (consent required)
- **Content:** Raw `<script>` content or external URL
- **Active toggle:** Enable/disable without deleting

Non-essential scripts are automatically managed by Klaro — they only execute after user consent for the matching purpose.

### 6. Conversions Without Consent

**Admin Panel:** `/dashboard/integrations` → Consents tab → "Send conversions without cookie consent"

When enabled:
- **Purchase** and **Lead** events are sent to Facebook CAPI even if the user declines cookies
- Uses hashed email + IP for matching (no `_fbc`/`_fbp` cookies)
- Legal basis: legitimate interest (GDPR Article 6(1)(f))
- All other events (ViewContent, InitiateCheckout, etc.) still require consent

**Important:** Your Privacy Policy must mention server-side conversion tracking under legitimate interest.

### 7. Consent Logging

When enabled, every interaction with the Klaro banner is logged via `POST /api/consent`:

```json
{
  "anonymous_id": "uuid",
  "consents": { "google-tag-manager": true, "facebook-pixel": false },
  "consent_version": "1"
}
```

Stored in `consent_logs` table with IP, User-Agent, and timestamp. Rate limited to 30 requests/minute per IP.

---

## How It Works

### Consent Flow

```
User visits site
  → TrackingProvider renders in root layout
  → Klaro loads + shows banner (if no sellf_consent cookie)
  → Scripts injected as type="text/plain" (blocked)

User clicks "Accept All"
  → Klaro sets cookie: sellf_consent = {"google-tag-manager":true,...}
  → Klaro converts scripts from text/plain → text/javascript (executes them)
  → Klaro callback updates Google Consent Mode: analytics_storage → "granted"
  → POST /api/consent logs the choice (if consent_logging_enabled)

User clicks "Decline" / closes banner
  → Cookie set with all services = false
  → Scripts remain as text/plain (never execute)
  → CAPI still sends Purchase/Lead (if send_conversions_without_consent = true)
```

### Script Injection

`TrackingProvider` (`src/components/TrackingProvider.tsx`) injects scripts in this order:

1. **Google Consent Mode V2 defaults** (always, before everything else)
2. **Klaro config + library** (if `cookie_consent_enabled`)
3. **GTM script** (managed by Klaro if consent enabled)
4. **Meta Pixel script** (managed by Klaro if consent enabled)
5. **Umami script** (managed by Klaro if consent enabled)
6. **Custom scripts** (managed by Klaro based on category)

All IDs are validated before injection to prevent XSS:
- GTM: `/^GTM-[A-Z0-9]{1,10}$/i`
- Pixel: `/^\d{10,20}$/`
- Umami: UUID format
- URLs: Must start with `https://`

### Google Consent Mode V2

When GTM is enabled, the following is set **before** GTM loads:

```javascript
gtag('consent', 'default', {
  'ad_storage': 'denied',
  'ad_user_data': 'denied',
  'ad_personalization': 'denied',
  'analytics_storage': 'denied',
  'wait_for_update': 500
});
```

After user interacts with Klaro, the callback updates consent:

```javascript
gtag('consent', 'update', {
  'analytics_storage': consent['google-tag-manager'] ? 'granted' : 'denied',
  'ad_storage': consent['facebook-pixel'] ? 'granted' : 'denied',
  'ad_user_data': consent['facebook-pixel'] ? 'granted' : 'denied',
  'ad_personalization': consent['facebook-pixel'] ? 'granted' : 'denied',
});
```

### Server-Side Conversions (CAPI)

Facebook Conversions API sends events server-to-server, bypassing adblockers:

```
Client: trackEvent('purchase', data)
  → POST /api/tracking/fb-capi
    → Server checks: fb_capi_enabled? capi_token exists?
    → Server checks: hasConsent OR send_conversions_without_consent?
    → If yes: POST https://graph.facebook.com/v18.0/{pixel_id}/events
```

With consent: sends full data including `_fbc`, `_fbp` cookies for better matching.
Without consent: sends hashed email + IP only (lower match rate but still valuable).

### Event Tracking

Client-side tracking (`src/lib/tracking/client.ts`) provides:

```typescript
trackEvent(eventName, data, config)
```

Before sending, it checks Klaro consent:
- `hasFacebookConsent()` → reads `sellf_consent` cookie for `facebook-pixel`
- `hasGTMConsent()` → reads `sellf_consent` cookie for `google-tag-manager`

Events are pushed to:
1. GTM `dataLayer` (if GTM enabled + consent)
2. `fbq('track', ...)` (if Pixel enabled + consent)
3. `/api/tracking/fb-capi` (if CAPI enabled, consent rules apply server-side)

Deduplication: each event gets a UUID `event_id` shared between Pixel and CAPI.

---

## Database Schema

### integrations_config (singleton, id=1)

| Column | Type | Purpose |
|--------|------|---------|
| `gtm_container_id` | TEXT | GTM Container ID |
| `gtm_server_container_url` | TEXT | GTM Server URL |
| `facebook_pixel_id` | TEXT | Meta Pixel ID |
| `facebook_capi_token` | TEXT | Meta CAPI access token |
| `facebook_test_event_code` | TEXT | Meta test event code |
| `fb_capi_enabled` | BOOLEAN | Enable server-side conversions |
| `send_conversions_without_consent` | BOOLEAN | Allow CAPI without consent |
| `umami_website_id` | TEXT | Umami Website UUID |
| `umami_script_url` | TEXT | Umami script URL |
| `cookie_consent_enabled` | BOOLEAN | Show Klaro banner |
| `consent_logging_enabled` | BOOLEAN | Log consent to DB |
| `sellf_license` | TEXT | License key (unrelated) |

### custom_scripts

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `name` | TEXT | Display name |
| `script_location` | TEXT | `head` or `body` |
| `script_content` | TEXT | Script code or URL |
| `category` | TEXT | `essential`, `analytics`, or `marketing` |
| `is_active` | BOOLEAN | Enable/disable |
| `cookie_consent_enabled` | BOOLEAN | Whether Klaro manages this script |

### consent_logs

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Authenticated user (nullable) |
| `anonymous_id` | TEXT | Anonymous visitor ID |
| `ip_address` | TEXT | Visitor IP |
| `user_agent` | TEXT | Browser User-Agent |
| `consents` | JSONB | `{"service-name": true/false}` |
| `consent_version` | TEXT | Config version |
| `created_at` | TIMESTAMPTZ | Timestamp |

---

## Common Scenarios

| Scenario | GTM | GTM Server | Pixel | CAPI | Umami | Consent |
|----------|:---:|:----------:|:-----:|:----:|:-----:|:-------:|
| Meta Pixel only | - | - | Yes | Yes | - | Yes |
| Privacy-focused (no Big Tech) | - | - | - | - | Yes | Yes |
| Full Google ecosystem | Yes | - | Yes | Yes | - | Yes |
| Adblocker resistant | Yes | Yes | Yes | Yes | - | Yes |
| All features | Yes | Yes | Yes | Yes | Yes | Yes |
| No tracking (consent banner only) | - | - | - | - | - | Yes |

---

## Verification & Debugging

### Check the banner appears

Visit your site in an incognito window — the Klaro banner should appear at the bottom.

### Check consent cookie

Browser DevTools → Application → Cookies → look for `sellf_consent`:

```json
{"google-tag-manager":true,"facebook-pixel":true,"umami-analytics":true}
```

### Check scripts are blocked/unblocked

DevTools → Elements → search for `text/plain`:
- **Before consent:** tracking scripts have `type="text/plain"`
- **After consent:** scripts have `type="text/javascript"` (or no type attribute)

### Check Meta Events Manager

Events Manager → Test Events → enter your Test Event Code → trigger events on your site. Events should appear within seconds.

### Check consent logs

```sql
SELECT anonymous_id, consents, created_at
FROM consent_logs
ORDER BY created_at DESC
LIMIT 10;
```

### Debug tracking events

Browser DevTools → Console → filter for `[tracking]` or `[fb-capi]` log messages.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/components/TrackingProvider.tsx` | Script injection + Klaro configuration |
| `src/components/IntegrationsForm.tsx` | Admin UI for all integrations settings |
| `src/lib/actions/integrations.ts` | Server actions (get/update config, CRUD scripts) |
| `src/lib/validations/integrations.ts` | Input validation for all tracking IDs/URLs |
| `src/lib/tracking/client.ts` | Client-side event tracking + consent checks |
| `src/lib/tracking/server.ts` | Server-side CAPI tracking |
| `src/app/api/consent/route.ts` | Consent logging endpoint |
| `src/app/api/tracking/fb-capi/route.ts` | Facebook CAPI proxy endpoint |
| `src/app/layout.tsx` | Root layout (fetches config, renders providers) |
| `tests/helpers/consent.ts` | Test helper for bypassing consent banner |
