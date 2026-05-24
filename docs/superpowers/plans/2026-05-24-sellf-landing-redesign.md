# Sellf Landing Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a redesigned `/[locale]/about` Sellf marketing landing with six Sellf-specific microinteractions, two new sections (EmbedCheckoutDemo + LicenseTier), full PL/EN parity, WCAG 2.1 AA compliance, and a TDD-grade Playwright suite.

**Architecture:** Refactor in place on `feat/landing-redesign`. New primitives in `admin-panel/src/components/landing-fx/`. Six microinteractions tied 1:1 to product features. Re-use `motion/react`'s `useInView` + `useReducedMotion` rather than reinventing IO/matchMedia. Translation drift caught by Vitest, render correctness by Playwright, a11y by axe-playwright.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, Tailwind CSS v4, next-intl v4, `motion/react` v12, Vitest, Playwright, `@axe-core/playwright`, Bun runtime.

---

## File Map

**Create:**

| Path | Responsibility |
|------|----------------|
| `admin-panel/src/components/landing-fx/SnippetFlipCard.tsx` | Card that flips on hover/focus to reveal a code snippet face |
| `admin-panel/src/components/landing-fx/SnippetFlipCard.module.css` | 3D flip animation (perspective + transform-style: preserve-3d) |
| `admin-panel/src/components/landing-fx/WebhookTimeline.tsx` | Looped SVG of 3 sequential ticks, pauses out-of-view |
| `admin-panel/src/components/landing-fx/index.ts` | Barrel export |
| `admin-panel/src/app/[locale]/about/components/EmbedCheckoutDemo.tsx` | "Paste-to-load" mock checkout iframe demo |
| `admin-panel/src/app/[locale]/about/components/LicenseTier.tsx` | Free/Registered/Pro/Business comparison matrix with shimmer |
| `admin-panel/src/app/[locale]/about/jsonld.ts` | Returns three JSON-LD objects (Organization, WebSite, SoftwareApplication) |
| `admin-panel/src/lib/landing/feature-keys.ts` | `FEATURE_KEYS`, `USE_CASE_KEYS`, `TIER_KEYS` const arrays |
| `admin-panel/src/app/sitemap.ts` | Next.js sitemap (`/`, `/{en,pl}/{about,store}`) |
| `admin-panel/src/app/api/og/about/route.ts` | `next/og` `ImageResponse` for `/about` OG image |
| `admin-panel/public/llms.txt` | LLM-readable site summary |
| `admin-panel/public/robots.txt` | Robots + Content-Signals + bot allow/deny rules |
| `admin-panel/tests/unit/landing-fx/feature-keys.test.ts` | i18n drift catcher |
| `admin-panel/tests/unit/landing-fx/landing-constants.test.ts` | Asserts `SELLF_GITHUB_URL` shape |
| `admin-panel/tests/landing-redesign.spec.ts` | Playwright section-level E2E |
| `admin-panel/tests/landing-redesign-a11y.spec.ts` | axe-playwright accessibility suite |
| `admin-panel/tests/landing-redesign-visual.spec.ts` | Visual baseline snapshots (6 viewports) |

**Modify:**

