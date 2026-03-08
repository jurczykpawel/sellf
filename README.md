<div align="center">

# Sellf

**Self-hosted platform for selling and protecting digital products**

**An alternative to** Gumroad, LemonSqueezy, Paddle. Zero platform fees.

![Version](https://img.shields.io/badge/version-1.3.1-blue)
![Tests](https://img.shields.io/badge/tests-2,650%20passing-brightgreen)
![Status](https://img.shields.io/badge/Status-Production--Ready-brightgreen)
![Open Source](https://img.shields.io/badge/Open%20Source-100%25-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![License](https://img.shields.io/badge/License-MIT-green)

[🚀 Live Demo](https://demo.sellf.app) · [Documentation](./FEATURES.md) · [Deployment Guide](./docs/DEPLOYMENT-MIKRUS.md) · [Contributing](./CONTRIBUTING.md) · [Issues](https://github.com/jurczykpawel/sellf/issues)

</div>

<div align="center">
  <br>
  <img src="admin-panel/public/screenshots/dashboard.png" alt="Sellf Admin Dashboard" width="800">
  <p><em>Admin Dashboard: revenue analytics, sales trends, and product management</em></p>
</div>

---

## Why Sellf?

Sellf gives you **complete control** over your digital product business. No monthly fees to platforms. No revenue sharing. Your data stays on your infrastructure.

- **Stripe-powered payments** with visual setup wizard, no code required
- **Content protection** that works on any website (WordPress, Webflow, custom)
- **Sales funnels built-in:** One-Time Offers, Order Bumps, Coupons
- **EU-compliant:** Omnibus Directive price history, GDPR consent management
- **Battle-tested:** 2,650 tests (1,127 E2E + 1,523 unit) with 100% pass rate

---

## Features

<details>
<summary><strong>Payments & Checkout</strong></summary>

- Stripe Elements & Checkout integration
- Guest checkout with Magic Link login
- 26 currencies with automatic conversion
- Pay What You Want (PWYW) pricing
- Coupons (percentage, fixed amount, per-user limits)
- Order Bumps for upselling
- One-Time Offers (OTO) post-purchase
- Refund management with configurable periods

</details>

<details>
<summary><strong>Product Management</strong></summary>

- Product variants (Basic/Pro/Enterprise tiers)
- Sale pricing with quantity and time limits
- Timed access (30-day, lifetime, custom)
- Waitlist for upcoming products
- Categories and featured products
- Rich descriptions with Markdown support

</details>

<details>
<summary><strong>Content Protection (Gatekeeper)</strong></summary>

- Page-level or element-level protection
- JavaScript SDK for any website
- Custom fallback content for non-buyers
- Multi-product access on single page
- License validation

</details>

<details>
<summary><strong>Marketing & Analytics</strong></summary>

- Google Tag Manager integration
- Facebook Pixel with Conversions API (CAPI)
- Webhooks (HMAC-secured) for Zapier, Make, n8n
- Revenue dashboard with goals
- Real-time sales notifications

</details>

<details>
<summary><strong>REST API v1 & Integrations</strong></summary>

- 60+ endpoints covering products, users, payments, coupons, webhooks, analytics, and more
- Fine-grained API keys with 13 permission scopes (`products:read`, `users:write`, `*`, ...)
- Zero-downtime key rotation with configurable grace period
- Per-key rate limiting (1–1000 req/min)
- Cursor-based pagination with sorting (`sort_by`, `sort_order`), OpenAPI 3.1 spec, Swagger UI at `/api/v1/docs`
- MCP Server for Claude Desktop (45 tools, 4 resources, 6 prompts)
- Bruno API collection for testing (includes all query params)

📖 **[Full API Documentation →](docs/API.md)**

</details>

<details>
<summary><strong>Whitelabel & Theming</strong></summary>

- 5 built-in theme presets (Midnight Forge, Sunset, Ocean, Forest, Minimal Light)
- Visual Theme Editor with live preview
- Import/export themes as JSON
- Dark/Light/System mode with optional admin-enforced lock
- Unified `sf-*` CSS design token system across all UI layers
- Custom colors, typography, and border radius
- Server-side license gate for theme customization ([White-Label License](https://sellf.techskills.academy/v/sellf-white-label-license))

</details>

<details>
<summary><strong>Compliance & Security</strong></summary>

- EU Omnibus Directive (30-day price history)
- GDPR consent logging
- Cloudflare Turnstile CAPTCHA
- AES-256-GCM encryption for API keys
- Row Level Security (RLS) policies
- Rate limiting (Upstash Redis)
- Audit logging

</details>

For the complete feature list, see **[FEATURES.md](./FEATURES.md)**.

---

## Payment Model: Own Stripe Account

Sellf connects to **your own Stripe account**. You are the seller, payments go directly to you. No middleman, no revenue sharing.

### Cost Comparison at $10,000/month Revenue

| Platform | Fees | Monthly Cost | You Keep |
|----------|------|:------------:|:--------:|
| **Sellf + Stripe** | ~3.4% (Stripe only) | ~$340 | **$9,660** |
| **Paddle** | 5% + 3.5% + $0.30 | ~$880 | $9,120 |
| **LemonSqueezy** | 5% + 3.5% + $0.30 | ~$880 | $9,120 |
| **Gumroad** | 10% + 2.9% + $0.30 | ~$1,290 | $8,710 |

That's **$950/month saved** vs Gumroad, **$11,400/year** back in your pocket.

<details>
<summary><strong>What about taxes? (MoR vs Own Stripe)</strong></summary>

Platforms like Paddle, LemonSqueezy, and Gumroad act as the **Merchant of Record (MoR)**: they process payments on your behalf and handle tax compliance. Sellf takes a different approach:

| | MoR (Paddle, LS, Gumroad) | Sellf + Own Stripe |
|---|---|---|
| **Platform fees** | 5–10% of revenue | **$0** |
| **Payment processing** | Included in platform fee | ~2.9% + 30¢ ([Stripe pricing](https://stripe.com/pricing)) |
| **Tax calculation** | Handled by MoR | Optional via [Stripe Tax](https://stripe.com/tax) (+0.5%) |
| **Tax filing & remittance** | Handled by MoR | Your responsibility |
| **Customer data** | Held by the MoR platform | **Fully yours** |
| **Vendor lock-in** | Customer and payment data tied to platform | **No. Self-hosted, fully portable.** |
| **Platform risk** | Account freezes, shutdowns possible | **None. You control everything.** |

**When does tax compliance become relevant?**

For EU-based sellers, the [VAT One Stop Shop (OSS)](https://vat-one-stop-shop.ec.europa.eu/) threshold is **€10,000/year** in cross-border B2C sales. Below this, you only handle VAT in your own country. Above it, you register for OSS (a single EU-wide filing) and can use [Stripe Tax](https://stripe.com/tax/pricing) to automate calculations.

**Growth path:**
1. **Starting out:** sell in your country, handle VAT normally
2. **Growing (>€10K cross-border):** enable [Stripe Tax](https://stripe.com/tax) in Sellf admin panel (+0.5% per transaction), register for EU OSS
3. **Scaling:** consider [Stripe Managed Payments](https://docs.stripe.com/connect/managed-payments) (Stripe as MoR) or a tax accountant

> **Note:** This is general information, not tax advice. Tax obligations depend on your country, business type, and revenue. Consult a qualified tax professional for your specific situation.

</details>

---

## Live Demo

Try Sellf without installing anything: **[demo.sellf.app](https://demo.sellf.app)**

- Full admin panel access, browse products, dashboard, settings
- Test checkout with Stripe test cards (`4242 4242 4242 4242`)
- Data resets every hour

<details>
<summary><strong>Screenshots</strong></summary>
<br>

| | |
|:---:|:---:|
| ![Products](admin-panel/public/screenshots/products.png) | ![Storefront](admin-panel/public/screenshots/storefront.png) |
| **Products:** manage pricing, status, and visibility | **Storefront:** your public store with free & premium products |
| ![Checkout](admin-panel/public/screenshots/checkout.png) | ![Settings](admin-panel/public/screenshots/settings.png) |
| **Checkout:** one-page purchase with upsells and tax fields | **Settings:** 5 theme presets with live preview |
| ![Dashboard Dark](admin-panel/public/screenshots/dashboard-dark.png) | ![Products Dark](admin-panel/public/screenshots/products-dark.png) |
| **Dashboard** (dark mode) | **Products** (dark mode) |

</details>

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.1+ (runtime & package manager)
- [Docker](https://www.docker.com/) (for local Supabase)
- [Supabase CLI](https://supabase.com/docs/guides/cli) v2.45+

### Run Locally

```bash
# 1. Clone
git clone https://github.com/jurczykpawel/sellf.git
cd sellf

# 2. Start database
npx supabase start

# 3. Install & configure
cd admin-panel
bun install
cp .env.example .env.local  # Edit with your keys

# 4. Run
bun run dev
```

Open **http://localhost:3000**. The first registered user becomes admin.

### Build for Production

```bash
cd admin-panel
bun run build
bun start
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5.9 |
| Database | Supabase (PostgreSQL + Auth + Realtime) |
| Styling | Tailwind CSS 4 |
| Payments | Stripe (Elements, Checkout, Webhooks) |
| Testing | Playwright (1,127 E2E) + Vitest (1,523 unit) |
| i18n | next-intl (EN, PL) |

---

## Architecture

```
sellf/
├── admin-panel/       # Next.js app (main codebase)
│   ├── src/
│   │   ├── app/       # App Router (pages, API routes)
│   │   ├── components/# React components (admin, checkout, UI)
│   │   ├── lib/       # Services, utils, Stripe, Supabase
│   │   ├── messages/  # i18n (EN, PL)
│   │   └── types/     # TypeScript definitions
│   └── tests/         # Playwright E2E + Vitest unit
├── mcp-server/        # MCP server for Claude Desktop
├── supabase/          # Migrations, seed data, RPC functions
├── bruno/             # API collection (Bruno client)
├── templates/         # HTML templates for content protection
├── scripts/           # Utility scripts
└── docs/              # Deployment guides
```

---

## Configuration

All integrations can be configured via the admin panel (encrypted storage) or environment variables.

| Integration | Admin Panel | Env Variables | Notes |
|-------------|:-----------:|:-------------:|-------|
| Stripe | ✓ | ✓ | Visual wizard available |
| GUS REGON (PL) | ✓ | - | Polish company auto-fill |
| Currency Rates | ✓ | ✓ | ECB free, or paid providers |
| Google Tag Manager | ✓ | - | Container ID |
| Facebook Pixel | ✓ | - | Pixel ID + CAPI token |

See **[FEATURES.md](./FEATURES.md)** for details on all integrations.

---

## Deployment

### One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjurczykpawel%2Fsellf&root-directory=admin-panel&env=SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,STRIPE_SECRET_KEY,STRIPE_PUBLISHABLE_KEY,STRIPE_WEBHOOK_SECRET,SITE_URL&envDescription=Required%20environment%20variables%20for%20Sellf.%20See%20.env.example%20for%20all%20options.&envLink=https%3A%2F%2Fgithub.com%2Fjurczykpawel%2Fsellf%2Fblob%2Fmain%2Fadmin-panel%2F.env.example&project-name=sellf&repository-name=sellf)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/jurczykpawel/sellf&base=admin-panel)

> **Coolify / Docker:** Create a new Application in Coolify, point to this repo, set **Base Directory** to `admin-panel`, and configure env vars from [.env.example](./admin-panel/.env.example).

### Manual Deploy

| Guide | Best For |
|-------|----------|
| **[Deployment Guide](./docs/DEPLOYMENT-MIKRUS.md)** | VPS/mikr.us with PM2 (recommended) |
| **[Advanced Options](./docs/DEPLOYMENT.md)** | Docker, Full-Stack, PM2 Cluster |

> **Server requirements:** Sellf runs on 384 MB RAM. Benchmarked at **0 errors under 30 concurrent users** on a [$9/year VPS](https://mikr.us/?r=pavvel). No Docker needed — plain Node.js + PM2.

---

## Documentation

| File | Description |
|------|-------------|
| [FEATURES.md](./FEATURES.md) | Complete feature list with roadmap |
| [Deployment Guide](./docs/DEPLOYMENT-MIKRUS.md) | Step-by-step deployment guide |
| [STRIPE-TESTING-GUIDE.md](./STRIPE-TESTING-GUIDE.md) | Testing payments locally |
| [BACKLOG.md](./BACKLOG.md) | Development roadmap |
| [mcp-server/README.md](./mcp-server/README.md) | MCP Server setup guide |
| `/api/v1/docs` | Interactive Swagger UI (OpenAPI 3.1) |

---

## Roadmap

- [x] Dark/Light theme with admin control
- [x] Whitelabel Theme System (presets, editor, import/export)
- [x] REST API v1 with OpenAPI 3.1 + Swagger UI
- [x] MCP Server for Claude Desktop
- [x] Simple Funnel System (OTO chaining)
- [ ] Zero-Config Setup Wizard (no .env needed)
- [ ] Transactional Emails & Logs
- [ ] Invoicing Integration (Fakturownia, KSeF)
- [ ] Stripe Subscriptions (recurring payments)

Full roadmap: [BACKLOG.md](./BACKLOG.md)

---

## Project Stats

```
├── 2,650 tests (1,127 E2E + 1,523 unit, 100% pass rate)
├── 90+ API routes (v1 REST API + admin + public)
├── 36 database tables
├── 73 RPC functions
├── 92 RLS policies
├── MCP Server (45 tools, 4 resources, 6 prompts)
└── 2 languages (EN, PL)
```

---

## Support This Project

Sellf is free and open source. If it saves you money on platform fees, consider supporting development by purchasing a white-label license — it removes the "Powered by Sellf" watermark and unlocks the Theme Editor.

| License | Price | Use Case |
|---------|-------|----------|
| **Personal** | Pay What You Want (min $9, suggested $29) | 1 Sellf instance |
| **Agency Pack** | $99 | 5 license keys for client projects |

**[Get a White-Label License →](https://sellf.techskills.academy/v/sellf-white-label-license)**

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

Ways to contribute:
- Report bugs via [Issues](https://github.com/jurczykpawel/sellf/issues)
- Submit feature requests
- Open Pull Requests
- Improve documentation or translations

---

## Security

Sellf handles sensitive data (Stripe API keys, payment transactions, user accounts), so security is treated as a first-class requirement, not an afterthought.

**What we do:**

- **Regular penetration testing** — automated and manual security audits covering OWASP Top 10, with 280+ test cases across authentication, authorization, input validation, CORS, CSRF, injection vectors, business logic, and infrastructure
- **Row Level Security (RLS)** on every database table — enforced at the PostgreSQL level, not just the application layer
- **Zero platform access to your keys** — Stripe credentials are stored in your `.env.local` on your server. Sellf never phones home, has no telemetry, and no external API calls except to Supabase and Stripe
- **Built-in Security Audit panel** — Settings > System runs 11 automated checks against your Supabase and app configuration, with actionable fix instructions for each issue found
- **Secure defaults** — CORS locked to your domain only, `HttpOnly` + `Secure` cookies, Content-Type validation, rate limiting on all public endpoints, webhook signature verification

**Your Stripe keys stay on your server.** Sellf is fully self-hosted — there is no SaaS component, no cloud dependency, and no way for anyone (including us) to access your credentials.

See [SECURITY.md](./SECURITY.md) for reporting vulnerabilities.

---

## Acknowledgments

Built with [Next.js](https://nextjs.org/), [Supabase](https://supabase.com/), [Stripe](https://stripe.com/), [Tailwind CSS](https://tailwindcss.com/), [Playwright](https://playwright.dev/), [Vitest](https://vitest.dev/), and [next-intl](https://next-intl.dev/).

---

## License

MIT License. See [LICENSE](./LICENSE) for details.

---

<div align="center">

**[Website](https://sellf.app)** · **[Documentation](./FEATURES.md)** · **[Report Bug](https://github.com/jurczykpawel/sellf/issues)**

</div>

![](https://stats.techskills.academy/pixels/github?url=/readme/sellf)
