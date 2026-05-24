# Sellf Landing Page Redesign — Design Spec

**Date:** 2026-05-24  
**Branch:** `feat/landing-redesign`  
**Worktree:** `.claude/worktrees/landing-redesign`  
**Scope:** Redesign of `/[locale]/about` (Sellf SaaS marketing page) — copy, IA, Sellf-specific microinteractions, component refactor, TDD coverage.

---

## 1. Context

`/[locale]/about` is the only marketing surface for Sellf-the-platform. In `DEMO_MODE=true` it serves as the root page at `demo.sellf.app`. It targets prospective merchants choosing between Sellf (self-hosted, 0 fees) and Gumroad / LemonSqueezy / Paddle / EasyCart.

The current LP (1,495 LOC across 13 components, full PL/EN parity) is functional but:

1. **Coverage gap.** Several shipped product surfaces are absent from copy: PWYW / Tip Jar, Order Bumps + OTO, Webhooks DLQ + retry, Login Wall (content gating snippet), Magic-link guest checkout, License-tier registry (free/registered/pro/business), GUS REGON integration, Embedded Checkout snippet on third-party domains, Marketing integrations (GTM + Meta CAPI + Consent Mode v2 + Klaro), MCP server (45 tools).
2. **Generic motion vocabulary.** Existing animations are pure `Reveal` (fade-up) + `RevealGroup` stagger + one slider (FeeComparison). Nothing visually conveys what makes Sellf Sellf: webhook reliability, embed-anywhere checkout, content-gating handoff, tax-status growth path.
3. **No agent-ready surface.** Missing `llms.txt`, `Organization` + `SoftwareApplication` JSON-LD, per-page OG image build pipeline, robots Content-Signals header.
4. **No section-level E2E.** Existing `smart-landing.spec.ts` and `cookieconsent-integration.spec.ts` only verify nav presence and consent flow. No assertions that hero loads, FeatureGrid renders all 17 keys, microinteractions fire on intersection, FAQ accordion expands.
5. **Refactor opportunity.** Reveal / RevealGroup logic is duplicated in nine components, intersection-observer setup lives client-side per-component, copy keys for FeatureGrid are spread across 17 hardcoded references — clean DRY targets per coding-standards.md.

## 2. Decisions (autonomous, recorded for review)

| # | Question | Decision | Reasoning |
|---|----------|----------|-----------|
| D1 | In-place vs parallel route | Redesign **in place** at `/[locale]/about`; develop on `feat/landing-redesign` branch with PR preview deploy as gate | Pawel memory: `feedback_no_scope_creep_on_marketplace` — minimal additive scope. Branch-deploy is the existing safety net; a parallel `/about-v2` route would orphan i18n keys and add cleanup debt. |
| D2 | Audience priority | **PL-first**, EN full parity | MEMORY `tooling-no-make-zapier` + `_db-tasks/` convention: TSA primary market is Polish solopreneurs. EN parity is non-negotiable (existing standard, no drift) but the strongest hooks land first in PL. |
| D3 | Microinteractions ambition | **Curated set of 6** — one per major feature pillar | KISS + perf budget. Memory `feedback_comments_strict` / `feedback_minimal_edits` favors disciplined minimum. Six interactions = enough surface to feel distinctive, few enough to keep ≤ 70 KB JS over budget and pass `prefers-reduced-motion`. |
| D4 | Worktree | **Yes**, `.claude/worktrees/landing-redesign` from `main@b1afc79` | Brief explicit. Convention already established (webhook-dlq worktree co-exists). |
| D5 | i18n strategy | Add new keys under existing `landing.*` namespace; never delete a shipped key in the same PR as adding new ones | Avoid translator desync. Removed keys land in a follow-up cleanup commit after PL/EN updates have soaked. |
| D6 | New marketing surfaces | **None.** No `/pricing`, no `/features`. Everything stays on `/about` as anchored sections. | Memory `feedback_no_scope_creep_on_marketplace`. New routes are out of scope unless explicitly asked. |
| D7 | Visual companion | **Skip** | Goal-mode autonomy; user prefers progress over mockup approval loops. ASCII previews in the spec serve as the visual reference. |

