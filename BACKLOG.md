# Sellf - Product Roadmap

A high-level overview of planned features, current progress, and completed work.

---

## 🔴 High Priority

### Zero-Config Setup Wizard
**Status**: 📋 Planned
Complete guided setup experience for ALL integrations via OAuth or step-by-step wizards. Goal: user should NOT need to touch .env file at all — everything configurable via Admin UI.

### Serverless Deployment (Vercel / Cloudflare / Netlify)
**Status**: 📋 Planned
One-click deployment without server management. "Deploy in 5 minutes" with Vercel, Cloudflare Pages, or Netlify. Supabase Cloud as managed database.

### Transactional Emails & Logs
**Status**: 📋 Planned
Advanced email delivery with multiple providers (EmailLabs, AWS SES), email history tracking (sent, delivered, bounced, opened), and dynamic templates.

### Follow-up Email Sequences per Product
**Status**: 📋 Planned
Automated email campaigns triggered after purchase or free download. Per-product configuration with delay settings, dynamic variables, and analytics (open/click rates).

### Invoicing Integration (Fakturownia, iFirma, KSeF)
**Status**: 📋 Planned
Automatic invoice generation and delivery for successful purchases. Integration with Fakturownia, iFirma, and Polish KSeF e-invoice system.

---

## 🟡 Medium Priority

### UTM & Affiliate Parameter Tracking
**Status**: 📋 Planned
Track UTM parameters and affiliate links throughout the entire purchase funnel. Preserve marketing attribution from landing to conversion, with admin analytics reports.

### Two-Sided Affiliate Program
**Status**: 💭 Idea
Full affiliate/referral program where both parties benefit — the referrer earns commission and the buyer gets a discount. Self-service signup, affiliate dashboard, configurable commission structure, and payout management.

### Real-time Social Proof Notifications
**Status**: 📋 Planned
"Just Bought" popup notifications, aggregate activity counters, and live viewer count to increase urgency and trust on product pages.

### Simple Funnel System (OTO + Downsell + Redirects)
**Status**: ✅ Done
- OTO offers, downsell branch, per-product redirect URLs with param passing — all shipped (`oto_offers.downsell_*` columns, PostPurchaseSection toggle, payment-status decline path).
- Chaining multiple products into OTO sequences — separate idea, see `Product Bundles`.

### Per-Product Payment Method Override
**Status**: 📋 Planned (Phase 2 of Payment Config)
Override global payment method settings for specific products. Use cases: cards-only for high-value products, local methods for regional products, bank transfers for B2B.

### One-Click Auto-Update System
**Status**: ✅ Done (2026-02)
Version management with one-click updates from admin panel. Automatic backup before update, health check verification, and rollback capability. See `system/upgrade.sh` + `/api/v1/system/*` endpoints + `SystemUpdateSettings`. Future phases (auto-scheduling, email notifications, Docker/Vercel strategies) tracked separately.

### Automated Review Collection
**Status**: 📋 Planned
Auto-request reviews after purchase, rich media support (photos/videos), display on product pages and checkout for social proof.

### AI Landing Page Generator
**Status**: 📋 Planned
Generate conversion-focused landing pages using AI. One-click generation from product name & description with persuasive copy and design automation.

