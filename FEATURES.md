# Sellf - Feature List

> **Generated**: 2026-01-06
> **Version**: 1.0
> **Status**: Production-ready

---

## Table of Contents

1. [Implemented Features](#implemented-features)
2. [Planned Features (TURBO Roadmap)](#planned-features-turbo-roadmap)
3. [Project Statistics](#project-statistics)

---

# Implemented Features

## 1. Product Management

### Product Basics
- **Product CRUD** - Full create, edit, delete, duplicate
- **URL slugs** - Unique, SEO-friendly product addresses
- **Product status** - Active/Inactive with visibility control
- **Featured products** - Highlighting products on the homepage
- **Product descriptions** - Short + long description (markdown support)
- **Icons and images** - Icon URL, Image URL, Thumbnail URL

### Pricing and Promotions
- **Prices in multiple currencies** - 26 currencies (USD, EUR, PLN, GBP, JPY, CAD, AUD, etc.)
- **VAT handling** - VAT rate + "price includes VAT" option
- **Sale price** - Promotional price with:
  - Time limit (`sale_price_until`)
  - Quantity limit (`sale_quantity_limit`)
  - Automatic sold counter (`sale_quantity_sold`)
- **EU Omnibus Directive** - 30-day price history, lowest price display

### Pay What You Want (PWYW)
- **PWYW toggle** - Enabling "pay what you want" mode
- **Minimum price** - 0.50 limit (Stripe requirement)
- **Preset buttons** - Configurable buttons with suggested amounts
- **Checkout UI** - Slider/input for custom amount

### Time-Based Availability
- **Available from/until** - Product availability time window
- **Early bird pricing** - Special prices before the start date
- **Coming Soon badges** - Automatic labels for future products

### Product Access
- **Lifetime access** - Access without time restrictions
- **Timed access** - Access for X days (`auto_grant_duration_days`)
- **Access expiry tracking** - Monitoring expiring access
- **Repurchase renewal** - Ability to extend access

---

## 2. Product Variants (M:N)

### Variant Groups
- **Variant groups** - Grouping products into variants (e.g., Basic/Pro/Enterprise)
- **M:N relationship** - One product can be in multiple groups
- **Display order** - Variant display ordering
- **Featured variant** - Default selected variant

### Variant UI
- **Variant selector page** - Variant selection page before checkout
- **Radio buttons/Dropdown** - Different selection styles
- **Link copying** - Copying links to specific variants

---

## 3. Categories and Tags

### Categories (🏗️ Partial)
- **Category CRUD** - Full management in `/dashboard/categories`
- **Hierarchy** - Parent/child categories (tree)
- **URL slugs** - SEO-friendly category addresses
- **M:N assignment** - A product can be in multiple categories
- **Product Form** - Assigning categories in product editing

**Missing usage:**
- Storefront filtering
- Category pages `/category/[slug]`
- Category navigation
- Breadcrumbs

### Tags (🏗️ Partial - DB only)
- **DB tables** - `tags`, `product_tags` (M:N)
- **No GUI** - No UI for tag management
- **No usage** - Tags are not used anywhere

---

## 4. Payment System

### Stripe Integration
- **Stripe Elements** - Custom payment form (PCI DSS compliant)
- **Embedded Checkout** - Stripe checkout session
- **Payment Intent** - PaymentIntent API with idempotency
- **Stripe Configuration Wizard** - 5-step wizard for configuration:
  1. Welcome
  2. Mode Selection (Test/Live)
  3. Create Key (RAK - Restricted API Keys)
  4. Enter Key
  5. Success
- **Multi-mode support** - Test and Live mode separately

### Checkout Flow
- **Guest checkout** - Purchases without an account
- **Magic link login** - Login via email (no password)
- **Email validation** - Format verification + disposable email blocking
- **Turnstile CAPTCHA** - Cloudflare protection
- **Terms acceptance** - Mandatory terms of service acceptance

### Transactions
- **Payment transactions table** - Full transaction history
- **Idempotency** - UNIQUE constraints on session_id and stripe_payment_intent_id
- **Race condition protection** - Optimistic locking with retries
- **Guest purchases** - Claiming purchases after account registration

---

## 5. Coupons and Discounts

### Coupon Types
- **Percentage discount** - Percentage discount (e.g., 20%)
- **Fixed amount** - Fixed amount discount (e.g., 10 PLN)
- **Multi-currency support** - Fixed amount per currency

### Coupon Restrictions
- **Usage limits** - Global and per-user
- **Email whitelist** - Coupons only for specific emails
- **Product whitelist** - Coupons only for specific products
- **Exclude order bumps** - Option to exclude bumps from discount
- **Validity period** - Starts at / Expires at
- **Is public flag** - Omnibus compliance (whether the coupon is public)

### Auto-Apply
- **Auto-apply coupon** - Automatic coupon lookup for email
- **URL parameter** - `?coupon=CODE` in URL

---

## 6. Order Bumps (Upsell)

### Configuration
- **Main + Bump product** - Linking products
- **Custom bump price** - Special bump price (or default)
- **Bump title/description** - Dedicated marketing texts
- **Display order** - Bump ordering
- **Access duration** - Separate access duration for bump

### Checkout Integration
- **Bump checkbox** - Display in checkout
- **Two-product transaction** - One transaction, two products
- **Guest bump support** - Bump for non-logged-in users

---

## 7. OTO System (One-Time Offers)

### OTO Generation
- **Post-purchase generation** - Automatic coupon after purchase
- **Email binding** - Coupon only for the buyer
- **Single-use** - usage_limit = 1
- **Time-limited** - Duration in minutes (default 15, max 1440)
- **Code format** - OTO-XXXXXXXX

### OTO Flow
- **Idempotency** - One coupon per transaction
- **Ownership check** - Checking if user already has the OTO product
- **Race condition protection** - UNIQUE constraint + exception handling
- **Countdown timer** - UI with countdown
- **Auto-apply** - Automatic application in checkout

### Admin Management
- **OTO configuration** - Source product → OTO product mapping
- **Discount settings** - Percentage/Fixed + value
- **Duration settings** - Offer validity duration
- **Active/Inactive toggle** - Enabling/disabling OTO

---

## 8. Refund System

### Product Configuration
- **is_refundable** - Whether the product is eligible for refund
- **refund_period_days** - Number of days for refund (e.g., 14, 30)

### Request Flow (Customer)
- **Request form** - Form with refund reason
- **My Purchases integration** - Button in purchase history
- **Period validation** - Blocking after the deadline expires
- **Non-refundable handling** - Message for non-refundable products

### Admin Management
- **Pending requests** - List of requests to review
- **Approve/Reject** - Admin decision
- **Admin notes** - Notes/responses
- **Status tracking** - pending → approved/rejected → refunded
- **Stripe refund processing** - Automatic refund in Stripe

---

## 9. Waitlist

### Configuration
- **enable_waitlist** - Toggle per product
- **Inactive + waitlist = form** - Form for inactive products
- **Inactive + no waitlist = 404** - Standard error

### Signup Flow
- **Email capture** - Collecting emails
- **Terms acceptance** - Mandatory consent
- **Turnstile CAPTCHA** - Bot protection
- **Webhook trigger** - `waitlist.signup` event

### Admin Features
- **Webhook configuration warnings** - Alert when webhook is missing
- **Products count** - How many products have waitlist enabled
- **Dashboard warning** - Notification about missing configuration

---

## 10. Gatekeeper (Content Protection)

### Protection Types
- **Page-level protection** - Entire page requires access
- **Element-level protection** - Specific elements (`.sellf-protected` class)
- **Multi-product** - Different products on one page
- **Free content** - Public content without login

### Fallback Content
- **Custom fallback** - Custom content for users without access
- **Upgrade buttons** - Purchase buttons
- **Graceful degradation** - Functioning during API errors

### JavaScript SDK
- **sellf.js** - Dynamic script for protection
- **License validation** - Sellf license verification
- **Auto-detection** - Automatic detection of protected elements

---

## 11. Webhooks

### Configuration
- **URL endpoint** - Target address
- **Events selection** - Event selection:
  - `purchase.completed`
  - `lead.captured`
  - `waitlist.signup`
- **Secret key** - HMAC-SHA256 signature
- **Active/Inactive** - Toggle

### Delivery & Logging
- **Secure delivery** - HMAC signature in header
- **Webhook logs** - Call history
- **Status tracking** - success/failed/retried/archived
- **HTTP status** - Response code
- **Response body** - Response content
- **Duration tracking** - Call duration (ms)

### Management
- **Test modal** - Testing webhooks
- **Retry button** - Resending
- **Logs filtering** - Filtering by status
- **Archive functionality** - Log archiving

---

## 12. Analytics & Dashboard

### Dashboard Stats
- **Total revenue** - Total revenue (multi-currency)
- **Today's revenue** - Today's revenue
- **Total orders** - Number of orders
- **Active products** - Active products
- **Active users** - Users with access

### Revenue Charts
- **Sales chart** - Sales chart (daily aggregation)
- **Hourly breakdown** - Hourly distribution
- **Product filter** - Filtering by product
- **Date range** - Date range selection
- **Currency selector** - Display currency selection

### Revenue Goals
- **Goal setting** - Revenue goal (global or per-product)
- **Progress tracking** - Progress bar
- **Start date** - Goal start date

### Real-time Updates
- **Supabase Realtime** - Live updates
- **Recent activity** - Recent transactions
- **Failed webhooks count** - Error alert

---

## 13. Multi-Currency Support

### Currency Conversion
- **26 currencies** - USD, EUR, PLN, GBP, JPY, CAD, AUD, CHF, etc.
- **Currency providers** - ECB, ExchangeRate-API, Fixer.io
- **Encrypted API keys** - AES-256-GCM encryption
- **Auto-refresh** - Automatic rate refresh

### Display Modes
- **Converted view** - Everything in one currency
- **Grouped view** - Separate per currency
- **Hide values toggle** - Hiding amounts

---

## 14. Marketing Integrations

### Google Tag Manager
- **Container ID** - GTM-XXXXXXX
- **DataLayer events** - view_item, begin_checkout, purchase, etc.
- **Server-side container** - URL for GTM Server

### Facebook Pixel
- **Pixel ID** - Pixel identifier
- **Client-side tracking** - PageView, ViewContent, InitiateCheckout, Purchase
- **CAPI (Server-Side)** - Facebook Conversions API:
  - `/api/tracking/fb-capi` endpoint
  - Event deduplication via `event_id`
  - Hashed user data (email, IP)
  - Test event code support

### Google Consent Mode V2
- **Klaro integration** - Consent management
- **Cookie consent** - Blocking before consent
- **Consent logging** - `consent_logs` table

### Umami Analytics
- **Website ID** - Website identifier
- **Self-hosted URL** - Self-hosted Umami instance

### Custom Scripts
- **Script injection** - Custom scripts
- **Head/Body placement** - Script location
- **Category tagging** - essential/analytics/marketing
- **GDPR compliance** - Blocking before consent

---

## 15. GUS REGON Integration

### Functionality
- **NIP validation** - 10-digit NIP verification
- **SOAP client** - GUS API integration
- **Auto-fill** - Automatic company data population:
  - Company name
  - Address (street, number, postal code, city)
  - REGON

### Security
- **Encrypted API key** - AES-256-GCM
- **Rate limiting** - 5 req/min
- **CORS protection** - Origin/referer validation

---

## 16. Branding & Whitelabel

### Customization
- **Logo URL** - Custom logo (Supabase Storage upload)
- **Colors** - Primary, Secondary, Accent
- **Font family** - Inter, Roboto, Montserrat, Poppins, Playfair Display, System
- **Shop name** - Store name

### Preview
- **Real-time preview** - Live preview of changes
- **Reset to defaults** - Restoring defaults

---

## 17. Legal & Compliance

### Legal Documents
- **Terms of Service URL** - Link to terms of service
- **Privacy Policy URL** - Link to privacy policy
- **GDPR settings** - GDPR settings

### EU Omnibus Directive
- **30-day price history** - Automatic price tracking
- **Lowest price display** - Displaying the lowest price
- **Per-product exempt** - Exemption for specific products
- **Global toggle** - Enabling/disabling globally

### Consent Management
- **Consent logging** - `consent_logs` table
- **Anonymous ID** - Session identifier
- **IP tracking** - Consent IP address
- **Consent version** - Terms of service version

---

## 18. User Management

### Profile
- **Full name** - First and last name
- **Company info** - Company name, NIP
- **Address** - Full address (street, city, postal code, country)
- **Preferences** - Language, timezone

### Access Control
- **User product access** - Access table
- **Grant/Revoke** - Granting/revoking
- **Temporal access** - Time-limited access with expiry date
- **Admin override** - Admin can do everything

### Admin Panel
- **Users list** - List with pagination
- **Search & filter** - Search by email
- **User details modal** - User details
- **Access management modal** - Access management

---

## 19. Security

### Rate Limiting
- **Server-side only** - No client headers (secure)
- **Multi-layer** - Connection + JWT + time buckets
- **Per-function limits** - Different limits per endpoint
- **Application rate limits** - For Next.js routes

### Encryption
- **AES-256-GCM** - API keys (Stripe, GUS, Currency)
- **IV + Tag** - Full encryption

### Authentication
- **Supabase Auth** - Email/password + OAuth
- **Magic links** - Passwordless login
- **First user = admin** - Automatic role

### RLS Policies
- **Row Level Security** - Data isolation
- **Admin policies** - Full access for admins
- **User policies** - Own data only
- **Public policies** - Public products

### Audit Logging
- **audit_log table** - All changes
- **admin_actions table** - Admin actions
- **Automatic triggers** - No manual logging
- **CRITICAL/WARNING alerts** - Monitoring

---

## 20. REST API v1

### Endpoints
- **Products** - CRUD, OTO configuration, filters, pagination
- **Users** - List, details, search by email
- **User Access** - Grant, revoke, extend access
- **Payments** - List, details, refunds, export CSV, stats
- **Coupons** - CRUD, stats, deactivation
- **Webhooks** - CRUD, logs, test, retry
- **Analytics** - Dashboard, revenue, top products
- **Refund Requests** - List, approve/reject
- **Variant Groups** - CRUD for variant groups
- **Order Bumps** - CRUD for order bumps
- **System** - Health check, status

### OpenAPI Documentation
- **OpenAPI 3.1 spec** - Generated from Zod schemas
- **Zod schemas** - Type-safe validation and spec generation

### Authentication
- **API Keys** - Format `sf_live_xxx` / `sf_test_xxx`
- **Bearer token** - `Authorization: Bearer sf_live_xxx`
- **X-API-Key header** - Alternative method
- **Scopes** - Granular permissions (`products:read`, `users:write`, `*`)
- **Rate limiting** - Per-key limits (default 60/min)

### API Keys Management
- **Create** - Key generation (shown only once!)
- **List** - Key list (without values)
- **Update** - Change name, scopes, rate limit
- **Rotate** - Rotation with grace period
- **Revoke** - Deactivation with reason (audit trail)

### API Keys Security
- **SHA-256 hashing** - Keys stored as hash
- **Session-only management** - API keys cannot manage themselves
- **Audit logging** - `last_used_at`, `usage_count`, `last_used_ip`
- **Expiration** - Optional expiration date

### Pagination
- **Cursor-based** - Efficient pagination for large datasets
- **Offset-based** - Legacy support (deprecated)
- **Consistent response** - `{ data, pagination: { cursor, has_more } }`

---

## 21. MCP Server (Model Context Protocol)

### Architecture
- **Thin wrapper** - Thin layer over REST API v1
- **stdio transport** - Communication via stdin/stdout
- **Claude Desktop** - Integration with Claude Desktop

### Tools (45 tools)
- **Products** - 8 tools (list, get, create, update, delete, toggle, duplicate, stats)
- **Users** - 8 tools (list, get, search, grant_access, revoke_access, extend_access, bulk_grant, purchases)
- **Payments** - 7 tools (list, get, search, refund, export, failed, stats)
- **Coupons** - 7 tools (list, get, create, update, delete, stats, deactivate)
- **Analytics** - 8 tools (dashboard, revenue, by_product, trends, top_products, conversion, refund_stats, compare)
- **Webhooks** - 5 tools (list, create, update, delete, logs)
- **System** - 2 tools (health, api_usage)

### Resources (4 resources)
- `sellf://dashboard` - Dashboard data (5min refresh)
- `sellf://products/active` - Active products (1min refresh)
- `sellf://alerts` - Alerts (pending refunds, failed webhooks)
- `sellf://recent-sales` - Recent sales (1min refresh)

### Prompts (6 prompts)
- `weekly-report` - Weekly sales summary
- `product-analysis` - Product analysis
- `revenue-forecast` - Revenue forecast
- `user-cohort-analysis` - User cohort analysis
- `coupon-effectiveness` - Coupon effectiveness
- `refund-analysis` - Refund analysis

### Claude Desktop Configuration
```json
{
  "mcpServers": {
    "sellf": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-server/src/index.ts"],
      "env": {
        "SELLF_API_KEY": "sf_live_xxx...",
        "SELLF_API_URL": "https://app.example.com"
      }
    }
  }
}
```

---

## 22. Bruno API Collection

### Bruno Collection
- **Folder-based** - Collection in `/bruno/` directory
- **Environment variables** - `BASE_URL`, `API_KEY`
- **All v1 endpoints** - Products, Users, Coupons, Webhooks, Analytics, System

### Example Requests
- `GET /api/v1/products` - Product list
- `POST /api/v1/api-keys` - Creating an API key
- `GET /api/v1/analytics/dashboard` - Dashboard stats

### Configuration
```
bruno/environments/local.bru.example → local.bru
```

---

## 23. Content Delivery

### Delivery Types
- **Digital content** - Embedded content
- **File download** - Downloadable files
- **Redirect** - Redirect to external URL
- **Video embed** - Embedded video

### Video Features
- **Bunny.net support** - Video streaming
- **Progress tracking** - `video_progress` table
- **Event tracking** - play/pause/seek/complete
- **Resume position** - Remembering position

---

## 24. Storefront (Frontend)

### Landing Page
- **Smart scenarios** - 4 variants (admin/guest x with/without products)
- **Featured products** - Featured products at the top
- **Product grid** - Grid of all products
- **Temporal badges** - Coming Soon, Limited Time, Sale

### Product Pages
- **Product showcase** - Description, price, images
- **Checkout button** - Purchase button
- **Variant selector** - Variant selection
- **Order bump display** - Displaying bumps

### Customer Area
- **My Purchases** - Purchase history
- **My Products** - Available products
- **Profile** - Profile editing
- **Refund requests** - Refund requests

---

## 25. Internationalization

### Languages
- **English (en)** - Full support
- **Polish (pl)** - Full support

### Features
- **next-intl** - i18n framework
- **URL-based locale** - `/en/...`, `/pl/...`
- **Language switcher** - Floating button
- **Translations** - All UI strings

---

## 26. Testing

### E2E Tests (Playwright)
- **899 E2E tests** - Comprehensive coverage
- **82 MCP unit tests** - Vitest
- **53 test files** - Modular structure

### Tested Areas
- Authentication flow
- Product management
- Payment processing
- Coupons & discounts
- Order bumps
- OTO system
- Refunds
- Waitlist
- Gatekeeper
- Integrations
- Branding
- Variants
- PWYW
- Omnibus
- GUS API

---

# Planned Features (TURBO Roadmap)

## High Priority

### 1. Upstash Redis Rate Limiting
- **Status**: Planned
- **Estimated time**: 2-3h
- **Description**: Upgrade from in-memory to serverless Redis for scalability in Vercel/Lambda

### 2. GTM Integration Phase 2
- **Status**: Planned
- **Description**: Google OAuth App + one-click setup with automatic Container and Tags creation

### 3. Real-time Social Proof
- **Status**: Planned
- **Features**:
  - "Just Bought" popup (anonymized notification)
  - Aggregate Activity (X people bought in 24h)
  - Live Viewer Count
  - Per-product configuration

### 4. Transactional Emails & Logs
- **Status**: Planned
- **Features**:
  - EmailLabs / AWS SES
  - `email_logs` table (Sent, Delivered, Bounced, Opened)
  - Admin UI for browsing
  - React Email / MJML templates

### 5. Follow-up Email Sequences
- **Status**: Planned
- **Features**:
  - Per-product email automation
  - Drag-and-drop Email Sequence Builder
  - Dynamic variables
  - Triggers: purchase, free download, access granted
  - Types: Welcome, Educational, Upsell, Re-engagement
  - Analytics: open rates, click rates, conversion rates

### 6. Invoicing Integration
- **Status**: Planned
- **Providers**: Fakturownia, iFirma
- **Future**: KSeF (National e-Invoice System) - 2-4 months

### 7. UTM & Affiliate Tracking
- **Status**: Planned
- **Estimated time**: 4-6h
- **Features**:
  - UTM capture (source, medium, campaign, term, content)
  - Affiliate ID tracking (`?ref=john123`)
  - `purchase_attribution` table
  - Revenue by UTM Source/Campaign
  - Affiliate performance analytics

---

## Medium Priority

### 8. Two-Sided Affiliate Program
- **Status**: Idea
- **Estimated time**: 2-4 weeks
- **Features**:
  - Self-service affiliate signup
  - Commission structures (percentage, fixed, tiered, recurring)
  - Buyer discount (two-sided benefit)
  - Payout management (PayPal, Bank, Store Credit)
  - Anti-fraud (self-referral prevention, IP detection)

### 9. AI Landing Page Generator
- **Status**: Planned
- **Features**:
  - One-click generation
  - AI copywriting (OpenAI/Anthropic)
  - Design automation
  - Checkout integration

### 10. Automated Review Collection
- **Status**: Planned
- **Features**:
  - Auto-request emails X days after purchase
  - Rich media (photos/videos)
  - Verified buyer badge
  - Checkout widget with top reviews

### 11. Privacy-First Cart Recovery
- **Status**: Planned
- **Features**:
  - Real-time email capture
  - GDPR compliant
  - Abandonment detection (30 min)
  - Automated follow-up
  - Dynamic coupon code

### 12. Stripe Subscriptions
- **Status**: Planned
- **Features**:
  - Stripe Billing integration
  - Subscription lifecycle events
  - "My Subscription" portal
  - Dunning management

### 13. Polish Payment Gateways
- **Status**: Planned
- **Providers**: PayU, Przelewy24, Tpay
- **Features**:
  - Payment generation
  - Webhooks
  - Refunds

### 14. Payment Balancer
- **Status**: Planned
- **Features**:
  - Failover switching
  - Smart routing by currency/fees
  - Zero-downtime switching

### 15. Advanced Video Player
- **Status**: Planned (Presto Player inspired)
- **Features**:
  - Custom styling (colors, buttons, logo)
  - Controls (speed, PiP, Sticky)
  - Overlays & CTAs at timestamps
  - Remember position, chapters
  - Protection (prevent downloads)
  - Analytics (watch %, heatmaps)

### 16. Self-Service Account Deletion
- **Status**: Planned
- **GDPR requirement**
- **Features**:
  - User deletes own account
  - Stripe subscriptions auto-cancel
  - Anonymize/soft delete
  - Session invalidation

---

## Low Priority / Ideas

### 17. Anonymous Analytics Collection
- Opt-in usage statistics
- No PII stored
- Feature adoption tracking

### 18. In-App File Hosting
- Supabase Storage, AWS S3, Cloudinary, Bunny CDN
- Upload UI
- Signed URLs, watermarking

### 19. Mux Video Integration
- Alternative video hosting

### 20. Related Products
- Cross-selling sections

### 21. Product Bundles
- Group multiple products
- Bundle discounts

### 22. Video Course Structure
- Chapters & Lessons
- Progress tracking
- Sequential unlocking
- Certificates
- Quiz integration

---

# Project Statistics

## Database
| Metric | Value |
|--------|-------|
| SQL Migrations | 6 |
| Tables | 25+ |
| RPC Functions | 40+ |
| Triggers | 20+ |
| RLS Policies | 50+ |
| Indexes | 30+ |

## API
| Metric | Value |
|--------|-------|
| API Routes | 120+ |
| REST API v1 endpoints | 50+ |
| Admin endpoints | 20+ |
| Public endpoints | 15+ |
| Webhook events | 3 |
| OpenAPI spec | ✓ |

## Frontend
| Metric | Value |
|--------|-------|
| React Components | 100+ |
| Pages | 30+ |
| Languages | 2 (EN, PL) |
| UI Libraries | Tailwind CSS |

## Testing
| Metric | Value |
|--------|-------|
| E2E Tests | 899+ |
| Unit Tests | 100+ |
| API v1 Tests | 232 |
| Test Files | 60+ |
| Test Framework | Playwright + Vitest |
| Pass Rate | 100% |

## MCP Server
| Metric | Value |
|--------|-------|
| Tools | 45 |
| Resources | 4 |
| Prompts | 6 |
| Transport | stdio |

## Tech Stack
- **Frontend**: Next.js 16, TypeScript 5.9, Tailwind CSS 4
- **Backend**: Supabase (PostgreSQL + Auth + Realtime)
- **Payments**: Stripe (Elements, Checkout, Billing)
- **API**: REST API v1 + OpenAPI 3.1 + Zod schemas
- **AI Integration**: MCP Server for Claude Desktop
- **Security**: Cloudflare Turnstile, AES-256-GCM, API Keys
- **Testing**: Playwright + Vitest
- **i18n**: next-intl (EN, PL)

---

> **Last updated**: 2026-01-11
> **Author**: Claude Code