## 3. Scope

**In scope (this spec → next implementation plan):**

- Refactor of all 13 components under `admin-panel/src/app/[locale]/about/components/`
- New copy in `landing.*` namespace (PL + EN parity)
- Six Sellf-specific microinteractions (catalogue in §6)
- Shared microinteraction primitives in `admin-panel/src/components/landing-fx/` (new dir)
- TDD layers (unit + Playwright section + a11y + visual)
- Agent-ready: `llms.txt`, JSON-LD, OG metadata, robots Content-Signals
- WCAG 2.1 AA compliance with Lighthouse a11y ≥ 95
- No deploy to mikrus. All local + branch CI build only.

**Out of scope:**

- Storefront (`[locale]/page.tsx`), product pages (`/p/[slug]`), dashboard, admin pages
- Pricing page, features page, separate marketing site
- Logo, favicon, font-family change (token system stays)
- Lighthouse-perfect 100 — target ≥ 95 each, not 100
- E2E migration to Playwright Test Generator
- Per-page OG image build pipeline beyond the LP (one OG image is enough for `/about`)

## 4. Information Architecture (target section order)

```
┌──────────────────────────────────────────────────────────────┐
│ LandingNav         (sticky, hash-link aware)                 │
├──────────────────────────────────────────────────────────────┤
│ Hero               REVISED — primary value prop + revenue    │
│                    impact ticker (Sellf-fx #1)                │
├──────────────────────────────────────────────────────────────┤
│ SocialProofBar     KEEP — refine stat copy                    │
├──────────────────────────────────────────────────────────────┤
│ FeeComparison      KEEP — extend slider with annual savings  │
│                    counter pulse (Sellf-fx #2)                │
├──────────────────────────────────────────────────────────────┤
│ FeatureGrid        REVISED — extend to 21 cards (PWYW, Tip   │
│                    Jar, OrderBumps+OTO, LoginWall, MCP)       │
│                    Card-flip on hover reveals snippet/        │
│                    config (Sellf-fx #3)                       │
├──────────────────────────────────────────────────────────────┤
│ EmbedCheckoutDemo  NEW — live `<script>` snippet that         │
│                    actually renders a checkout iframe on      │
│                    a fake-merchant card (Sellf-fx #4)         │
├──────────────────────────────────────────────────────────────┤
│ UseCases           KEEP, refresh copy with PWYW / waitlist   │
├──────────────────────────────────────────────────────────────┤
│ TaxSection         KEEP — refine VAT growth-path copy        │
├──────────────────────────────────────────────────────────────┤
│ HowItWorks         KEEP — replace step icons with motion     │
│                    diagrams (Sellf-fx #5: webhook timeline)  │
├──────────────────────────────────────────────────────────────┤
│ SelfHostedComparison KEEP, add MCP server line              │
├──────────────────────────────────────────────────────────────┤
│ TechStackGrid      KEEP, add MCP + Bun                      │
├──────────────────────────────────────────────────────────────┤
│ LicenseTier        NEW — free / registered / pro / business │
│                    feature matrix with row hover preview     │
│                    (Sellf-fx #6: tier highlight wave)        │
├──────────────────────────────────────────────────────────────┤
│ FAQSection         KEEP, extend by 3 items (DLQ, MCP, tax)  │
├──────────────────────────────────────────────────────────────┤
│ FinalCTA           KEEP — refine subhead                    │
├──────────────────────────────────────────────────────────────┤
│ LandingFooter      KEEP — add llms.txt + RSS hrefs          │
└──────────────────────────────────────────────────────────────┘
```

**Two new sections (EmbedCheckoutDemo, LicenseTier) + revisions to four existing. Net: 15 sections total, 13 → 15.**