### Outgoing Webhooks v2.0
**Status**: 🟡 Partial — auto-retry + DLQ + Replay shipped 2026-05-23. Remaining: delivery analytics (success rate, p99 latency), advanced filtering/transforms.
Auto-retry with exponential backoff (1m/5m/30m/2h/12h), dead-letter queue with admin Replay UI, atomic concurrent-worker safety, and pluggable queue driver (`WEBHOOK_QUEUE_DRIVER=supabase|sqs`) are now in `/dashboard/webhooks/deliveries`. See [webhooks docs](https://docs.sellf.app/webhooks/). Core refund, waitlist, purchase, subscription, and invoice events were already shipped. Per-product scoping is tracked separately below (`Per-Product Webhook Scoping`).

### Per-Product Webhook Scoping
**Status**: 📋 Planned · 🔒 **PRO-gated** (`pro+` license tier)
When adding/editing a webhook endpoint, let the user choose whether it fires for **all products** (current behaviour) or only for **selected products**. Today every active endpoint subscribed to an event fires for every product; this adds a product filter so a seller can route, e.g., `purchase.completed` for Product A to one endpoint and Product B to another. Backward-compatible: existing endpoints default to "all products" → no behaviour change. The per-product selection is a **PRO feature** — sub-PRO sellers can still create webhooks (all-products), but the "Selected products" mode is locked behind an upsell.

**Implementation research (codebase, 2026-05-29):**

- **Single dispatch chokepoint.** `WebhookService.trigger(event, data, client)` in `admin-panel/src/lib/services/webhook-service.ts:30` is the only place endpoints are selected (query at lines 35–39: `is_active = true` + `.contains('events', [event])`). Filtering is added here — accept an optional `productId` and select endpoints where `product_filter_mode = 'all' OR endpoint is linked to productId`. `testEndpoint()` (one specific endpoint) is unaffected.
- **DB.** `webhook_endpoints` (`supabase/migrations/20250103000000_features.sql:168`) has no product relationship. Add (a) column `product_filter_mode TEXT DEFAULT 'all' CHECK (product_filter_mode IN ('all','selected'))`, and (b) a junction table `webhook_endpoint_products (webhook_endpoint_id UUID, product_id UUID, PRIMARY KEY(...), ON DELETE CASCADE)`. Mirror the existing junction pattern + RLS/grants from `product_tags`/`product_categories` (`supabase/migrations/20250101000000_core_schema.sql:130,146`). New migration → regenerate `admin-panel/src/types/database.ts`.
- **Call sites that must pass `productId`.** Each event emission that is product-scoped (`purchase.completed`, `lead.captured`, `waitlist.signup`, `refund.issued`, `subscription.*`, `invoice.*`, `product.*`) — sourced from the Stripe handler (`app/api/webhooks/stripe/route.ts`, `subscription-handlers.ts`), waitlist signup route, and refund/subscription payload builders (`lib/services/*-webhook-payload.ts`). Product info is already in the payload data, so threading the id is low-risk. ~15 emission sites, but they funnel through 3 payload builders (`webhook-payload.ts`, `subscription-webhook-payload.ts`, `refund-webhook-payload.ts`) that already carry `productId`, so the actual edits are concentrated.
- **API + validation.** `POST /api/v1/webhooks` (`app/api/v1/webhooks/route.ts:118`) and `PATCH /api/v1/webhooks/[id]/route.ts` accept `product_filter_mode` + `product_ids[]` (UUIDs, replace semantics like tags PATCH); `GET` embeds them. Add validators in `lib/validations/webhook.ts` (mode enum + UUID/ownership check) and fields in the OpenAPI Zod schema `lib/api/schemas/webhooks.ts`. Update `WebhookEndpoint` type in `types/webhooks.ts`/`types/index.ts`. Optional parity in `mcp-server/` webhooks tool.
- **Admin UI.** `components/webhooks/WebhookFormModal.tsx` — add an "All products / Selected products" toggle + conditional product multi-select (a product list/hook already exists for other forms); thread fields through `hooks/useWebhooks.ts`; show a scope badge ("All" / "N products") in `components/webhooks/WebhookListTable.tsx`. In "selected products" mode show an inline note that non-product-scoped events still fire for all products (per decision #4). New i18n keys in `messages/en.json` + `messages/pl.json` (`admin.webhooks` namespace).
- **License gating (PRO).** Reuse the existing registry: add `'webhook-product-scoping': 'pro'` to `FEATURE_TIERS` in `lib/license/features.ts:17` (there's already a planned `webhook-retry` pro entry in the comment block to follow). **Enforce server-side** in `POST` + `PATCH /api/v1/webhooks` — `if (product_filter_mode === 'selected' && !(await checkFeature('webhook-product-scoping', { dataClient }))) return 403` (mirror `api-keys` `enforceApiKeyScopeGate` / `payments/export` `hasFeature(tier, 'csv-export')`). **UI lock** in `dashboard/webhooks/page.tsx` (server component): resolve `tier` and pass `scopingLocked = !hasFeature(tier, 'webhook-product-scoping')` into `WebhookFormModal` — render the "Selected products" option with a PRO badge + upsell, exactly like `dashboard/api-keys/page.tsx:11` → `ApiKeyFormModal` does for scopes. UI hiding is cosmetic; the API check is the real gate.
- **Tests.** Unit (dispatch all-vs-selected filtering, validators, license gate allows/denies), API integration (create/update with scoping + 403 below PRO), E2E (form flow + locked state).

**Size estimate:** ~20–24 files, ~750–1100 LOC.
- Backend ~280–400 LOC: migration (~60), `webhook-service.ts` filter (~60), API routes incl. PRO enforcement (~100), validation + OpenAPI schema (~50), `productId` threading across call sites (~50), `features.ts` (+1 line), `database.ts` regen.
- Frontend ~230–340 LOC: form modal incl. PRO lock/upsell (~150), webhooks page tier resolve (~10), hook (~30), list badge (~20), i18n incl. upsell copy (~50).
- Tests ~220–320 LOC.
- Effort: **Medium (~1.5–2 dev-days).**

**Decisions (2026-05-29):**
1. **License downgrade/expiry → grandfather.** Dispatch keeps honouring the stored `product_filter_mode` on existing endpoints; only *creating/editing* a "selected" scope is PRO-gated at write time. PRO is lifetime for now so downgrade is rare — but **keep the data model license-agnostic**: persist `product_filter_mode` + the junction regardless of tier, and never bake license state into the data. Changing the downgrade policy later (revert-to-all / stop-firing) must be a dispatch-query change only, **no migration**.
2. **Multi-product events → fire if ANY matched product.** For an event touching several products (e.g. `purchase.completed` with an order bump from another product), the scoped endpoint fires when *any* product in the event (main or bump) is on its selection list.
3. **Filtering in SQL.** Single query in `WebhookService.trigger`: `is_active AND contains(events,[event]) AND (product_filter_mode='all' OR endpoint linked to productId)` via `.or()`/join — not in-app after fetch (efficient + scales as endpoint/product counts grow; in-app would load every endpoint into memory per dispatch).
4. **Events with no product context → always fire** regardless of selection (don't drop). Applies to any future account-level event; all current events are product-scoped. **UI requirement:** when an endpoint is in "selected products" mode, surface an inline note that any non-product-scoped events on it will fire for all products regardless of the selection.

### API Extensions & SDKs
**Status**: 📋 Planned
Typed SDKs, hosted OpenAPI docs endpoint, example apps, and deeper webhook/API recipes. REST API v1 with scoped API keys, rate limiting, and OpenAPI generator is already shipped.

### GTM Phase 2 (Automated OAuth)
**Status**: 📋 Planned
Google OAuth App integration for one-click GTM setup — Sellf auto-creates Container and Tags via GTM API.

---

## 🟢 Lower Priority

### Subscription Upgrades / Downgrades & MRR Dashboard
**Status**: 📋 Planned
Plan switching with prorated billing, pause subscription, MRR / churn / LTV dashboard, and cohort retention curves. Builds on top of the shipped Subscriptions MVP.

### Privacy-First Cart Recovery
**Status**: 📋 Planned
GDPR-compliant abandoned checkout recovery with real-time email capture and automated follow-up.

### Polish Payment Gateways (PayU, Przelewy24, Tpay)
**Status**: 📋 Planned
Native support for key Polish payment providers to maximize conversion in the PL market.

### Payment Balancer & Smart Routing
**Status**: 📋 Planned
Automatic failover between payment providers, one-click admin toggle, and currency-based routing.

### Bunny.net Video Upload Integration
**Status**: 📋 Planned
Upload videos directly from admin panel to Bunny.net with progress bar, automatic embed code generation, and video library management.

### Advanced Video Player Styling
**Status**: 📋 Planned
Custom player UI (colors, logo overlay), overlays & CTAs at timestamps, playback memory, chapters, download protection, and watch analytics.

### Self-Service Account Deletion (GDPR)
**Status**: 📋 Planned
Allow users to permanently delete their account with Stripe subscription cancellation, data cleanup, and double confirmation.

### Product Bundles
**Status**: 💭 Idea
Group multiple products into a single bundle at a discounted price.

### Related Products / Cross-selling
**Status**: 💭 Idea
"Customers also bought" sections on product pages.

### Video Course Structure
**Status**: 💭 Idea
Courses with chapters, lessons, progress tracking, sequential unlocking, certificates, and quizzes.

### In-App File Hosting
**Status**: 💭 Idea
Upload and host files directly within Sellf with support for Supabase Storage, AWS S3, Cloudinary, and Bunny.net CDN.

### Mux Video Integration
**Status**: 💭 Idea
Alternative high-end video hosting provider integration alongside Bunny.net.

### Content Delivery Type Refactoring
**Status**: 💭 Idea
Extend `content_delivery_type` system with new types: `bunny_video`, `download`, `video_course`, `membership`, `api_access`.

### Configurable URL Validation
**Status**: 📋 Planned
Admin panel setting to enable/disable strict URL validation for content links (`video_embed`, `download_link` fields).

---

## ✅ Completed Features

### 🎨 Theme & Appearance (2026-02-18)

#### Dark/Light Theme Toggle
- ✅ Class-based dark mode (Tailwind v4 `@custom-variant dark`)
- ✅ ThemeProvider with localStorage persistence, system/light/dark modes
- ✅ FloatingToolbar toggle (sun/moon icon)
- ✅ FOUC prevention with inline script

#### Force Checkout Theme (Admin Setting)
- ✅ Admin UI: System/Light/Dark buttons with auto-save
- ✅ DB column: `shop_config.checkout_theme`
- ✅ Responsive checkout backgrounds and Stripe Elements theme

#### Sellf Branding Watermark
- ✅ Checkout footer with link, license-gated (ECDSA P-256)

### 🚀 Performance & Scalability (2026-01-15)
- ✅ ISR (Incremental Static Regeneration) for all public pages
- ✅ PM2 cluster mode for multi-core utilization
- ✅ Optional Redis caching layer (Upstash) with graceful fallback
- ✅ 30x throughput improvement, 19x lower latency

### 🛒 Checkout & Payments

#### Pixel-Perfect Checkout UI (2026-02-18)
- ✅ Full Stripe Elements integration with custom payment form
- ✅ Invoice data with GUS REGON auto-fill
- ✅ Guest-to-user sync, EasyCart-style layout, order bumps
- ✅ Dark/light theme support, responsive design

#### Enhanced Checkout UX (2025-12-27 — 2025-12-30)
- ✅ Custom Stripe Elements, profile auto-load, guest checkout
- ✅ Terms at checkout, NIP/invoice toggle, EasyCart-style layout

#### Stripe Configuration Wizard (2025-12-27)
- ✅ 5-step RAK wizard with permission validation
- ✅ AES-256-GCM encrypted storage, test/live mode switching

#### Global Payment Method Configuration (2026-01-15)
- ✅ Three modes: automatic, Stripe preset, custom selection
- ✅ Drag & drop ordering, Express Checkout toggles (Apple/Google Pay)

#### Advanced Refund Management (Jan 2025)
- ✅ Per-product config, customer request form, admin dashboard
- ✅ Stripe auto-refund on approval, period validation
- ✅ Partial refund accounting, external Stripe refund sync, and signed `refund.issued` outgoing webhooks

#### EU Omnibus Directive Compliance (2025-12-28)
- ✅ Price history tracking, 30-day lowest price display
- ✅ Per-product exemption, admin toggle

#### Compare-At-Price / Original Price Display (2026-01-05)
- ✅ `compare_at_price` field, crossed-out original price with discount badge
- ✅ Omnibus integration (30-day lowest alongside promotional pricing)

#### Payment Transactions History UI (Dec 2024)
- ✅ Payments dashboard with stats cards, sessions & transactions tables
- ✅ Date range & status filters, multi-currency support

#### Direct Checkout Links (Deep Linking)
- ✅ External funnel support via `/checkout/[slug]`
- ✅ URL parameters for coupons (`?coupon=...`) and tracking

#### Stripe Subscriptions MVP (2026-05)
- ✅ Recurring billing on day/week/month/year + interval count
- ✅ Optional free trials per product (`trial_days`, card upfront)
- ✅ Anonymous sub checkout (no forced login, account materializes via webhook)
- ✅ Customer portal in Sellf: cancel/resume, invoice list, update card via SetupIntent
- ✅ Cancel always at period end; refund of first invoice auto-cancels
- ✅ Stripe-native coupon `duration` (once / repeating N cycles / forever)
- ✅ Outgoing webhooks for full lifecycle (`subscription.created/updated/canceled/trial_ending/renewal_upcoming`, `invoice.paid/payment_failed`)
- ✅ `stripe_customers` + `subscriptions` tables with RLS, durable Stripe Price binding

### 📊 Analytics & Integrations

#### Multi-Currency Conversion (2025-12-30)
- ✅ 7 currencies, multiple exchange rate providers (ECB, ExchangeRate-API, Fixer.io)
- ✅ Admin config UI, encrypted API key storage, dashboard integration

#### Server-Side Tracking (2026-01-03)
- ✅ GTM DataLayer events, Facebook Pixel + CAPI with deduplication
- ✅ Google Consent Mode V2, unified useTracking hook

#### MCP Server (2026-02)
- ✅ 7 tool modules (products, analytics, coupons, payments, users, webhooks, system)
- ✅ API key auth, Claude Desktop integration, Vitest tests

#### REST API v1 & API Keys (2026-02 — 2026-05)
- ✅ Scoped API keys with rotation, hashing, per-key rate limits, and audit trail
- ✅ Products, users, payments, refunds, coupons, webhooks, analytics, variants, order bumps, and system endpoints
- ✅ OpenAPI 3.1 generator backed by Zod schemas

#### Real-time Sales Dashboard (2025-12-24)
- ✅ Live updates via Supabase Realtime + polling fallback
- ✅ Revenue goal with progress bar, hourly & daily charts (Recharts)
- ✅ Product filtering, "New Order" confetti popup

#### Outgoing Webhooks v1.5 (2025-12-19)
- ✅ HMAC-SHA256 signed delivery, `purchase.completed` and `lead.captured` events
- ✅ Management UI, test events, retry, detailed logs
- ✅ `waitlist.signup`, `refund.issued`, subscription lifecycle, upcoming renewal, and invoice payment events

#### Cookie Consent — vanilla-cookieconsent v3 (2026-05-18, migrated from Klaro)
- ✅ GDPR-compliant consent manager with TrackingProvider integration
- ✅ Explicit `opt-in` mode, banner copy lists configured providers + storage horizons (PL/EN)
- ✅ Umami treated as cookieless and exempt from gating
- ✅ Re-consent link in landing footer, dynamic provider/duration listing

#### Script Manager (2025-12-24)
- ✅ Structured management of custom scripts (Essential, Marketing, Analytics)
- ✅ Dynamic injection based on consent category, secure DB storage

### 🛒 Sales Mechanics

#### Smart Coupons (2025-12-19)
- ✅ Percentage & fixed discounts, global & per-user limits
- ✅ Product & email restrictions, auto-apply links

#### Order Bumps (2025-11-28)
- ✅ Checkout integration, automatic access grant, guest support

#### Custom Checkout Fields (2026-05-15)
- ✅ Per-product `custom_checkout_fields` JSONB on products with shape validation in `lib/validations/custom-checkout-fields.ts`
- ✅ Buyer-typed values stored in `payment_transactions.custom_field_values` with cross-validation against the buying product
- ✅ Reusable in any checkout template (DB schema is opinion-free about future field types)

#### Product Variants (Jan 2025)
- ✅ M:N architecture (variants as linked products)
- ✅ Admin UI, variant selector page, featured variant

#### Waitlist & Pre-Launch Validation
- ✅ Per-product `enable_waitlist` toggle, inactive + waitlist = signup form, inactive + no waitlist = 404 (no leak)
- ✅ Email capture with terms acceptance, Cloudflare Turnstile CAPTCHA, disposable email blocking
- ✅ HMAC-signed `waitlist.signup` webhook event
- ✅ Admin guardrails: missing-webhook banner per product, last-webhook deletion warning with affected product count
- ✅ Signed-in user pre-fill + "Use a different email" override (v2026.4.1) — captcha only required on override path

### 🎨 UI & Branding

#### Custom Branding & Whitelabel (2025-12-27)
- ✅ Logo upload, color customization, font selection (6 families)

#### Smart Landing Page (2025-12-27)
- ✅ 4 adaptive scenarios (admin onboarding, coming soon, storefront)
- ✅ Modern storefront with hero, bento grid, temporal badges

#### About Page (2025-12-27)
- ✅ Feature showcase, deployment options, FAQ, bilingual (EN/PL)

#### Interactive Onboarding Checklist (2025-12-27)
- ✅ Smart detection (shown when admin has 0 products), 4-task setup checklist
- ✅ Primary CTA, quick links, animated design

### 🔐 Security & Infrastructure

#### GUS REGON API Integration (2025-12-28)
- ✅ NIP validation, SOAP client, checkout auto-fill, encrypted API key

#### Audit Logging (Dec 2024)
- ✅ Automatic triggers, admin_actions table, severity levels, cleanup jobs

#### Terms Acceptance (Jan 2025)
- ✅ Reusable TermsCheckbox, consent logging, GDPR compliant

### 🏗️ Architecture (2025-12-22)

#### Server-Side Auth & Native Layouts
- ✅ `verifyAdminAccess` utility, Server Component layout, zero flickering

### 🎥 Media

#### Video Embed Integration (2025-11-27)
- ✅ YouTube, Bunny.net, Vimeo, Loom, Wistia, DailyMotion, Twitch

#### Playerstack Embed Pipeline (2026-05)
- ✅ Self-hosted Playerstack bundle pinned to a reproducible upstream commit
- ✅ Protected video embeds through supported HLS/MP4/WebM URLs
- ✅ CI freshness gate for the vendored player bundle

#### Per-Product Video Playback Options (2026-05-19)
- ✅ `preview_video_config` JSONB on products (autoplay / loop / muted / controls)
- ✅ Per content-item `saved_position` flag (Playerstack saved-position plugin)
- ✅ Admin UI: shared `VideoOptionsPanel` reused in preview + content sections
- ✅ Autopreview defaults seeded on first valid URL entry

### 📊 Other

#### Public Demo Instance (2026-02)
- ✅ Live at https://demo.sellf.app
- ✅ Stripe Test Mode, hourly DB reset, demo guard, demo banner

#### Product Categories (Dec 2024, partial)
- ✅ Database schema, admin CRUD, product form integration
- 📋 Missing: storefront filtering, category pages, navigation

#### Product Tags (Dec 2024, partial)
- ✅ Database schema
- 📋 Missing: admin UI, product form, filtering

#### E2E Testing Infrastructure (2025-12-30)
- ✅ 176+ tests, stable selectors, serial admin tests, cleanup hooks

---

## 📝 Notation

**Status Tags**: 🟢 High | 🟡 Medium | 🔵 Low

**Progress**: 💭 Idea | 📋 Planned | 🏗️ In Progress | ✅ Done

---

**Last Updated**: 2026-05-19
