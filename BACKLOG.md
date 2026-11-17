# Sellf - Product Roadmap

A high-level overview of planned features, current progress, and completed work.

---

## Next

Planned sequence, without delivery-date commitments:

- **2026.11.2:** database backup and one-click restore, emergency license signing-key replacement, a consistent Bun version and lockfile v3, production fixes and dependency maintenance. Admin shop preview during maintenance is optional.
- **2026.11.3:** multiple co-creators, invitations and separate statuses; more store templates, industry templates and content editing per language.
- **2026.11.4:** multi-product cart and checkout UX, related products, invoice details in embedded checkout and event cart reservations.
- **2026.11.5:** buyer-facing currency choice and EU B2B reverse charge, subject to research and a scope decision.
- **Without a release number:** payment-function decomposition and passkey sign-in.

## Available in 2026.11.1

Product archiving, the six-section product editor, unified company details, co-creator shares, versioned Stripe carts, maintenance mode, durable mail/event retries, updater 2 and explicit RC releases. Manual webhook retries require an administrator session; endpoint URL changes close older scheduled deliveries. See [the documentation overview](https://docs.sellf.app/#changes-in-2026111).

---

## 🔴 High Priority

### Zero-Config Setup Wizard
**Status**: 📋 Planned
Complete guided setup experience for ALL integrations via OAuth or step-by-step wizards. Goal: user should NOT need to touch .env file at all — everything configurable via Admin UI.

### Serverless Deployment (Vercel / Cloudflare / Netlify)
**Status**: 📋 Planned
One-click deployment without server management. "Deploy in 5 minutes" with Vercel, Cloudflare Pages, or Netlify. Supabase Cloud as managed database.

### Transactional Emails & Logs
**Status**: Partial
Signed business webhooks and optional Supabase buyer emails are available, with durable retry queues and mail limits. Delivery automation can use Mailstack or another receiver. Native provider integrations (EmailLabs, AWS SES), full sent/delivered/bounced/opened history and dynamic-template management remain planned. See [buyer emails](https://docs.sellf.app/buyer-emails/).

### Follow-up Email Sequences per Product
**Status**: Idea
Purchase and free-access webhooks already support follow-up automation in the seller's mail system. A native per-product campaign engine, delay editor and open/click analytics are not implemented or assigned to the next releases.

### Custom Checkouts (checkout profiles + built-in modules)
**Status**: Done
Order snapshots, checkout profiles, buyer/recipient details with tax ID lookup, phone, quantity and participants are available. Event products include dates, price tiers, seat reservations and public availability. Traditional bank transfer supports due dates, cancellation and admin acceptance of late transfers. See [custom checkout](https://docs.sellf.app/custom-checkout/) and [bank transfers](https://docs.sellf.app/bank-transfers/).

### Invoicing Integration (Fakturownia, iFirma, KSeF)
**Status**: Partial — Fakturownia done
Automatic/manual Fakturownia invoices, separate recipients, unpaid transfer invoices, retries and correction tracking are available. KSeF submission is configured in Fakturownia. Native iFirma and direct KSeF integrations remain planned; they are not part of the shipped Fakturownia integration.

---

## 🟡 Medium Priority

### UTM & Affiliate Parameter Tracking
**Status**: Done
Purchase attribution records first and last touch, source, medium, campaign and content, with admin reports and API access. See [purchase sources](https://docs.sellf.app/purchase-attribution/).

### Two-Sided Affiliate Program
**Status**: Done for the base program; extensions planned
Partner sign-up, approval, coupon-based commissions, buyer discounts, earnings and payout management are available. One co-creator can receive a percentage or fixed amount per one-time product purchase without a coupon; creator terms and payout eligibility apply. Multiple co-creators, invitations and separate statuses are planned for 2026.11.3.

### Real-time Social Proof Notifications
**Status**: 📋 Planned
"Just Bought" popup notifications, aggregate activity counters, and live viewer count to increase urgency and trust on product pages.

### Simple Funnel System (OTO + Downsell + Redirects)
**Status**: ✅ Done
- OTO offers, downsell branch, per-product redirect URLs with param passing — all shipped (`oto_offers.downsell_*` columns, PostPurchaseSection toggle, payment-status decline path).
- Chaining multiple products into OTO sequences — separate idea, see `Product Bundles`.

### Per-Product Payment Method Override
**Status**: 📋 Planned (Phase 2 of Payment Config)
Override global payment method settings for specific products. Use cases: cards-only for high-value products, local methods for regional products, bank transfers for B2B. Offline bank transfer is available for eligible checkout profiles; this does not implement per-product Stripe payment-method overrides.

### One-Click Auto-Update System
**Status**: Done
The admin panel offers in-place updates for supported standalone PM2 installations, with signed releases, health checks and code rollback. The saved backup covers application code/configuration, **not the database**. Database backup and one-click restore are planned for 2026.11.2. Other runtimes show deployment-specific instructions. See [update guide](https://docs.sellf.app/ui-upgrades/).

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
**Status**: Done — selected-product configuration requires Pro or higher
Endpoints can receive all products or selected products. A multi-product event matches if any included product is selected. Events without a product context remain eligible. Existing stored filters continue to apply; creating or editing a selected-product filter requires Pro. See [webhooks](https://docs.sellf.app/webhooks/).

### API Extensions & SDKs
**Status**: Partial
REST API v1, a hosted OpenAPI 3.1 description at `/api/v1/openapi.json`, registry-generated `/llms.txt`, and built-in MCP at `/api/mcp` are available. MCP runs inside the application; no separate server package is needed. Typed client SDKs and additional example applications remain planned.

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
**Status**: Partial
Playerstack integration and saved playback position are available. Further player branding, timestamp overlays/CTAs, chapters and watch analytics remain planned.

### Self-Service Account Deletion (GDPR)
**Status**: 📋 Planned
Allow users to permanently delete their account with Stripe subscription cancellation, data cleanup, and double confirmation.

### Product Bundles
**Status**: Done — available since 2026.11.0
A bundle is a product (`is_bundle`) that grants access to several component products via the
`bundle_items` join table — no product/file duplication. Fixed price with adaptive savings/included
display, optional bonus content, its own order bumps + OTO, mode-1a single-line VAT, per-component
access + licenses; components are one-time/free/PWYW (no subscriptions, no nesting). Shared
`grant_product_and_bundle_components` primitive backs completion RPC + guest-claim (and is cart-ready).
**⚠️ BREAKING (webhook):** the `purchase.completed` payload's singular `license` field is REMOVED and
replaced by `licenses[]` (one entry per licensable product, incl. bundle components); adds
`bundleComponents[]`; widens product-scoping to include component ids. Use the current [webhook contract](https://docs.sellf.app/webhooks/) when migrating integrations.

### Multi-Product Cart
**Status**: 💭 Idea
True shopping cart — add more than one different product and pay for all in a single checkout (one charge, access to every line item). Distinct from Product Bundles (fixed bundle) and multi-quantity (same product). Reuses the bundle access-explosion primitive; needs design for how order bumps / OTO / variants / coupons apply per-line vs per-cart.

### Buyer-Facing Multi-Currency (Presentment + Currency Choice)
**Status**: 💭 Idea
Buyer always sees the price in their own (geo/locale) currency, with the option to pay either in their currency or in the product's original currency. Requires a fresh Stripe capability check and a design that keeps the displayed total, confirmed session amount and payment currency consistent, including pay-what-you-want fallback. A single Elements flag is insufficient. Note: the shipped "Multi-Currency Conversion (2025-12-30)" is display/analytics only, not buyer-facing payment currency.

### Cart / Checkout UX Redesign
**Status**: 💭 Idea
Redesign the cart & checkout view for best-in-class UX, with focus on order bumps, variants, promotions (compare-at / Omnibus) and discount codes working together coherently — especially once the multi-product cart lands. Mobile-first, EasyCart-style.

### Related Products / Cross-selling
**Status**: 💭 Idea
"Customers also bought" / related-products sections on product pages and in-cart, adding to cart in one click. Must be designed carefully so it raises cart value WITHOUT distracting from checkout completion (distinct from post-purchase OTO/downsell). Manual seller-curated relations first; data-driven "also bought" as phase 2.

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

#### Built-in MCP (2026.11.1)
- API-key authenticated Streamable HTTP endpoint at `/api/mcp`
- Tools generated from OpenAPI, scope-filtered full or compact mode

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

#### Product Tags
- Database schema, admin CRUD and product-form integration are available.
- API supports tag filtering; public storefront tag navigation remains a separate enhancement.

#### E2E Testing Infrastructure (2025-12-30)
- ✅ 176+ tests, stable selectors, serial admin tests, cleanup hooks

---

## 📝 Notation

**Status Tags**: 🟢 High | 🟡 Medium | 🔵 Low

**Progress**: 💭 Idea | 📋 Planned | 🏗️ In Progress | ✅ Done

---

**Last Updated**: 2026-11-17