## 5. Copy Strategy

**Persona:** Polish solopreneur / freelancer / digital creator who pays 4–9 % to Gumroad / LemonSqueezy and is technically curious enough to PM2-deploy a Next.js app (or pay TSA for the bundled deploy).

**Voice:** Pawel's voice from `vault/brands/_shared/founder/profil.md` — "lazy engineer who automates to save money," conversational, hard numbers, no jargon gatekeeping. PL idiom over corporate-PL.

**Headline pattern:** [problem the user feels] + [Sellf inversion] + [proof point with number].

**Hook examples (PL):**

- *Hero*: `Sprzedawaj produkty cyfrowe bez stałych opłat. Bez 9% prowizji. Bez ograniczeń liczby produktów.` → existing copy is in this direction but lacks the number — add `0 PLN / mies. zamiast 297 PLN przy 10k PLN obrotu`.
- *FeatureGrid card for PWYW*: `Zapłać ile uważasz` + `Twoi fani sami ustalają cenę. Z minimalnym progiem albo bez.`
- *EmbedCheckoutDemo*: `Wklejasz 1 linijkę kodu. Checkout startuje na Twojej stronie.`
- *LicenseTier — free*: `Dla solopreneurów. Bez ograniczeń liczby produktów. Bez limitu sprzedaży.`

**EN parity:** every new key has both `landing.<key>` entries in `en.json` + `pl.json`. PR check: `bun run typecheck` catches `useTranslations` missing key references.

**Copy doc location:** copy strings live in `admin-panel/src/messages/{en,pl}.json` under existing `landing.*` namespace. No external copy doc — translations are source of truth.

## 6. Sellf-specific Microinteractions Catalogue

Six interactions, each tied to a real Sellf feature. All respect `prefers-reduced-motion: reduce` by falling back to a static end-state.

### Sellf-fx #1 — Hero "Revenue impact ticker"

**What it shows:** As the slider in FeeComparison moves below the fold, a small badge near the hero subtitle ticks up showing PLN saved vs Gumroad annually. Click → smooth-scrolls to FeeComparison and pulses the slider thumb.

**Maps to:** Fee comparison feature, the core economic pitch.

**Implementation:** `IntersectionObserver` watches FeeComparison; hero badge subscribes via Zustand-free shared state (React context or a small event bus in `landing-fx/`). NumberCounter primitive already exists in `SocialProofBar` → extract to shared `<NumberCounter>` in `landing-fx/`.

### Sellf-fx #2 — FeeComparison "Annual savings pulse"

**What it shows:** When the slider crosses thresholds (1k, 10k, 100k PLN/mo), the "you save annually" number pulses, briefly underlines, and the corresponding competitor bar shimmers red. Below 1k → no pulse.

**Maps to:** The progressive realization that fees compound.

**Implementation:** Threshold crossings detected in `useEffect` watching `revenue` state; CSS keyframe `@keyframes savings-pulse` + `transform: scale(1.06)` for 300 ms; respect reduced-motion.

### Sellf-fx #3 — FeatureGrid "Snippet flip"

**What it shows:** Hovering a feature card flips it (3D rotateY 180deg) revealing a code snippet / config example for that feature. Mobile: tap to flip, tap outside to flip back. Examples:

- *Webhooks* card → flips to `POST https://your-n8n.example.com/webhook/sellf — Authorization: SHA256=...`
- *Embed* card → flips to `<script src="https://demo.sellf.app/embed/v1/checkout.js" data-product="x"></script>`
- *MCP* card → flips to `claude mcp add sellf -- npx @sellf/mcp-server`
- *GUS REGON* card → flips to `NIP 1234567890 → auto-fill (firma, ulica, miasto, kod)`

**Maps to:** Sellf's developer-first ergonomics — "you can actually paste this."