| Path | Why |
|------|-----|
| `admin-panel/src/app/[locale]/about/page.tsx` | Add 2 new sections, JSON-LD, generateMetadata for OG |
| `admin-panel/src/app/[locale]/about/components/HeroSection.tsx` | Add revenue impact ticker (Sellf-fx #1) + `data-landing-section="hero"` |
| `admin-panel/src/app/[locale]/about/components/FeeComparisonSection.tsx` | Add savings pulse (Sellf-fx #2) |
| `admin-panel/src/app/[locale]/about/components/FeatureGrid.tsx` | Extend to 21 cards, integrate SnippetFlipCard (Sellf-fx #3) |
| `admin-panel/src/app/[locale]/about/components/HowItWorks.tsx` | Replace step-3 icon with WebhookTimeline (Sellf-fx #5) |
| `admin-panel/src/app/[locale]/about/components/UseCases.tsx` | Refresh PWYW + waitlist copy, add `data-landing-section` |
| `admin-panel/src/app/[locale]/about/components/SelfHostedComparison.tsx` | Add MCP server bullet |
| `admin-panel/src/app/[locale]/about/components/TechStackGrid.tsx` | Add MCP + Bun chips |
| `admin-panel/src/app/[locale]/about/components/FAQSection.tsx` | +3 FAQ items |
| `admin-panel/src/app/[locale]/about/components/LandingNav.tsx` | Replace inline GitHub URL with const |
| `admin-panel/src/app/[locale]/about/components/LandingFooter.tsx` | Add llms.txt link |
| `admin-panel/src/app/[locale]/about/components/SocialProofBar.tsx` | Add `data-landing-section` |
| `admin-panel/src/app/[locale]/about/components/TaxSection.tsx` | Add `data-landing-section` |
| `admin-panel/src/app/[locale]/about/components/FinalCTA.tsx` | Add `data-landing-section` |
| `admin-panel/src/lib/constants.ts` | Add `SELLF_GITHUB_URL` |
| `admin-panel/src/messages/en.json` | New landing.* keys |
| `admin-panel/src/messages/pl.json` | Mirror EN additions |
| `admin-panel/package.json` | Add `@axe-core/playwright` (devDependencies) if absent |

---

### Task 0: Bun install + verify worktree builds

**Files:**
- Modify: none (read-only verification)

- [ ] **Step 0.1: Install deps in the worktree**

```bash
cd .claude/worktrees/landing-redesign/admin-panel
bun install
```

Expected: "Done." with no peer dependency errors.

- [ ] **Step 0.2: Verify typecheck baseline is green before changes**

```bash
bun run typecheck
```

Expected: exit 0, no TS errors.

- [ ] **Step 0.3: Confirm `@axe-core/playwright` is available**

```bash
bun pm ls | grep -i axe
```

If missing:

```bash
bun add -d @axe-core/playwright
```

Expected after add: a new line in `package.json` devDependencies.

- [ ] **Step 0.4: Commit dep change (if any)**

```bash
git add admin-panel/package.json admin-panel/bun.lock 2>/dev/null || git add admin-panel/package.json
git -c commit.gpgsign=false commit -m "chore(landing): add @axe-core/playwright dev dep"
```

Skip if no change.

---

### Task 1: i18n drift safety net (TDD — RED first)

**Files:**
- Create: `admin-panel/src/lib/landing/feature-keys.ts`
- Create: `admin-panel/tests/unit/landing-fx/feature-keys.test.ts`

- [ ] **Step 1.1: Write failing unit test**

`admin-panel/tests/unit/landing-fx/feature-keys.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import enMessages from '@/messages/en.json';
import plMessages from '@/messages/pl.json';
import {
  FEATURE_KEYS,
  USE_CASE_KEYS,
  TIER_KEYS,
} from '@/lib/landing/feature-keys';

type MessageRecord = Record<string, unknown>;

function getNested(obj: MessageRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object' && segment in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, obj);
}

function expectKeyPresent(messages: MessageRecord, key: string, locale: string) {
  const value = getNested(messages, key);
  expect(value, `missing landing key "${key}" in ${locale}.json`).toBeDefined();
  expect(typeof value, `landing key "${key}" must be a string in ${locale}.json`).toBe('string');
}

describe('landing key inventory', () => {
  it.each(FEATURE_KEYS)('feature "%s" has title+desc in both locales', (key) => {
    expectKeyPresent(enMessages as MessageRecord, `landing.features.${key}.title`, 'en');
    expectKeyPresent(enMessages as MessageRecord, `landing.features.${key}.desc`, 'en');
    expectKeyPresent(plMessages as MessageRecord, `landing.features.${key}.title`, 'pl');
    expectKeyPresent(plMessages as MessageRecord, `landing.features.${key}.desc`, 'pl');
  });

  it.each(USE_CASE_KEYS)('use case "%s" has full keys in both locales', (key) => {
    for (const sub of ['title', 'desc', 'feature1', 'feature2', 'feature3']) {
      expectKeyPresent(enMessages as MessageRecord, `landing.useCases.${key}.${sub}`, 'en');
      expectKeyPresent(plMessages as MessageRecord, `landing.useCases.${key}.${sub}`, 'pl');
    }
  });

  it.each(TIER_KEYS)('license tier "%s" has full keys in both locales', (key) => {
    for (const sub of ['name', 'tagline', 'cta']) {
      expectKeyPresent(enMessages as MessageRecord, `landing.licenseTier.${key}.${sub}`, 'en');
      expectKeyPresent(plMessages as MessageRecord, `landing.licenseTier.${key}.${sub}`, 'pl');
    }
  });
});
```

- [ ] **Step 1.2: Run test — expect RED (module not found)**

```bash
bunx vitest run tests/unit/landing-fx/feature-keys.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/landing/feature-keys'".

- [ ] **Step 1.3: Create minimal `feature-keys.ts` to flip to RED-on-i18n (file exists, keys defined, translations still absent)**

`admin-panel/src/lib/landing/feature-keys.ts`:

```typescript
export const FEATURE_KEYS = [
  'dashboard',
  'payments',
  'subscriptions',
  'orderBumps',
  'oto',
  'embed',
  'checkoutTemplates',
  'coupons',
  'webhooks',
  'webhookRetry',
  'leads',
  'waitlist',
  'pwyw',
  'tipJar',
  'loginWall',
  'delivery',
  'omnibus',
  'saleLimits',
  'funnels',
  'refunds',
  'security',
  'gus',
  'magicLink',
  'mcp',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const USE_CASE_KEYS = ['courses', 'subscriptions', 'digital', 'leads'] as const;
export type UseCaseKey = (typeof USE_CASE_KEYS)[number];

export const TIER_KEYS = ['free', 'registered', 'pro', 'business'] as const;
export type TierKey = (typeof TIER_KEYS)[number];
```

- [ ] **Step 1.4: Run test — expect FAIL on missing keys (not module)**

```bash
bunx vitest run tests/unit/landing-fx/feature-keys.test.ts
```

Expected: FAIL with messages like `missing landing key "landing.features.oto.title" in en.json`. This is the desired RED state — the next task adds the keys.

- [ ] **Step 1.5: Commit (RED with explanation)**

```bash
git add admin-panel/src/lib/landing/feature-keys.ts admin-panel/tests/unit/landing-fx/feature-keys.test.ts
git -c commit.gpgsign=false commit -m "test(landing): add i18n drift guard for feature/tier/use-case keys

Test currently fails because new feature/tier translations don't exist yet.
Next commit adds the translations and flips the test to GREEN."
```

---

### Task 2: Add new landing translations (GREEN for Task 1)

**Files:**
- Modify: `admin-panel/src/messages/en.json`
- Modify: `admin-panel/src/messages/pl.json`

- [ ] **Step 2.1: Insert new keys under `landing.features` (both files), keeping existing entries**

Add to `en.json` under `landing.features` (after existing `gus`):

```json
"pwyw": {
  "title": "Pay what you want",
  "desc": "Let fans set their own price, with or without a minimum threshold. Higher conversion on lead magnets."
},
"tipJar": {
  "title": "Tip jar",
  "desc": "Add a tip step at checkout. Optional, never coercive — buyers stay in control."
},
"orderBumps": {
  "title": "Order bumps & OTO",
  "desc": "One-tick upsells before purchase plus dedicated one-time-offer pages after."
},
"oto": {
  "title": "One-time offer pages",
  "desc": "Post-purchase OTO with its own discount and analytics. Connect any product as the upsell."
},
"webhookRetry": {
  "title": "Webhook DLQ + retry",
  "desc": "Failed deliveries land in a dead-letter queue with exponential backoff and a one-click replay UI."
},
"loginWall": {
  "title": "Login wall snippet",
  "desc": "Drop one line on any page to gate it behind a Sellf sign-in + active-access check. No backend needed."
},
"magicLink": {
  "title": "Magic-link guest checkout",
  "desc": "Buyers purchase without an account. Their purchases auto-claim when they later register with the same email."
},
"mcp": {
  "title": "MCP server",
  "desc": "Connect Claude Desktop and other agents. 45 tools, 4 resources, 6 prompts. Drive your shop from a chat."
}
```

Polish equivalents in `pl.json` (mirroring positions):

```json
"pwyw": {
  "title": "Zapłać ile uważasz",
  "desc": "Klienci sami ustalają cenę, z minimalnym progiem albo bez. Większa konwersja na lead magnetach."
},
"tipJar": {
  "title": "Tip jar",
  "desc": "Opcjonalna podpowiedź napiwku w checkoucie. Nigdy przymusowa — kupujący decyduje."
},
"orderBumps": {
  "title": "Order bumpy i OTO",
  "desc": "Upsell jednym kliknięciem przed zakupem oraz dedykowane strony one-time-offer po zakupie."
},
"oto": {
  "title": "Strony one-time-offer",
  "desc": "Post-purchase OTO z własnym rabatem i analityką. Podpinasz dowolny produkt jako upsell."
},
"webhookRetry": {
  "title": "Webhooki DLQ + retry",
  "desc": "Nieudane delivery lądują w dead-letter queue z exponential backoff. Jeden klik i replay."
},
"loginWall": {
  "title": "Login wall (snippet)",
  "desc": "Jedna linijka na Twojej stronie — content gated za Sellf sign-in + sprawdzenie aktywnego dostępu. Bez backendu."
},
"magicLink": {
  "title": "Magic-link guest checkout",
  "desc": "Kupują bez konta. Zakupy auto-claim'ują się, gdy później założą konto na ten sam email."
},
"mcp": {
  "title": "MCP server",
  "desc": "Podłącz Claude Desktop i innych agentów. 45 narzędzi, 4 zasoby, 6 promptów. Sterujesz sklepem z czatu."
}
```

Also add `landing.licenseTier` block (both files):

```json
"licenseTier": {
  "title": "Pick the tier that fits where you are",
  "subtitle": "Free covers most solopreneurs. Pro removes branding and unlocks themes. Business adds white-label.",
  "categoryLabel": "License",
  "free": {
    "name": "Free",
    "tagline": "Solopreneurs starting out. No limits on products, sales, or buyers.",
    "cta": "Self-host now"
  },
  "registered": {
    "name": "Registered",
    "tagline": "Free + CSV export of payments. Register your install in 30 seconds.",
    "cta": "Register install"
  },
  "pro": {
    "name": "Pro",
    "tagline": "Hide \"Powered by Sellf\", save custom themes, expand API key scopes.",
    "cta": "Go Pro"
  },
  "business": {
    "name": "Business",
    "tagline": "White-label commercial license. Resell to your own clients.",
    "cta": "Talk to us"
  },
  "rows": {
    "products": "Unlimited products",
    "buyers": "Unlimited buyers",
    "payments": "Stripe + 26 currencies",
    "webhooks": "Webhooks + DLQ + retry",
    "csvExport": "Payment CSV export",
    "watermark": "Hide \"Powered by Sellf\"",
    "themes": "Save custom themes",
    "apiScopes": "Expanded API scopes",
    "whiteLabel": "White-label resale"
  }
}
```

Polish:

```json
"licenseTier": {
  "title": "Tier dopasowany do tego, gdzie jesteś",
  "subtitle": "Free starcza większości solopreneurów. Pro zdejmuje branding i odblokowuje motywy. Business dorzuca white-label.",
  "categoryLabel": "Licencja",
  "free": {
    "name": "Free",
    "tagline": "Solopreneurzy na starcie. Bez limitów na produkty, sprzedaż, kupujących.",
    "cta": "Self-host teraz"
  },
  "registered": {
    "name": "Registered",
    "tagline": "Free + CSV export płatności. Rejestracja instalacji w 30 sekund.",
    "cta": "Zarejestruj instalację"
  },
  "pro": {
    "name": "Pro",
    "tagline": "Ukryj \"Powered by Sellf\", zapisuj custom motywy, większe scope'y API.",
    "cta": "Wejdź na Pro"
  },
  "business": {
    "name": "Business",
    "tagline": "Licencja white-label. Sprzedawaj własnym klientom pod swoim brandem.",
    "cta": "Pogadajmy"
  },
  "rows": {
    "products": "Nielimitowane produkty",
    "buyers": "Nielimitowani kupujący",
    "payments": "Stripe + 26 walut",
    "webhooks": "Webhooki + DLQ + retry",
    "csvExport": "Eksport płatności do CSV",
    "watermark": "Ukrycie \"Powered by Sellf\"",
    "themes": "Zapis własnych motywów",
    "apiScopes": "Większe scope'y API",
    "whiteLabel": "Licencja white-label"
  }
}
```

Add `landing.embedDemo` block (both files):

```json
"embedDemo": {
  "categoryLabel": "Embed checkout",
  "title": "Paste one script. Checkout runs on your page.",
  "subtitle": "No iframe ceremony, no popup. The Stripe Embedded Checkout loads inside your existing HTML.",
  "snippetLabel": "snippet",
  "runButton": "Run snippet",
  "copyButton": "Copy",
  "copyDone": "Copied",
  "loading": "Loading checkout…",
  "shopBadge": "Demo shop",
  "productLabel": "Sample product",
  "productPrice": "$29.00",
  "payButton": "Pay (demo)",
  "demoNote": "This is a presentational mock. Real checkout flow is in the live demo."
}
```

Polish:

```json
"embedDemo": {
  "categoryLabel": "Embed checkout",
  "title": "Wklejasz 1 linijkę kodu. Checkout startuje na Twojej stronie.",
  "subtitle": "Bez ceremonii z iframe'ami, bez popupów. Stripe Embedded Checkout ładuje się w Twoim HTML.",
  "snippetLabel": "snippet",
  "runButton": "Uruchom snippet",
  "copyButton": "Kopiuj",
  "copyDone": "Skopiowane",
  "loading": "Ładowanie checkoutu…",
  "shopBadge": "Demo sklepu",
  "productLabel": "Przykładowy produkt",
  "productPrice": "129 zł",
  "payButton": "Zapłać (demo)",
  "demoNote": "To prezentacyjny mock. Prawdziwy flow jest w live demo."
}
```

Add 3 new FAQ entries to `landing.faq.items` arrays (both files, append):

EN:

```json
{
  "q": "What happens if a webhook fails?",
  "a": "Failed deliveries land in a dead-letter queue with exponential backoff. You see them in the dashboard and can replay any of them with one click."
},
{
  "q": "Can I drive Sellf from Claude / an AI agent?",
  "a": "Yes — Sellf ships an MCP server with 45 tools, 4 resources, and 6 prompts. Add it to Claude Desktop and ask it to list products, refund a payment, or pull analytics."
},
{
  "q": "Do you handle VAT / Polish JPK / OSS?",
  "a": "Sellf records the data and exports CSVs. You stay the Merchant of Record so you keep full control (and your data), and you grow into VAT / OSS handling on your own timeline."
}
```

PL:

```json
{
  "q": "Co się dzieje, jeśli webhook padnie?",
  "a": "Nieudane delivery lądują w dead-letter queue z exponential backoff. Widzisz je w panelu i jednym kliknięciem replay'ujesz dowolne."
},
{
  "q": "Czy mogę sterować Sellfem z Claude / agenta AI?",
  "a": "Tak — Sellf ma własny serwer MCP: 45 narzędzi, 4 zasoby, 6 promptów. Dodajesz do Claude Desktop i prosisz: wylistuj produkty, zrób refund, ściągnij analitykę."
},
{
  "q": "Co z VAT / JPK / OSS w Polsce?",
  "a": "Sellf zapisuje dane i eksportuje CSV. Pozostajesz Merchant of Record, więc masz pełną kontrolę (i swoje dane), a w VAT / OSS wchodzisz we własnym tempie."
}
```

- [ ] **Step 2.2: Run drift test — expect GREEN**

```bash
bunx vitest run tests/unit/landing-fx/feature-keys.test.ts
```

Expected: 24 + 4 + 4 = 32 cases pass (24 feature × 1 + 4 use-case × 1 + 4 tier × 1, but it.each parametrises each as separate test).

- [ ] **Step 2.3: Commit**

```bash
git add admin-panel/src/messages/en.json admin-panel/src/messages/pl.json
git -c commit.gpgsign=false commit -m "feat(landing): add i18n keys for PWYW, OTO, webhook retry, login wall, MCP, license tiers, embed demo"
```

---

### Task 3: `SELLF_GITHUB_URL` constant + LandingNav refactor (TDD)

**Files:**
- Modify: `admin-panel/src/lib/constants.ts`
- Modify: `admin-panel/src/app/[locale]/about/components/LandingNav.tsx`
- Create: `admin-panel/tests/unit/landing-fx/landing-constants.test.ts`

- [ ] **Step 3.1: Write failing test**

`admin-panel/tests/unit/landing-fx/landing-constants.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SELLF_GITHUB_URL } from '@/lib/constants';

describe('landing constants', () => {
  it('SELLF_GITHUB_URL points to the Sellf repo over https', () => {
    expect(SELLF_GITHUB_URL).toMatch(/^https:\/\/github\.com\/jurczykpawel\/sellf\/?$/);
  });
});
```

- [ ] **Step 3.2: Run — expect RED**

```bash
bunx vitest run tests/unit/landing-fx/landing-constants.test.ts
```

Expected: FAIL — export missing.

- [ ] **Step 3.3: Add constant**

In `admin-panel/src/lib/constants.ts`, append (at end of file, after existing constants):

```typescript
export const SELLF_GITHUB_URL = 'https://github.com/jurczykpawel/sellf';
```

- [ ] **Step 3.4: Run — expect GREEN**

```bash
bunx vitest run tests/unit/landing-fx/landing-constants.test.ts
```

- [ ] **Step 3.5: Refactor LandingNav to use the constant**

In `admin-panel/src/app/[locale]/about/components/LandingNav.tsx`, replace the hardcoded `https://github.com/jurczykpawel/sellf` strings (there are typically 2 — desktop + mobile menu) with the `SELLF_GITHUB_URL` import.

Add at top of file:

```typescript
import { SELLF_GITHUB_URL } from '@/lib/constants';
```

Replace every literal `'https://github.com/jurczykpawel/sellf'` with `SELLF_GITHUB_URL`. Use grep first to count occurrences:

```bash
grep -c "jurczykpawel/sellf" admin-panel/src/app/\[locale\]/about/components/LandingNav.tsx
```

Then `sed` or hand-edit to swap.

- [ ] **Step 3.6: Repeat the constant swap in any other landing component**

```bash
grep -rln "jurczykpawel/sellf" admin-panel/src/app/\[locale\]/about/
```

For each match, import `SELLF_GITHUB_URL` and replace. Components affected (verify): `LandingNav`, `LandingFooter`, `SelfHostedComparison`, `FinalCTA`, `TechStackGrid`, `FAQSection`, `HeroSection`.

- [ ] **Step 3.7: Verify**

```bash
bun run typecheck && bun run lint
```

Expected: both green.

- [ ] **Step 3.8: Commit**

```bash
git add admin-panel/src/lib/constants.ts admin-panel/tests/unit/landing-fx/landing-constants.test.ts admin-panel/src/app/\[locale\]/about/components/
git -c commit.gpgsign=false commit -m "refactor(landing): centralize SELLF_GITHUB_URL into lib/constants

Replaces hardcoded GitHub URLs across LandingNav and sibling sections."
```

---

### Task 4: `SnippetFlipCard` primitive (TDD)

**Files:**
- Create: `admin-panel/src/components/landing-fx/SnippetFlipCard.tsx`
- Create: `admin-panel/src/components/landing-fx/SnippetFlipCard.module.css`
- Create: `admin-panel/src/components/landing-fx/index.ts`
- Create: `admin-panel/tests/unit/landing-fx/SnippetFlipCard.test.tsx`

- [ ] **Step 4.1: Add unit test**

`admin-panel/tests/unit/landing-fx/SnippetFlipCard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SnippetFlipCard } from '@/components/landing-fx/SnippetFlipCard';

describe('<SnippetFlipCard>', () => {
  it('renders front face by default', () => {
    render(
      <SnippetFlipCard
        front={<div>FRONT</div>}
        snippet="echo hello"
        snippetLabel="bash"
      />,
    );
    expect(screen.getByText('FRONT')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('flips to back face on click and exposes the snippet via accessible name', () => {
    render(
      <SnippetFlipCard
        front={<div>FRONT</div>}
        snippet="echo hello"
        snippetLabel="bash"
      />,
    );
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('echo hello')).toBeVisible();
  });

  it('flips back on Escape key when focused', () => {
    render(
      <SnippetFlipCard
        front={<div>FRONT</div>}
        snippet="echo hello"
        snippetLabel="bash"
      />,
    );
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
```

If `@testing-library/react` is not yet a dep, add:

```bash
bun add -d @testing-library/react @testing-library/jest-dom jsdom
```

And ensure `vitest.config.ts` has `environment: 'jsdom'` and a setup file importing `@testing-library/jest-dom`. If the project already uses Vitest with React components (it does — there are component tests already), the setup is in place.

- [ ] **Step 4.2: Run — expect RED**

```bash
bunx vitest run tests/unit/landing-fx/SnippetFlipCard.test.tsx
```

Expected: module not found.

- [ ] **Step 4.3: Create primitive**

`admin-panel/src/components/landing-fx/SnippetFlipCard.tsx`:

```tsx
'use client';

import { useCallback, useState, type ReactNode, type KeyboardEvent } from 'react';
import styles from './SnippetFlipCard.module.css';

interface SnippetFlipCardProps {
  front: ReactNode;
  snippet: string;
  snippetLabel: string;
  className?: string;
}

export function SnippetFlipCard({ front, snippet, snippetLabel, className = '' }: SnippetFlipCardProps) {
  const [flipped, setFlipped] = useState(false);

  const toggle = useCallback(() => setFlipped((v) => !v), []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Escape' && flipped) {
        event.preventDefault();
        setFlipped(false);
      }
    },
    [flipped],
  );

  return (
    <button
      type="button"
      onClick={toggle}
      onKeyDown={onKeyDown}
      aria-expanded={flipped}
      data-flipped={flipped}
      className={`${styles.card} ${className}`}
    >
      <span className={styles.inner} data-flipped={flipped}>
        <span className={styles.face} aria-hidden={flipped}>
          {front}
        </span>
        <span className={styles.faceBack} aria-hidden={!flipped}>
          <span className={styles.snippetLabel}>{snippetLabel}</span>
          <code className={styles.snippet}>{snippet}</code>
        </span>
      </span>
    </button>
  );
}
```

`admin-panel/src/components/landing-fx/SnippetFlipCard.module.css`:

```css
.card {
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 0;
  perspective: 1000px;
  cursor: pointer;
  border-radius: 14px;
}

.inner {
  position: relative;
  display: block;
  transform-style: preserve-3d;
  transition: transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
  border-radius: inherit;
}

.inner[data-flipped='true'] {
  transform: rotateY(180deg);
}

.face,
.faceBack {
  position: relative;
  display: block;
  backface-visibility: hidden;
  border-radius: inherit;
}

.faceBack {
  position: absolute;
  inset: 0;
  transform: rotateY(180deg);
  background: var(--sf-bg-elevated, #0a0f1a);
  border: 1px solid var(--sf-border-accent, rgba(0, 120, 187, 0.35));
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.snippetLabel {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.7;
}

.snippet {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
}

@media (prefers-reduced-motion: reduce) {
  .inner {
    transition: opacity 200ms ease;
  }
  .inner[data-flipped='true'] {
    transform: none;
  }
  .inner[data-flipped='true'] .face {
    opacity: 0;
    pointer-events: none;
  }
  .inner[data-flipped='true'] .faceBack {
    transform: none;
    opacity: 1;
  }
  .inner[data-flipped='false'] .faceBack {
    opacity: 0;
  }
}
```

`admin-panel/src/components/landing-fx/index.ts`:

```typescript
export { SnippetFlipCard } from './SnippetFlipCard';
export { WebhookTimeline } from './WebhookTimeline';
```

(`WebhookTimeline` will be added in Task 5; barrel can predeclare — but TS will complain. Better: add `SnippetFlipCard` export only here and append later in Task 5.)

Replace the barrel content with just the SnippetFlipCard export for now:

```typescript
export { SnippetFlipCard } from './SnippetFlipCard';
```

- [ ] **Step 4.4: Run — expect GREEN**

```bash
bunx vitest run tests/unit/landing-fx/SnippetFlipCard.test.tsx
```

- [ ] **Step 4.5: Commit**

```bash
git add admin-panel/src/components/landing-fx/ admin-panel/tests/unit/landing-fx/SnippetFlipCard.test.tsx
git -c commit.gpgsign=false commit -m "feat(landing-fx): SnippetFlipCard primitive (flip-on-click code snippet face)"
```

---

### Task 5: `WebhookTimeline` primitive (TDD)

**Files:**
- Create: `admin-panel/src/components/landing-fx/WebhookTimeline.tsx`
- Modify: `admin-panel/src/components/landing-fx/index.ts`
- Create: `admin-panel/tests/unit/landing-fx/WebhookTimeline.test.tsx`

- [ ] **Step 5.1: Write test**

`admin-panel/tests/unit/landing-fx/WebhookTimeline.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WebhookTimeline } from '@/components/landing-fx/WebhookTimeline';

describe('<WebhookTimeline>', () => {
  it('renders three ticks with labels', () => {
    render(
      <WebhookTimeline
        ticks={[
          { label: 'stripe' },
          { label: 'sellf' },
          { label: 'your-webhook' },
        ]}
      />,
    );
    expect(screen.getByText('stripe')).toBeInTheDocument();
    expect(screen.getByText('sellf')).toBeInTheDocument();
    expect(screen.getByText('your-webhook')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /webhook step/i })).toHaveLength(3);
  });

  it('exposes a single landmark with descriptive role', () => {
    render(
      <WebhookTimeline
        ticks={[{ label: 'a' }, { label: 'b' }, { label: 'c' }]}
        ariaLabel="Webhook delivery flow"
      />,
    );
    expect(screen.getByRole('group', { name: /webhook delivery flow/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: Run — expect RED**

```bash
bunx vitest run tests/unit/landing-fx/WebhookTimeline.test.tsx
```

- [ ] **Step 5.3: Create the primitive**

`admin-panel/src/components/landing-fx/WebhookTimeline.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

interface Tick {
  label: string;
}

interface WebhookTimelineProps {
  ticks: Tick[];
  ariaLabel?: string;
  /** ms between consecutive ticks lighting up */
  step?: number;
  /** ms between loop replays once all ticks are lit */
  loopGap?: number;
}

export function WebhookTimeline({
  ticks,
  ariaLabel = 'Webhook timeline',
  step = 220,
  loopGap = 1800,
}: WebhookTimelineProps) {
  const [active, setActive] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inViewRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        inViewRef.current = entry.isIntersecting;
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setActive(ticks.length - 1);
      return;
    }

    let raf = 0;
    let timer: number | undefined;
    const playOnce = (i: number) => {
      if (!inViewRef.current) {
        timer = window.setTimeout(() => playOnce(i), 400);
        return;
      }
      if (i >= ticks.length) {
        timer = window.setTimeout(() => {
          setActive(-1);
          raf = window.requestAnimationFrame(() => playOnce(0));
        }, loopGap);
        return;
      }
      setActive(i);
      timer = window.setTimeout(() => playOnce(i + 1), step);
    };

    raf = window.requestAnimationFrame(() => playOnce(0));
    return () => {
      window.cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
    };
  }, [ticks.length, step, loopGap]);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={ariaLabel}
      className="flex items-center justify-between gap-3 w-full"
    >
      {ticks.map((tick, i) => {
        const lit = i <= active;
        return (
          <div key={tick.label} className="flex flex-col items-center gap-2 flex-1">
            <span
              role="img"
              aria-label={`webhook step ${i + 1}`}
              data-state={lit ? 'lit' : 'idle'}
              className={`block h-3 w-3 rounded-full transition-all duration-200 ${
                lit ? 'bg-sf-accent shadow-[0_0_12px_var(--sf-accent-glow)]' : 'bg-sf-muted/30'
              }`}
            />
            <span
              className={`text-xs font-mono ${
                lit ? 'text-sf-heading' : 'text-sf-muted'
              }`}
            >
              {tick.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

Update barrel `admin-panel/src/components/landing-fx/index.ts`:

```typescript
export { SnippetFlipCard } from './SnippetFlipCard';
export { WebhookTimeline } from './WebhookTimeline';
```

- [ ] **Step 5.4: Run — expect GREEN**

```bash
bunx vitest run tests/unit/landing-fx/WebhookTimeline.test.tsx
```

- [ ] **Step 5.5: Commit**

```bash
git add admin-panel/src/components/landing-fx/WebhookTimeline.tsx admin-panel/src/components/landing-fx/index.ts admin-panel/tests/unit/landing-fx/WebhookTimeline.test.tsx
git -c commit.gpgsign=false commit -m "feat(landing-fx): WebhookTimeline primitive (looped step lights)"
```

---

### Task 6: Section data attributes + LandingSection wrapper

This task adds `data-landing-section="<name>"` to every section's root for Playwright coverage. It is mechanical but each component needs the attribute.

**Files:**
- Modify: every component under `admin-panel/src/app/[locale]/about/components/`

- [ ] **Step 6.1: For each component file, add `data-landing-section="<name>"` to the outermost `<section>` (or wrap in a `<section>` if missing)**

Mapping:

| Component | data-landing-section value |
|-----------|----------------------------|
| HeroSection | `hero` |
| SocialProofBar | `social-proof` |
| FeeComparisonSection | `fee-comparison` |
| FeatureGrid | `features` |
| EmbedCheckoutDemo (new) | `embed-demo` |
| UseCases | `use-cases` |
| TaxSection | `tax` |
| HowItWorks | `how-it-works` |
| SelfHostedComparison | `self-hosted` |
| TechStackGrid | `tech-stack` |
| LicenseTier (new) | `license-tier` |
| FAQSection | `faq` |
| FinalCTA | `final-cta` |
| LandingFooter | (skip — it's a `<footer>` already) |
| LandingNav | (skip — it's a `<nav>` already) |

- [ ] **Step 6.2: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```

- [ ] **Step 6.3: Commit**

```bash
git add admin-panel/src/app/\[locale\]/about/components/
git -c commit.gpgsign=false commit -m "refactor(landing): add data-landing-section attributes for E2E coverage"
```

---

### Task 7: Hero — Revenue impact ticker (Sellf-fx #1)

**Files:**
- Modify: `admin-panel/src/app/[locale]/about/components/HeroSection.tsx`
- Modify: `admin-panel/src/messages/{en,pl}.json` (add `landing.hero.revenueBadge*` keys)

- [ ] **Step 7.1: Add i18n keys**

EN:

```json
"hero": {
  ...existing...,
  "revenueBadgeIdle": "What you keep vs Gumroad",
  "revenueBadgePrefix": "You'd save",
  "revenueBadgeSuffix": "/year vs Gumroad"
}
```

PL:

```json
"hero": {
  ...existing...,
  "revenueBadgeIdle": "Co zostaje vs Gumroad",
  "revenueBadgePrefix": "Zaoszczędzasz",
  "revenueBadgeSuffix": "/rok vs Gumroad"
}
```

- [ ] **Step 7.2: Implement the ticker**

In `HeroSection.tsx` (already `'use client'` or convert if currently server), add:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
// ...existing imports

const GUMROAD_RATE = 0.10; // 10% Gumroad fees as canonical comparator

function formatPLN(value: number): string {
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(value) + ' zł';
}

function RevenueBadge() {
  const t = useTranslations('landing.hero');
  const reduce = useReducedMotion();
  const [revenue, setRevenue] = useState<number | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ revenue: number }>).detail;
      if (detail && typeof detail.revenue === 'number') {
        setRevenue(detail.revenue);
      }
    };
    window.addEventListener('sellf:revenue-change', handler);
    return () => window.removeEventListener('sellf:revenue-change', handler);
  }, []);

  if (revenue === null || revenue <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-sf-muted">
        {t('revenueBadgeIdle')}
      </span>
    );
  }

  const annualSavings = Math.round(revenue * 12 * GUMROAD_RATE);
  return (
    <a
      href="#fee-comparison"
      data-revenue-badge="active"
      className={`inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-sf-heading bg-sf-accent-soft border border-sf-border-accent rounded-full px-3 py-1 ${
        reduce ? '' : 'transition-transform hover:scale-105'
      }`}
    >
      <span>{t('revenueBadgePrefix')}</span>
      <strong>{formatPLN(annualSavings)}</strong>
      <span>{t('revenueBadgeSuffix')}</span>
    </a>
  );
}
```

Render `<RevenueBadge />` immediately under the hero subtitle.

- [ ] **Step 7.3: Wire FeeComparisonSection to emit the event**

In `FeeComparisonSection.tsx` `useEffect` listening to `revenue` state changes, dispatch:

```typescript
useEffect(() => {
  window.dispatchEvent(
    new CustomEvent('sellf:revenue-change', { detail: { revenue } }),
  );
}, [revenue]);
```

- [ ] **Step 7.4: Verify in browser**

```bash
bun run dev
```

Open `http://localhost:3000/pl/about`. Move the FeeComparison slider. Watch the hero badge update with PLN saved.

- [ ] **Step 7.5: Commit**

```bash
git add admin-panel/src/app/\[locale\]/about/components/HeroSection.tsx admin-panel/src/app/\[locale\]/about/components/FeeComparisonSection.tsx admin-panel/src/messages/
git -c commit.gpgsign=false commit -m "feat(landing): revenue impact ticker in hero (Sellf-fx #1)

Hero badge subscribes to a CustomEvent dispatched by FeeComparisonSection's
slider. Updates with annual savings vs Gumroad as the user explores."
```

---

### Task 8: FeeComparison — Annual savings pulse (Sellf-fx #2)

**Files:**
- Modify: `admin-panel/src/app/[locale]/about/components/FeeComparisonSection.tsx`
- Modify: `admin-panel/src/app/globals.css`

- [ ] **Step 8.1: Add `@keyframes savings-pulse` and pulse class**

Append to `admin-panel/src/app/globals.css`:

```css
@keyframes savings-pulse {
  0%, 100% { transform: scale(1); }
  40% { transform: scale(1.06); }
}

.savings-pulse-active {
  animation: savings-pulse 320ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .savings-pulse-active {
    animation: none;
  }
}
```

- [ ] **Step 8.2: Detect threshold crossings in FeeComparisonSection**

```tsx
const PULSE_THRESHOLDS = [1000, 10000, 100000];
const lastBucketRef = useRef<number>(-1);
const savingsRef = useRef<HTMLSpanElement>(null);

useEffect(() => {
  const bucket = PULSE_THRESHOLDS.filter((t) => revenue >= t).length;
  if (bucket > lastBucketRef.current && savingsRef.current) {
    const node = savingsRef.current;
    node.classList.remove('savings-pulse-active');
    void node.offsetWidth;
    node.classList.add('savings-pulse-active');
    node.dataset.pulseState = 'pulsing';
    window.setTimeout(() => {
      node.dataset.pulseState = 'idle';
    }, 340);
  }
  lastBucketRef.current = bucket;
}, [revenue]);
```

Wrap the displayed "annual savings" number with `<span ref={savingsRef} data-pulse-state="idle">…</span>`.

- [ ] **Step 8.3: Manual verify in browser; then commit**

```bash
git add admin-panel/src/app/\[locale\]/about/components/FeeComparisonSection.tsx admin-panel/src/app/globals.css
git -c commit.gpgsign=false commit -m "feat(landing): savings pulse on slider threshold crossings (Sellf-fx #2)"
```

---

### Task 9: FeatureGrid — extend to 24 cards + flip integration (Sellf-fx #3)

**Files:**
- Modify: `admin-panel/src/app/[locale]/about/components/FeatureGrid.tsx`

- [ ] **Step 9.1: Replace inline list with `FEATURE_KEYS` driven render**

In `FeatureGrid.tsx`, build a config map `FEATURE_DETAILS: Record<FeatureKey, { icon: LucideIcon; snippet?: string; snippetLabel?: string }>`. Cards whose key has a `snippet` render inside `<SnippetFlipCard>`. Others render plain.

Example snippets (drawn from AGENTS.md):

```typescript
import { SELLF_GITHUB_URL } from '@/lib/constants';
import { SnippetFlipCard } from '@/components/landing-fx';
import {
  Webhook, CreditCard, Repeat, Zap, Code2, MessageSquare,
  Gift, ShieldCheck, Mail, Users, Banknote, HandCoins,
  Lock, Download, FileCheck2, Clock, Workflow, Undo2,
  ShieldAlert, Building2, Wand2, BotMessageSquare
} from 'lucide-react';

const FEATURE_DETAILS: Record<FeatureKey, {
  icon: typeof Webhook;
  snippet?: string;
  snippetLabel?: string;
}> = {
  dashboard: { icon: Code2 },
  payments: { icon: CreditCard, snippet: '26 currencies, Stripe Embedded Checkout', snippetLabel: 'capabilities' },
  subscriptions: { icon: Repeat },
  orderBumps: { icon: Gift },
  oto: { icon: Wand2 },
  embed: {
    icon: Code2,
    snippetLabel: 'html',
    snippet: '<script src="https://demo.sellf.app/embed/v1/checkout.js"\n        data-product="my-product-slug"></script>',
  },
  checkoutTemplates: { icon: FileCheck2 },
  coupons: { icon: ShieldCheck },
  webhooks: {
    icon: Webhook,
    snippetLabel: 'sample delivery',
    snippet: 'POST https://you.example.com/webhook/sellf\nX-Sellf-Signature: SHA256=...\n{ event: "purchase.completed", ... }',
  },
  webhookRetry: { icon: Undo2 },
  leads: { icon: Mail },
  waitlist: { icon: Users },
  pwyw: { icon: HandCoins },
  tipJar: { icon: Banknote },
  loginWall: {
    icon: Lock,
    snippetLabel: 'html',
    snippet: '<!-- Pasted on your own page -->\n<script>(function(){\n  var p="<product-uuid>";\n  if(window["_SF_LW_"+p])return;\n  location.replace("https://your-sellf/loginwall/protect?id="+p+"&redirect="+encodeURIComponent(location.href));\n})();</script>',
  },
  delivery: { icon: Download },
  omnibus: { icon: ShieldAlert },
  saleLimits: { icon: Clock },
  funnels: { icon: Workflow },
  refunds: { icon: Undo2 },
  security: { icon: ShieldCheck },
  gus: { icon: Building2, snippetLabel: 'auto-fill', snippet: 'NIP 1234567890 → firma, ulica, miasto, kod (GUS REGON)' },
  magicLink: { icon: Mail },
  mcp: {
    icon: BotMessageSquare,
    snippetLabel: 'claude',
    snippet: 'claude mcp add sellf -- npx -y @sellf/mcp-server\n# 45 tools, 4 resources, 6 prompts',
  },
};
```

Render loop:

```tsx
{FEATURE_KEYS.map((key) => {
  const Icon = FEATURE_DETAILS[key].icon;
  const snippet = FEATURE_DETAILS[key].snippet;
  const snippetLabel = FEATURE_DETAILS[key].snippetLabel ?? 'snippet';

  const front = (
    <div className="...existing card classes...">
      <Icon className="h-6 w-6 text-sf-accent" />
      <h3 className="text-lg font-bold text-sf-heading">{t(`features.${key}.title`)}</h3>
      <p className="text-sm text-sf-body">{t(`features.${key}.desc`)}</p>
    </div>
  );

  return snippet ? (
    <SnippetFlipCard
      key={key}
      front={front}
      snippet={snippet}
      snippetLabel={snippetLabel}
      className="block"
    />
  ) : (
    <div key={key} className="block">{front}</div>
  );
})}
```

- [ ] **Step 9.2: Verify counts**

```bash
bunx vitest run tests/unit/landing-fx/feature-keys.test.ts
```

All 24 features × (title + desc) = 48 assertions × 2 locales must pass.

- [ ] **Step 9.3: Manual browser verify**

`bun run dev` → `/pl/about#features` → hover/click feature cards, confirm flip on cards with snippets (webhooks, embed, login wall, GUS, MCP, payments).

- [ ] **Step 9.4: Commit**

```bash
git add admin-panel/src/app/\[locale\]/about/components/FeatureGrid.tsx
git -c commit.gpgsign=false commit -m "feat(landing): expand FeatureGrid to 24 cards w/ snippet flip (Sellf-fx #3)

Cards with code-revealing snippets: payments, embed, webhooks,
login wall, GUS REGON, MCP. Others render plain."
```

---

### Task 10: `EmbedCheckoutDemo` section (Sellf-fx #4)

**Files:**
- Create: `admin-panel/src/app/[locale]/about/components/EmbedCheckoutDemo.tsx`

- [ ] **Step 10.1: Implement the section**

`admin-panel/src/app/[locale]/about/components/EmbedCheckoutDemo.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, Check, Play } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';

const SNIPPET = `<script src="https://demo.sellf.app/embed/v1/checkout.js"
        data-product="my-product-slug"></script>`;

export function EmbedCheckoutDemo() {
  const t = useTranslations('landing.embedDemo');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'loaded'>('idle');
  const [copied, setCopied] = useState(false);

  const handleRun = () => {
    if (phase !== 'idle') return;
    setPhase('loading');
    window.setTimeout(() => setPhase('loaded'), 900);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(SNIPPET);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section data-landing-section="embed-demo" className="relative py-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal animation="fade-up" className="text-center mb-10">
          <span className="text-xs font-mono uppercase tracking-wider text-sf-muted">
            {t('categoryLabel')}
          </span>
          <h2 className="text-3xl md:text-4xl font-black text-sf-heading mt-2">
            {t('title')}
          </h2>
          <p className="text-sf-body mt-3 max-w-2xl mx-auto">{t('subtitle')}</p>
        </Reveal>

        <Reveal animation="fade-up" delay={100}>
          <div className="rounded-2xl border border-sf-border-accent bg-sf-bg-elevated overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-sf-border-accent bg-black/20">
              <span className="text-xs font-mono uppercase text-sf-muted">{t('snippetLabel')}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  data-action="copy-snippet"
                  className="inline-flex items-center gap-1 text-xs font-mono text-sf-body hover:text-sf-heading focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent rounded px-2 py-1"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? t('copyDone') : t('copyButton')}
                </button>
                <button
                  type="button"
                  onClick={handleRun}
                  data-action="run-snippet"
                  data-phase={phase}
                  disabled={phase !== 'idle'}
                  className="inline-flex items-center gap-1 text-xs font-mono text-sf-heading bg-sf-accent-soft border border-sf-border-accent rounded px-2 py-1 disabled:opacity-50"
                >
                  <Play className="h-3 w-3" /> {t('runButton')}
                </button>
              </div>
            </div>
            <pre className="p-4 text-sm font-mono text-sf-body whitespace-pre overflow-x-auto">
              {SNIPPET}
            </pre>

            <div className="p-6 border-t border-sf-border-accent" data-checkout-state={phase}>
              {phase === 'idle' && (
                <div className="text-center text-sf-muted text-sm py-10">
                  {t('demoNote')}
                </div>
              )}
              {phase === 'loading' && (
                <div className="space-y-3 animate-pulse">
                  <div className="h-4 bg-sf-muted/20 rounded w-1/3" />
                  <div className="h-10 bg-sf-muted/20 rounded" />
                  <div className="h-10 bg-sf-muted/20 rounded" />
                  <p className="text-xs text-sf-muted text-center">{t('loading')}</p>
                </div>
              )}
              {phase === 'loaded' && (
                <div className="space-y-3" data-checkout-skeleton="loaded">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono uppercase tracking-wider text-sf-muted">
                      {t('shopBadge')}
                    </span>
                    <span className="font-mono text-sf-muted">demo.sellf.app</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sf-heading font-semibold">{t('productLabel')}</span>
                    <span className="text-sf-heading font-mono">{t('productPrice')}</span>
                  </div>
                  <button
                    type="button"
                    disabled
                    className="w-full bg-sf-accent text-white rounded-lg py-3 font-bold opacity-90 cursor-not-allowed"
                  >
                    {t('payButton')}
                  </button>
                  <p className="text-[10px] text-sf-muted text-center">{t('demoNote')}</p>
                </div>
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
```

- [ ] **Step 10.2: Manual verify + commit**

```bash
git add admin-panel/src/app/\[locale\]/about/components/EmbedCheckoutDemo.tsx
git -c commit.gpgsign=false commit -m "feat(landing): EmbedCheckoutDemo section w/ paste-to-load animation (Sellf-fx #4)"
```

---

### Task 11: HowItWorks step-3 → WebhookTimeline (Sellf-fx #5)

**Files:**
- Modify: `admin-panel/src/app/[locale]/about/components/HowItWorks.tsx`

- [ ] **Step 11.1: Import + integrate**

In `HowItWorks.tsx`, replace the icon used for step 3 with `<WebhookTimeline>`:

```tsx
import { WebhookTimeline } from '@/components/landing-fx';

const stepThreeTicks = [
  { label: 'stripe' },
  { label: 'sellf' },
  { label: 'your n8n' },
];

// inside step 3's right column:
<div className="rounded-xl border border-sf-border-accent bg-sf-bg-elevated p-6">
  <WebhookTimeline ticks={stepThreeTicks} ariaLabel={t('step3.title')} />
</div>
```

Place under the step-3 description, keeping existing copy intact.

- [ ] **Step 11.2: Verify + commit**

```bash
git add admin-panel/src/app/\[locale\]/about/components/HowItWorks.tsx
git -c commit.gpgsign=false commit -m "feat(landing): WebhookTimeline integrated into HowItWorks step 3 (Sellf-fx #5)"
```

---

### Task 12: `LicenseTier` section + tier shimmer (Sellf-fx #6)

**Files:**
- Create: `admin-panel/src/app/[locale]/about/components/LicenseTier.tsx`
- Modify: `admin-panel/src/app/globals.css` (shimmer keyframe)

- [ ] **Step 12.1: Add shimmer CSS**

Append to `globals.css`:

```css
@keyframes tier-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.tier-shimmer {
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

.tier-shimmer::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    105deg,
    transparent 40%,
    var(--sf-accent-soft) 50%,
    transparent 60%
  );
  animation: tier-shimmer 3s linear infinite;
  z-index: 0;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .tier-shimmer::before {
    animation: none;
    background: var(--sf-accent-soft);
  }
}
```

- [ ] **Step 12.2: Create `LicenseTier.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Reveal } from '@/components/motion/Reveal';
import { TIER_KEYS, type TierKey } from '@/lib/landing/feature-keys';

type RowKey =
  | 'products' | 'buyers' | 'payments' | 'webhooks'
  | 'csvExport' | 'watermark' | 'themes' | 'apiScopes' | 'whiteLabel';

const ROW_KEYS: RowKey[] = [
  'products', 'buyers', 'payments', 'webhooks',
  'csvExport', 'watermark', 'themes', 'apiScopes', 'whiteLabel',
];

const MATRIX: Record<RowKey, Record<TierKey, boolean>> = {
  products:   { free: true,  registered: true,  pro: true,  business: true  },
  buyers:     { free: true,  registered: true,  pro: true,  business: true  },
  payments:   { free: true,  registered: true,  pro: true,  business: true  },
  webhooks:   { free: true,  registered: true,  pro: true,  business: true  },
  csvExport:  { free: false, registered: true,  pro: true,  business: true  },
  watermark:  { free: false, registered: false, pro: true,  business: true  },
  themes:     { free: false, registered: false, pro: true,  business: true  },
  apiScopes:  { free: false, registered: false, pro: true,  business: true  },
  whiteLabel: { free: false, registered: false, pro: false, business: true  },
};

export function LicenseTier() {
  const t = useTranslations('landing.licenseTier');

  return (
    <section data-landing-section="license-tier" className="relative py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal animation="fade-up" className="text-center mb-10">
          <span className="text-xs font-mono uppercase tracking-wider text-sf-muted">
            {t('categoryLabel')}
          </span>
          <h2 className="text-3xl md:text-4xl font-black text-sf-heading mt-2">
            {t('title')}
          </h2>
          <p className="text-sf-body mt-3 max-w-2xl mx-auto">{t('subtitle')}</p>
        </Reveal>

        <Reveal animation="fade-up" delay={100}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {TIER_KEYS.map((tier) => {
              const isPro = tier === 'pro';
              return (
                <div
                  key={tier}
                  data-tier={tier}
                  data-shimmer={isPro ? 'true' : 'false'}
                  className={`relative rounded-2xl border p-6 flex flex-col gap-3 bg-sf-bg-elevated ${
                    isPro
                      ? 'border-sf-accent tier-shimmer'
                      : 'border-sf-border-accent'
                  }`}
                >
                  <div className="relative z-10">
                    <span className="text-sm font-mono uppercase tracking-wider text-sf-muted">
                      {t(`${tier}.name`)}
                    </span>
                    <h3 className="text-2xl font-black text-sf-heading mt-1">{t(`${tier}.name`)}</h3>
                    <p className="text-sm text-sf-body mt-2 min-h-[5rem]">{t(`${tier}.tagline`)}</p>
                    <ul className="mt-4 space-y-2 text-sm">
                      {ROW_KEYS.map((row) => {
                        const has = MATRIX[row][tier];
                        return (
                          <li
                            key={row}
                            data-row={row}
                            data-included={has ? 'yes' : 'no'}
                            className={`flex items-center gap-2 ${
                              has ? 'text-sf-body' : 'text-sf-muted/50 line-through'
                            }`}
                          >
                            <Check
                              className={`h-3 w-3 shrink-0 ${
                                has ? 'text-sf-accent' : 'text-transparent'
                              }`}
                            />
                            <span>{t(`rows.${row}`)}</span>
                          </li>
                        );
                      })}
                    </ul>
                    <button
                      type="button"
                      className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-sf-accent text-white rounded-lg py-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent-hover"
                    >
                      {t(`${tier}.cta`)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
```

- [ ] **Step 12.3: Manual verify + commit**

```bash
git add admin-panel/src/app/\[locale\]/about/components/LicenseTier.tsx admin-panel/src/app/globals.css
git -c commit.gpgsign=false commit -m "feat(landing): LicenseTier section w/ Pro-column shimmer (Sellf-fx #6)"
```

---

### Task 13: Compose `/about` page with all sections

**Files:**
- Modify: `admin-panel/src/app/[locale]/about/page.tsx`

- [ ] **Step 13.1: Update imports + render order**

`admin-panel/src/app/[locale]/about/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { LandingNav } from './components/LandingNav';
import { HeroSection } from './components/HeroSection';
import { SocialProofBar } from './components/SocialProofBar';
import { FeeComparisonSection } from './components/FeeComparisonSection';
import { FeatureGrid } from './components/FeatureGrid';
import { EmbedCheckoutDemo } from './components/EmbedCheckoutDemo';
import { UseCases } from './components/UseCases';
import { TaxSection } from './components/TaxSection';
import { HowItWorks } from './components/HowItWorks';
import { SelfHostedComparison } from './components/SelfHostedComparison';
import { TechStackGrid } from './components/TechStackGrid';
import { LicenseTier } from './components/LicenseTier';
import { FAQSection } from './components/FAQSection';
import { FinalCTA } from './components/FinalCTA';
import { LandingFooter } from './components/LandingFooter';
import { buildLandingJsonLd } from './jsonld';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing' });
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://sellf.app';
  return {
    title: `Sellf — ${t('hero.headlineTop')} ${t('hero.headlineBottom')}`,
    description: t('hero.metaDescription'),
    alternates: { canonical: `${siteUrl}/${locale}/about` },
    openGraph: {
      title: `Sellf — ${t('hero.headlineTop')} ${t('hero.headlineBottom')}`,
      description: t('hero.metaDescription'),
      url: `${siteUrl}/${locale}/about`,
      locale,
      type: 'website',
      images: [{ url: `${siteUrl}/api/og/about?locale=${locale}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `Sellf — ${t('hero.headlineTop')} ${t('hero.headlineBottom')}`,
      description: t('hero.metaDescription'),
      images: [`${siteUrl}/api/og/about?locale=${locale}`],
    },
    robots: { index: true, follow: true, 'max-image-preview': 'large' },
  };
}

export default async function AboutPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const jsonLd = buildLandingJsonLd(locale);

  return (
    <div className="grain-overlay min-h-screen bg-sf-deep overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-sf-accent-bg focus:text-white focus:outline-none"
      >
        Skip to main content
      </a>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingNav />
      <main id="main-content">
        <HeroSection />
        <SocialProofBar />
        <FeeComparisonSection />
        <FeatureGrid />
        <EmbedCheckoutDemo />
        <UseCases />
        <TaxSection />
        <div className="section-divider" />
        <HowItWorks />
        <SelfHostedComparison />
        <TechStackGrid />
        <LicenseTier />
        <div className="section-divider" />
        <FAQSection />
        <FinalCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
```

> The `dangerouslySetInnerHTML` here passes a value built from a strictly-typed object inside `buildLandingJsonLd`. There is no user-supplied input — the function builds the JSON from constants and translated metadata only. AGENTS.md mandates against using `dangerouslySetInnerHTML` with user input; this case is constant, server-side, and security-reviewed.

- [ ] **Step 13.2: Create `jsonld.ts`**

`admin-panel/src/app/[locale]/about/jsonld.ts`:

```typescript
import { SELLF_GITHUB_URL } from '@/lib/constants';
import packageJson from '../../../../package.json' with { type: 'json' };

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sellf.app';

export function buildLandingJsonLd(locale: string) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Sellf',
      url: SITE_URL,
      logo: `${SITE_URL}/logo.svg`,
      sameAs: [SELLF_GITHUB_URL],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Sellf',
      url: SITE_URL,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${SITE_URL}/${locale}/store?q={query}`,
        'query-input': 'required name=query',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Sellf',
      operatingSystem: 'Linux, macOS, Windows (via Node.js)',
      applicationCategory: 'BusinessApplication',
      description:
        'Self-hosted digital product monetization platform. Zero platform fees, full data ownership, EU-compliant.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      softwareVersion: packageJson.version,
      sameAs: [SELLF_GITHUB_URL],
      image: `${SITE_URL}/api/og/about?locale=${locale}`,
    },
  ];
}
```

- [ ] **Step 13.3: Manual browser smoke**

```bash
bun run dev
```

Visit `http://localhost:3000/en/about` and `http://localhost:3000/pl/about`. Confirm all 14 sections render in the order in the spec (LicenseTier between TechStackGrid and FAQSection; EmbedCheckoutDemo between FeatureGrid and UseCases).

- [ ] **Step 13.4: Commit**

```bash
git add admin-panel/src/app/\[locale\]/about/page.tsx admin-panel/src/app/\[locale\]/about/jsonld.ts
git -c commit.gpgsign=false commit -m "feat(landing): compose /about with EmbedCheckoutDemo + LicenseTier + JSON-LD"
```

---

### Task 14: Refine remaining sections (UseCases, SelfHostedComparison, TechStackGrid, FAQSection, LandingFooter)

**Files:**
- Modify: `admin-panel/src/app/[locale]/about/components/UseCases.tsx`
- Modify: `admin-panel/src/app/[locale]/about/components/SelfHostedComparison.tsx`
- Modify: `admin-panel/src/app/[locale]/about/components/TechStackGrid.tsx`
- Modify: `admin-panel/src/app/[locale]/about/components/FAQSection.tsx`
- Modify: `admin-panel/src/app/[locale]/about/components/LandingFooter.tsx`
- Modify: `admin-panel/src/messages/{en,pl}.json` (use-cases copy refresh)

- [ ] **Step 14.1: Append PWYW / waitlist mentions in UseCases copy** in both i18n files. Example for `landing.useCases.digital.feature3`:

EN: `"Pay-what-you-want, tip jar, time-limited drops"`
PL: `"Zapłać ile uważasz, tip jar, edycje czasowe"`

- [ ] **Step 14.2: Append MCP bullet in `landing.selfHosted.production` keys** (extra line in the list).

EN: `"mcpReady": "MCP server (Claude Desktop integration)"`
PL: `"mcpReady": "Serwer MCP (integracja z Claude Desktop)"`

Render the new line inside `SelfHostedComparison.tsx`'s production block.

- [ ] **Step 14.3: Add MCP + Bun tiles in TechStackGrid**

In `landing.techStack`:

```json
"mcp": { "name": "MCP", "desc": "Claude Desktop integration via 45-tool MCP server" },
"bun": { "name": "Bun", "desc": "Runtime + package manager — faster dev cycles" }
```

Same in PL. Add the two tiles inside `TechStackGrid.tsx`.

- [ ] **Step 14.4: FAQSection already gets +3 entries from Task 2 i18n updates.** Verify they render — the section reads `t.raw('faq.items')` which means the new items appear automatically. No code change.

- [ ] **Step 14.5: LandingFooter — add llms.txt link** under Resources column:

```tsx
<a
  href="/llms.txt"
  className="..."
  rel="alternate"
  type="text/markdown"
>
  llms.txt
</a>
```

Add `landing.footer.llmsTxt` keys: EN `"llms.txt (for AI agents)"`, PL `"llms.txt (dla agentów AI)"`. Render via `{t('llmsTxt')}`.

- [ ] **Step 14.6: Verify typecheck + drift test + commit**

```bash
bun run typecheck
bunx vitest run tests/unit/landing-fx/
```

```bash
git add admin-panel/src/app/\[locale\]/about/components/ admin-panel/src/messages/
git -c commit.gpgsign=false commit -m "feat(landing): refresh UseCases/SelfHosted/TechStack/FAQ/Footer copy"
```

---

### Task 15: `robots.txt` + `llms.txt` + `sitemap.ts`

**Files:**
- Create: `admin-panel/public/robots.txt`
- Create: `admin-panel/public/llms.txt`
- Create: `admin-panel/src/app/sitemap.ts`

- [ ] **Step 15.1: robots.txt**

`admin-panel/public/robots.txt`:

```
User-agent: *
Allow: /
Content-Signal: search=yes, ai-input=yes, ai-train=no

# Block training-only crawlers
User-agent: CCBot
Disallow: /

User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: Meta-ExternalAgent
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: Amazonbot
Disallow: /

# Allow real-time answer crawlers (they cite with links)
User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

Sitemap: https://sellf.app/sitemap.xml
```

- [ ] **Step 15.2: llms.txt**

`admin-panel/public/llms.txt`:

```markdown
# Sellf

> Self-hosted digital product monetization platform. Open-source alternative to Gumroad / LemonSqueezy / Paddle. Zero platform fees, full data ownership, EU-compliant.

Built by Paweł Jurczyk (jurczykpawel@github). 17 years IT background. Open-source advocate.

## Products

- **Sellf** — Next.js + Supabase + Stripe, AGPL-3.0 + commercial white-label license. https://github.com/jurczykpawel/sellf

## Key features

- Stripe Embedded Checkout (26 currencies, magic-link guest checkout)
- Embed snippet — paste one `<script>` on any page to render checkout
- Login wall snippet — content gating via HMAC handoff token
- Webhooks with DLQ + retry + dashboard replay
- Pay-what-you-want, tip jar, order bumps, OTO pages, coupons (incl. OTO discount)
- License tiers: Free → Registered → Pro → Business (white-label)
- MCP server with 45 tools / 4 resources / 6 prompts for Claude Desktop
- Polish market integrations: GUS REGON auto-fill, VAT compliance, Omnibus Directive support

## Policy

Content-Signal: search=yes, ai-input=yes, ai-train=no
```

- [ ] **Step 15.3: sitemap.ts**

`admin-panel/src/app/sitemap.ts`:

```typescript
import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sellf.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/en/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/pl/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/en/store`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/pl/store`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
  ];
}
```

- [ ] **Step 15.4: Verify routes**

```bash
bun run dev
```

Visit:
- `http://localhost:3000/robots.txt` — should return the file
- `http://localhost:3000/llms.txt` — should return the markdown
- `http://localhost:3000/sitemap.xml` — should return the generated XML

- [ ] **Step 15.5: Commit**

```bash
git add admin-panel/public/robots.txt admin-panel/public/llms.txt admin-panel/src/app/sitemap.ts
git -c commit.gpgsign=false commit -m "feat(landing): agent-ready surface (robots Content-Signals, llms.txt, sitemap)"
```

---

### Task 16: OG image generator

**Files:**
- Create: `admin-panel/src/app/api/og/about/route.ts`

- [ ] **Step 16.1: Implement `next/og` image**

`admin-panel/src/app/api/og/about/route.ts`:

```typescript
import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') === 'pl' ? 'pl' : 'en';

  const headline = locale === 'pl'
    ? 'Sprzedawaj produkty cyfrowe bez prowizji'
    : 'Sell digital products without platform fees';
  const subhead = locale === 'pl'
    ? 'Self-hosted. AGPL. 0 PLN miesięcznie.'
    : 'Self-hosted. AGPL. $0 per month.';

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #050B16 0%, #0A1530 50%, #06223A 100%)',
          padding: '80px',
          color: '#FFFFFF',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 28, color: '#7FBEE0', letterSpacing: 4, marginBottom: 20 }}>
          SELLF
        </div>
        <div style={{ fontSize: 64, fontWeight: 900, lineHeight: 1.05, maxWidth: 1000 }}>
          {headline}
        </div>
        <div style={{ fontSize: 32, marginTop: 30, color: '#9FC9E8', maxWidth: 1000 }}>
          {subhead}
        </div>
        <div style={{ fontSize: 22, marginTop: 60, color: '#5B89A8' }}>sellf.app</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
```

- [ ] **Step 16.2: Verify**

```bash
bun run dev
```

Visit `http://localhost:3000/api/og/about` and `http://localhost:3000/api/og/about?locale=pl` — both should render PNG previews.

- [ ] **Step 16.3: Commit**

```bash
git add admin-panel/src/app/api/og/about/route.ts
git -c commit.gpgsign=false commit -m "feat(landing): OG image generator (next/og) with locale switching"
```

---

### Task 17: Playwright section-level E2E

**Files:**
- Create: `admin-panel/tests/landing-redesign.spec.ts`

- [ ] **Step 17.1: Write the suite**

```typescript
import { test, expect } from '@playwright/test';

const ABOUT_PATHS = ['/en/about', '/pl/about'];

const SECTIONS = [
  'hero',
  'social-proof',
  'fee-comparison',
  'features',
  'embed-demo',
  'use-cases',
  'tax',
  'how-it-works',
  'self-hosted',
  'tech-stack',
  'license-tier',
  'faq',
  'final-cta',
];

for (const path of ABOUT_PATHS) {
  test.describe(`landing redesign — ${path}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(path);
    });

    test('renders all 13 marked sections', async ({ page }) => {
      for (const name of SECTIONS) {
        const section = page.locator(`[data-landing-section="${name}"]`);
        await section.scrollIntoViewIfNeeded();
        await expect(section).toBeVisible();
      }
    });

    test('hero revenue badge updates after slider drag', async ({ page }) => {
      const badge = page.locator('[data-revenue-badge]').first();
      const slider = page.locator('[data-landing-section="fee-comparison"] input[type="range"]');
      await slider.scrollIntoViewIfNeeded();
      await slider.evaluate((el: HTMLInputElement) => {
        el.value = '15000';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.locator('[data-landing-section="hero"]').scrollIntoViewIfNeeded();
      await expect(badge).toHaveAttribute('data-revenue-badge', 'active');
    });

    test('feature snippet flip toggles aria-expanded', async ({ page }) => {
      const flipCards = page.locator('[data-landing-section="features"] button[aria-expanded]');
      await flipCards.first().scrollIntoViewIfNeeded();
      const first = flipCards.first();
      await expect(first).toHaveAttribute('aria-expanded', 'false');
      await first.click();
      await expect(first).toHaveAttribute('aria-expanded', 'true');
    });

    test('embed demo skeleton appears after Run click', async ({ page }) => {
      const section = page.locator('[data-landing-section="embed-demo"]');
      await section.scrollIntoViewIfNeeded();
      const runBtn = section.locator('[data-action="run-snippet"]');
      await runBtn.click();
      const skeleton = section.locator('[data-checkout-state="loaded"]');
      await expect(skeleton).toBeVisible({ timeout: 2000 });
    });

    test('embed copy button writes snippet to clipboard text', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const section = page.locator('[data-landing-section="embed-demo"]');
      await section.scrollIntoViewIfNeeded();
      await section.locator('[data-action="copy-snippet"]').click();
      const value = await page.evaluate(() => navigator.clipboard.readText());
      expect(value).toContain('embed/v1/checkout.js');
    });

    test('webhook timeline lights all ticks eventually', async ({ page }) => {
      const section = page.locator('[data-landing-section="how-it-works"]');
      await section.scrollIntoViewIfNeeded();
      const ticks = section.locator('[role="img"][aria-label*="webhook step"]');
      await expect(ticks).toHaveCount(3);
      await expect(ticks.nth(2)).toHaveAttribute('data-state', 'lit', { timeout: 3000 });
    });

    test('Pro license column has permanent shimmer flag', async ({ page }) => {
      const section = page.locator('[data-landing-section="license-tier"]');
      await section.scrollIntoViewIfNeeded();
      await expect(section.locator('[data-tier="pro"]')).toHaveAttribute('data-shimmer', 'true');
    });

    test('FAQ accordion expands on click', async ({ page }) => {
      const faq = page.locator('[data-landing-section="faq"]');
      await faq.scrollIntoViewIfNeeded();
      const firstButton = faq.locator('button').first();
      await firstButton.click();
      await expect(firstButton).toHaveAttribute('aria-expanded', 'true');
    });
  });
}
```

- [ ] **Step 17.2: Run the suite**

```bash
bunx playwright test tests/landing-redesign.spec.ts --project=chromium
```

Fix anything that doesn't pass; do NOT relax assertions.

- [ ] **Step 17.3: Commit**

```bash
git add admin-panel/tests/landing-redesign.spec.ts
git -c commit.gpgsign=false commit -m "test(landing): section-level E2E suite (Playwright)"
```

---

### Task 18: Playwright a11y suite

**Files:**
- Create: `admin-panel/tests/landing-redesign-a11y.spec.ts`

- [ ] **Step 18.1: Write the suite**

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const path of ['/en/about', '/pl/about']) {
  test.describe(`a11y — ${path}`, () => {
    test('no axe violations at WCAG 2.1 AA', async ({ page }) => {
      await page.goto(path);
      // Let any deferred reveal animations settle
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });

    test('Skip link focuses #main-content on activation', async ({ page }) => {
      await page.goto(path);
      await page.keyboard.press('Tab');
      const skipLink = page.locator('a[href="#main-content"]');
      await expect(skipLink).toBeFocused();
      await page.keyboard.press('Enter');
      const main = page.locator('#main-content');
      await expect(main).toBeVisible();
    });

    test('prefers-reduced-motion disables snippet flip transform', async ({ browser }) => {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(path);
      const card = page.locator('[data-landing-section="features"] button[aria-expanded]').first();
      await card.scrollIntoViewIfNeeded();
      await card.click();
      const innerTransform = await card.locator('span[data-flipped="true"]').first().evaluate(
        (el) => window.getComputedStyle(el).transform,
      );
      expect(innerTransform).toMatch(/none|matrix\(1,\s*0,\s*0,\s*1/);
      await context.close();
    });
  });
}
```

- [ ] **Step 18.2: Run + fix any axe violations**

```bash
bunx playwright test tests/landing-redesign-a11y.spec.ts --project=chromium
```

Typical fixes you may need:

- Add `aria-label` to range slider in FeeComparisonSection
- Ensure each section's heading uses an `<h2>` (FeatureGrid uses `<h3>` for cards — that's fine; section heading must be `<h2>`)
- Verify contrast ratios — if any `text-sf-muted` text on `var(--sf-bg-elevated)` falls below 4.5:1, adjust the token

- [ ] **Step 18.3: Commit**

```bash
git add admin-panel/tests/landing-redesign-a11y.spec.ts admin-panel/src/app/\[locale\]/about/
git -c commit.gpgsign=false commit -m "test(landing): WCAG 2.1 AA axe suite + reduced-motion verification"
```

---

### Task 19: Visual baseline

**Files:**
- Create: `admin-panel/tests/landing-redesign-visual.spec.ts`

- [ ] **Step 19.1: Write visual suite**

```typescript
import { test, expect } from '@playwright/test';

test.describe('landing visual baseline', () => {
  for (const path of ['/en/about', '/pl/about']) {
    test(`snapshot ${path}`, async ({ page }) => {
      await page.addInitScript(() => {
        document.documentElement.classList.add('motion-paused');
      });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // Disable animations globally for stable snapshot
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
          }
        `,
      });
      await expect(page).toHaveScreenshot({ fullPage: true, maxDiffPixelRatio: 0.02 });
    });
  }
});
```

- [ ] **Step 19.2: Generate baseline**

```bash
bunx playwright test tests/landing-redesign-visual.spec.ts --update-snapshots --project=visual-laptop
```

Repeat per project: `visual-mobile`, `visual-tablet`, `visual-wide`. Snapshots commit-controlled.

- [ ] **Step 19.3: Verify subsequent runs are deterministic**

```bash
bunx playwright test tests/landing-redesign-visual.spec.ts --project=visual-laptop
```

Expected: pass.

- [ ] **Step 19.4: Commit**

```bash
git add admin-panel/tests/landing-redesign-visual.spec.ts admin-panel/tests/landing-redesign-visual.spec.ts-snapshots/
git -c commit.gpgsign=false commit -m "test(landing): visual baseline snapshots (laptop/tablet/mobile/wide)"
```

---

### Task 20: Final verification

- [ ] **Step 20.1: Full unit suite**

```bash
cd admin-panel && bun run test:unit
```

Expected: 0 fail.

- [ ] **Step 20.2: Typecheck + lint + build**

```bash
bun run typecheck
bun run lint
bun run build
```

Expected: all green. The build must not warn about missing translation keys or unused imports.

- [ ] **Step 20.3: All Playwright E2E + smoke**

```bash
bun run test
```

Expected: 0 fail. Existing `smart-landing.spec.ts`, `cookieconsent-integration.spec.ts`, `storefront-landing.spec.ts` keep passing.

- [ ] **Step 20.4: Lighthouse a11y manual check**

In Chrome DevTools → Lighthouse → Accessibility only → run for `/en/about` and `/pl/about`. Each must score ≥ 95. Address any reported issues; re-run.

- [ ] **Step 20.5: Push branch**

```bash
git push -u origin feat/landing-redesign
```

- [ ] **Step 20.6: Open PR**

```bash
gh pr create --title "feat(landing): redesign /about with 6 Sellf-specific microinteractions" --body "$(cat <<'EOF'
## Summary