**Implementation:** New `<SnippetFlipCard>` component in `landing-fx/`. Two `<div>` faces, CSS `perspective: 1000px; transform-style: preserve-3d`. Keyboard: `Tab` focus + `Space/Enter` flips. ARIA: `aria-expanded` on the card, both faces in DOM, hidden face `aria-hidden="true"` when not active. Reduced-motion → cross-fade instead of flip.

### Sellf-fx #4 — EmbedCheckoutDemo "Paste-to-load"

**What it shows:** A mock browser frame containing `<script>` text. Click "Run" → the script "loads" with a fake-network shimmer, then a real Sellf-styled checkout iframe renders inside the mock browser. Copy button copies the snippet with a check-mark animation.

**Maps to:** The single strongest dev-experience pitch — "you paste, it works."

**Implementation:** No actual cross-origin iframe — render a `<StripeEmbeddedCheckoutSkeleton>` component that visually matches the real embed (locked-down because real Stripe Elements would need keys). Skeleton shows: shop logo box, product title, price, "Pay with card" button, security padlock. Animation: `clip-path: inset(0 100% 0 0)` → `inset(0 0 0 0)` to "wipe in" + opacity.

### Sellf-fx #5 — HowItWorks "Webhook timeline"

**What it shows:** Step 3 ("Customer purchases → you get paid") expands on intersection to a 3-tick timeline: `Stripe webhook → Sellf records → Your n8n /webhook fires`. Ticks light up in sequence, 200 ms each. Looped (replays every 8 s while in viewport).

**Maps to:** The webhook reliability + n8n compatibility pitch (DLQ + retry are core selling points).

**Implementation:** SVG with three `<circle>` ticks + a connecting line. Stroke-dashoffset animation. On viewport exit → animation pauses (saves CPU).

### Sellf-fx #6 — LicenseTier "Tier highlight wave"

**What it shows:** Hovering a column (Free / Registered / Pro / Business) sweeps a soft horizontal highlight across the row of feature ticks for that tier. Pro tier (recommended) has a permanent shimmer line moving slowly along its column border (3 s loop).

**Maps to:** License-tier registry — explains gating gracefully ("watermark removal at Pro" etc.).

**Implementation:** CSS-only `background: linear-gradient` translation on column hover; permanent Pro shimmer uses `@keyframes shimmer` on `::before`. Reduced-motion → static border highlight.

---

**Shared primitives** to extract from existing code into `admin-panel/src/components/landing-fx/`:

| Primitive | Purpose | Existing usage |
|-----------|---------|----------------|
| `NumberCounter` | Animated count-up | SocialProofBar inline |
| `Reveal` | Fade-up on intersection | Already in `components/motion/` — **stays there** (used by storefront too) |
| `RevealGroup` | Staggered children | Already in `components/motion/` — **stays there** |
| `SnippetFlipCard` | Card with face-flip | new |
| `WebhookTimeline` | SVG sequence ticks | new |
| `TierShimmer` | Column highlight | new |
| `useReducedMotion` | Hook returning bool | new |
| `useInView` | IntersectionObserver wrapper | new (consolidate ad-hoc usage) |

The existing `components/motion/{Reveal,RevealGroup,reveal-observer.ts}` stay in place — they're already used outside `/about` (storefront uses them too per audit). New primitives live in `landing-fx/` to make it obvious they're LP-only and disposable.

## 7. Component Decomposition (DRY / SOLID refactor)

**Refactor targets (opportunistic, only where they pay off):**

1. **Pull `useInView` out of inline IntersectionObserver setup.** At least four LP components instantiate IO ad-hoc. New `useInView(threshold, rootMargin)` hook returns `[ref, inView]`. **Test:** unit test with `IntersectionObserver` mock asserts `inView` flips on entry/exit.

2. **`useReducedMotion()` hook.** Reads `window.matchMedia('(prefers-reduced-motion: reduce)').matches`, subscribes to change event. Used by all six microinteractions. **Test:** unit test stubs `matchMedia`, asserts return value tracks the media query.

3. **`<NumberCounter value duration format />`.** Extracted from inline code in `SocialProofBar`. **Test:** unit test asserts after `duration` ms the rendered text equals `format(value)`.

4. **Section-level boundaries**: each section component becomes a pure render-from-props consumer — no inline IO, no inline matchMedia. Side-effects centralized in primitives. SOLID-S: each component does one thing (renders its section); SOLID-D: it depends on hook abstractions, not browser APIs directly.

5. **Copy keys decoupled from layout.** `FeatureGrid` currently lists 17 keys with hardcoded order. Refactor: define `FEATURE_KEYS` as a const array (typed `as const`) at top of file → map. Two new entries (PWYW, MCP) plug in by adding to the array. **Test:** unit test asserts all keys in `FEATURE_KEYS` exist in `en.json` and `pl.json` — protects against translation drift.

6. **Eliminate inline GitHub URL constant in `LandingNav`.** Move to `admin-panel/src/lib/constants.ts` as `SELLF_GITHUB_URL`. Already partly conventional (constants.ts exists).

## 8. Testing Plan (TDD layers, RED → GREEN → REFACTOR)

Per AGENTS.md operational mandate + memory `feedback_tests_are_truth`. Tests written before implementation. Test edits only OK for deprecated assertions, NEVER to make a failing app go green.

### Layer A — Unit (Vitest) — `tests/unit/landing-fx/`

| File | Asserts |
|------|---------|
| `useInView.test.ts` | Returns `[ref, false]` initially; flips `true` when mock IO calls `isIntersecting=true`; cleans up observer on unmount |
| `useReducedMotion.test.ts` | Returns `false` by default; flips when `matchMedia` change event fires |
| `NumberCounter.test.tsx` | Renders `0` initially; renders `format(value)` after `duration` (fake timers) |
| `feature-keys.test.ts` | Every key in `FEATURE_KEYS` exists in both `en.json` and `pl.json`; same for `USE_CASE_KEYS`, `FAQ_KEYS` |
| `landing-constants.test.ts` | `SELLF_GITHUB_URL` matches expected pattern (https + jurczykpawel/sellf) |

### Layer B — Playwright section E2E — `tests/landing-redesign.spec.ts`

| Test | Asserts |
|------|---------|
| `renders all 15 sections` | Each section has its own `data-landing-section="<name>"` attribute and is visible after scroll |
| `hero badge appears once FeeComparison enters viewport` | Scroll to FeeComparison, assert hero badge text contains `PLN` |
| `slider crossing 10k triggers savings pulse class` | Drag slider, assert `data-pulse-state="pulsing"` toggles |
| `snippet flip card flips on click` | Click feature card, assert `aria-expanded="true"`, snippet text visible |
| `embed checkout demo loads skeleton on Run click` | Click Run, assert checkout skeleton renders with shop logo + price |
| `webhook timeline animates ticks in sequence` | After Step 3 enters viewport, all 3 ticks reach `data-state="lit"` within 1 s |
| `license tier shimmer present on Pro column` | Pro column has `data-shimmer="true"` continuously |
| `language switcher works on /about` | EN → PL flip, hero headline changes |
| `keyboard nav reaches every CTA` | Tab through page, assert focus visits Skip→Nav→Hero CTA(2)→…→Footer last link |

### Layer C — Accessibility (Playwright + axe-core) — `tests/landing-redesign-a11y.spec.ts`

| Test | Asserts |
|------|---------|
| `no a11y violations on /about` | `@axe-core/playwright` AxeBuilder run, 0 violations at WCAG 2.1 AA |
| `Skip to main content link works` | Tab → first focusable is skip link; Enter → focus on `#main-content` |
| `all images have alt text` | DOM query asserts every `<img>` has `alt` attribute (decorative → empty string) |
| `prefers-reduced-motion disables flips` | Set context `reducedMotion: 'reduce'`, click feature card, assert no transform animation (cross-fade only) |