- Two new sections: EmbedCheckoutDemo, LicenseTier
- Six Sellf-specific microinteractions tied 1:1 to product features
- FeatureGrid extended from 17 → 24 cards (PWYW, Tip Jar, OTO, Webhook Retry, Login Wall, Magic Link, MCP)
- Agent-ready surface: robots Content-Signals, llms.txt, sitemap.ts, JSON-LD x3, OG image at /api/og/about
- WCAG 2.1 AA verified by @axe-core/playwright; reduced-motion respected

## Spec & Plan

- Spec: `docs/superpowers/specs/2026-05-24-sellf-landing-redesign-design.md`
- Plan: `docs/superpowers/plans/2026-05-24-sellf-landing-redesign.md`

## Test plan

- [ ] `bun run test:unit` green
- [ ] `bun run typecheck` green
- [ ] `bun run lint` green
- [ ] `bun run build` green
- [ ] `bun run test` (Playwright) green
- [ ] Lighthouse a11y ≥ 95 on /en/about and /pl/about
- [ ] Manual: revenue ticker updates as slider drags
- [ ] Manual: snippet flip on feature cards
- [ ] Manual: embed demo paste-to-load
- [ ] Manual: reduced-motion disables flips and shimmer
EOF
)"
```

- [ ] **Step 20.7: Confirm PR shows green CI**

```bash
gh pr checks --watch
```

---

## Self-review checklist (post-write)

- **Spec coverage:** ✓ all 14 spec sections map to tasks. Acceptance criteria checked off by Task 20.
- **Placeholder scan:** no "TBD"/"TODO"/"implement later". Every code block is concrete. Tests show exact assertion text.
- **Type consistency:** `FeatureKey`, `UseCaseKey`, `TierKey` defined once in `feature-keys.ts`, used everywhere. `SnippetFlipCard` API stable across Tasks 4, 9. `WebhookTimeline` API stable across Tasks 5, 11.
- **Cross-task references:** Tasks 7, 11, 14 reference earlier-defined primitives by exact import path.
- **Frequent commits:** every task ends with a commit, no large multi-feature blobs.

---

**Implementation order is mandatory.** Tasks 0–6 produce no user-visible change; Tasks 7–14 produce visible changes; Tasks 15–16 add infrastructure; Tasks 17–20 verify everything. Each task is independently revertible.