### Layer D — Visual regression (Playwright snapshots, viewport matrix)

Use existing `playwright.config.ts` projects (`visual-mobile`, `visual-tablet`, `visual-laptop`, `visual-wide`, `visual-qhd`, `visual-4k`). One snapshot per viewport for `/about`. Snapshots committed at first successful run; subsequent diffs fail CI.

### Layer E — Smoke (already present)

`tests/smart-landing.spec.ts` + `cookieconsent-integration.spec.ts` keep passing unchanged.

---

**TDD execution order:** Layer A unit tests → primitive impl → Layer B section tests → section impl + microinteraction impl → Layer C a11y → fix violations → Layer D visual baseline → Layer E re-run.

## 9. Accessibility / Performance / Cookie Consent

Per memory `feedback_wcag_default`, `feedback_per_page_og_images`, `feedback_image_formats_default`, `feedback_cookie_consent_default`:

- **WCAG 2.1 AA**: semantic landmarks (header/nav/main/footer present), heading hierarchy h1 → h2 (no skipped levels), 4.5:1 contrast on all text, `:focus-visible` 3px outline, 44×44 touch targets, `<html lang>` already correct per next-intl, `prefers-reduced-motion` honored by all six microinteractions. **Target Lighthouse a11y ≥ 95.**
- **Per-page OG image**: build-time generated PNG at `public/og/about.png` (1200×630). Astro-style pipeline not applicable (Next.js); use `next/og` `ImageResponse` at `/api/og/about` with cache headers. Referenced from `generateMetadata` openGraph.
- **AVIF/WebP**: hero illustration delivered as `next/image` with auto-format negotiation. Width/height explicit. Hero `priority` + `fetchPriority="high"`.
- **Cookie consent**: existing Klaro setup remains. New analytics events (if any added) attach to `analytics` category. **No new pixels — only Umami (cookie-less, always on) + existing GTM if a buyer already consented.** No new consent surface needed.
- **Performance budget**: TBP ≤ 200 ms, LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms. JS for new microinteractions ≤ 25 KB gz total (six interactions sharing primitives).

## 10. Agent-Ready Surface

Per memory `feedback_agent_ready_default`:

- **robots.txt**: extend existing (if any) with Content-Signal header — `search=yes, ai-input=yes, ai-train=no`. Block CCBot, GPTBot, Google-Extended, Anthropic-ai, Meta-ExternalAgent. Allow OAI-SearchBot, PerplexityBot, Claude-SearchBot. Lives in `admin-panel/public/robots.txt` (override Next.js default).
- **sitemap.xml**: generated by `admin-panel/src/app/sitemap.ts` (Next.js convention). Include `/`, `/en/about`, `/pl/about`, `/en/store`, `/pl/store`. `lastmod` from build time.
- **llms.txt**: new at `admin-panel/public/llms.txt`. Hand-written. Lists Sellf identity + GitHub + key features in <50 lines.
- **JSON-LD**: three inline `<script type="application/ld+json">` blocks rendered from `generateMetadata` (or inline `<Script>` in the layout):
  - `Organization` — name "Sellf", url, logo, sameAs (GitHub repo)
  - `WebSite` — name "Sellf", url, potentialAction (SearchAction → `/store?q={query}`)
  - `SoftwareApplication` — name, description, applicationCategory `BusinessApplication`, operatingSystem `Linux, macOS, Windows (via Node.js)`, offers (free), softwareVersion (from `package.json`), screenshot (= OG image), sameAs (GitHub repo)
- **Meta tags**: `generateMetadata` already provides title + description. Add: openGraph (title, description, image=/api/og/about, locale, type=website), twitter:card=summary_large_image, canonical (absolute), robots max-image-preview:large.

## 11. Security

Per AGENTS.md Security First and OWASP Top 10:

- **No new API endpoints.** All new content is static or runs `useTranslations` on the server. No new auth surface.
- **No CSP weakening.** Microinteractions are pure CSS + React state; no inline scripts.
- **Embed snippet copy text in EmbedCheckoutDemo** is hardcoded HTML-escaped string in i18n, not user input.
- **Mock checkout skeleton** uses no real Stripe keys; pure presentation. The fake "Pay" button is a non-submitting `<button type="button">` that toggles a "(this is a demo)" tooltip.
- **No localStorage / sessionStorage writes** from new code (consent banner handled separately by Klaro).
- **No `eval`, no `dangerouslySetInnerHTML`** — confirmed in lint config + grep.
- **Memory `feedback_no_private_refs_in_repos`**: design doc + commits + PR body contain NO Vaultwarden item IDs, internal panel URLs, personal emails, or user-specific paths. The doc references `vault/...` paths inside the development workspace only — never copied verbatim into source.

## 12. Rollout

1. Implement on `feat/landing-redesign` (current worktree).
2. CI on push: `bun run typecheck` + `bun run lint` + `bun run test:unit` + `bun run test` (Playwright) — all must be green.
3. Manual local verification: `cd admin-panel && bun run dev` → `http://localhost:3000/en/about` + `/pl/about`. Lighthouse run, axe scan.
4. Self-review: re-read all 13 components for KISS/DRY/SOLID violations introduced during dev.
5. PR to `main`. Description references this spec + the plan doc.
6. Deploy: **NOT in this scope.** Per AGENTS.md "Deployment Policy: RESTRICTED" — only Pawel ships to demo.sellf.app / sellf-tsa.

## 13. Risks

| Risk | Mitigation |
|------|-----------|
| Playwright tests flake on microinteractions (timing) | Use `expect(locator).toHaveAttribute('data-state', 'lit')` polling rather than fixed sleeps. Each interaction exposes deterministic data attributes. |
| Visual regression snapshots churn on every motion frame | Snapshot taken after `page.evaluate(() => document.body.classList.add('motion-paused'))` — global class disables animations for snapshot timing. |
| i18n drift between PL and EN | Layer A unit test `feature-keys.test.ts` cross-checks both files. CI catches before merge. |
| Bundle size creep | Each `landing-fx/` primitive is its own file → tree-shakeable. Visual JS budget ≤ 25 KB gz; check via `next build` analyze. |
| Reduced-motion users get unfinished states | Each microinteraction's fallback is a *static end-state* (final number shown, snippet visible, ticks all lit). Verified in Layer C. |
| Breaking existing storefront via shared `Reveal` changes | `Reveal`/`RevealGroup` left untouched in this PR. New primitives in `landing-fx/`. |

## 14. Out of scope (explicit deferrals)

- New marketing routes (`/pricing`, `/features`)
- A11y audit of storefront / dashboard / admin
- Re-theming or palette change
- Internationalization beyond PL+EN (no DE/ES/etc.)
- Replacing Klaro with a different consent manager
- Adding video (hero stays static image)
- TSA-specific landing variants

---

## Acceptance criteria

Spec is implemented when all of the following hold:

- [ ] `/about` renders 15 sections in the order in §4 on both `en` and `pl`.
- [ ] All 6 microinteractions present and tested (Layer B).
- [ ] All Layer A unit tests pass; coverage ≥ 90 % on `landing-fx/*`.
- [ ] All Layer B + C + D + E Playwright tests pass.
- [ ] No new `eslint-disable`, `@ts-ignore`, or skipped tests.
- [ ] `bun run typecheck` + `bun run lint` + `bun run build` all clean.
- [ ] Lighthouse a11y ≥ 95 on `/en/about` and `/pl/about`.
- [ ] `prefers-reduced-motion: reduce` disables all six animations (Layer C).
- [ ] `llms.txt`, `robots.txt`, `sitemap.ts`, JSON-LD all present and validate.
- [ ] PR description links to this spec + the implementation plan.

---

**Next step:** invoke `superpowers:writing-plans` to produce an executable plan from this spec.
