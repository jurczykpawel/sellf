# API and rendered evidence

Use HTTPS for remote Sellf, loopback HTTP for a disposable local instance.
HTTP works with only origin + key; no MCP installation or source access is required.
Send `Authorization: Bearer <key>` or `X-API-Key: <key>` and JSON content type.
MCP uses `SELLF_API_URL` (origin), `SELLF_API_KEY`; its `templates_*` tools return
identical top-level API JSON as text and structured content, not a `data` wrapper.
Do not print the key or turn on shell tracing. Files for candidate/evidence belong
in a private temporary directory outside the application checkout.

All paths below start `/api/v1/templates/`. Scopes are independent, not hierarchical;
each key must belong to the instance admin. Product-write grants no template scope.

| Tool | Method/path | Body | Scope |
|---|---|---|---|
| templates_capabilities | GET capabilities | none | templates:read |
| templates_read | GET config | none | templates:read |
| templates_validate | POST validate | `{config,mode:"draft"}` or `"publish"` | templates:read |
| templates_draft | PUT draft | `{expectedRevision,config}` | templates:write |
| templates_preview | POST preview | `{revision,locale:"en",fixture:"standard"}` | templates:read |
| templates_diff | POST diff | `{fromRevision,toRevision}` | templates:read |
| templates_publish | POST publish | `{expectedRevision}` | templates:activate |
| templates_rollback | POST rollback | `{expectedRevision,targetRevision}` | templates:activate |
| templates_reset | POST reset | `{expectedRevision,templateId,field}` | templates:write |

Capabilities expose `templates` (complete registry entries/recipes), `schemas`,
`slots`, `coreSettings`, `resetPaths`, `limits`. Config reads include `revision`,
`draft`, `published`, `rights`, `effectiveTemplateId`, validation, `effectiveTokens` and `unusedSlots`.
`rights.canPublish[]` gives `{templateId,allowed,reason}` for every registered template
using the current draft (or published) content/settings/tokens. `reason` is null,
`ENTITLEMENT` (including missing Pro), or `CUSTOMIZATION` (layout/token rights).
This checks rights only: publish still checks revision, validation and live bindings.
Mutation returns `revision` and validation. Diff contains sorted JSON Pointer changes
and unused slots. Keep all warnings. Revisions are exact safe nonnegative integers.
Typical clean stack: read0 → draft1 → validate → preview1 → diff0/1 → publish2 →
rollback(target0,expected2)3. Always use actual returned revisions.

Config input and stored JSON each have a 102400-byte UTF-8 limit; request envelope
131072 bytes; depth 12. Partial settings are retained per template, tokens are partial
schema-approved values. Empty `hidden`/`variants` and template map entries are optional;
omit them when unused. Empty `default: {}` entries do not produce diff noise.
Order is a permutation of current section IDs; catalogue stays visible. There is no API for uploading arbitrary recipes/components.

To validate a saved revision, GET `config`, require its `revision` to equal the
saved revision, then POST `validate` with exactly `{ "config": <returned draft>,
"mode": "publish" }`. There is no revision-only validate endpoint. Abort/reconcile
if the draft is null or revision changed; publish independently revalidates it.

Token defaults come from `capabilities.templates[].tokens` (D includes greens);
`config.effectiveTokens` shows resolved core/template/seller values and origins.
There is no separate approved colour list: schema permits six-digit hex colours,
then publish checks resolved light/dark contrast. Text/accent against background
and muted surfaces, and action labels against accent, need 4.5:1; borders need 3:1.
Use registry defaults without redundant overrides unless a change is requested.
Partial content is valid; `CONTENT_MISSING` warns about visible slots with no copy
in either locale, independently of `TRANSLATION_FALLBACK` for a missing translation.

Errors always include `code,message,validation,currentRevision`: message names the
operation; validation is a ValidationResult or null; currentRevision is a number
for a known revision conflict, otherwise null. For example a preview 429 is
`{"code":"RATE_LIMITED","message":"Storefront preview could not be completed","validation":null,"currentRevision":null}`.
Statuses: 401 unauthenticated, 403 scope/
admin/rights, 404 missing fixture/history, 409 conflict, 422 invalid/limit, 429 rate
limit, 503 unavailable. Preview preparation permits 120 calls per minute per admin,
shared by preview POSTs and page navigations; a 5-fixture × 2-locale matrix plus
40 colour/viewport navigations fits. HTTP/read limits are also 120/minute per admin;
API-key verification has its own shared request budget, so other traffic can throttle
earlier. Every template API 429 includes `Retry-After: 60` seconds (a conservative
full-window wait, not a precise reset timestamp). Pause before retrying preview;
never automatically retry mutations. Fix validation by pointer; reconcile 409;
surface unavailable/denied operations without alternate access.

## Preview

POST returns `revision,locale,fixture,expiresAt,validation,effectiveTokens,unusedSlots,
previewPath`. Resolve the relative path against the configured origin, rejecting
other origins. Open it with the READ header on **every navigation**, empty cookies,
scripts disabled, no service workers. Inject headers only for that origin's preview
navigation, never off-origin requests. Do not put credentials in HTML or localStorage.
Allow same-origin Next CSS/bundled fonts and approved existing public media only;
abort other traffic. Preserve the server's script-blocking CSP. Do not extract or
rebuild HTML/CSS; this is a dynamic page, not a portable snapshot.

Assert page HTTP 200, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex,
nofollow`, correct `html lang`, `[data-preview-inert][inert]`, no key in HTML/path,
no executed scripts, payments/auth/grants/experiments requests or off-origin traffic.
Save private screenshots and inspect them, not just status codes.

Request each fixture in EN/PL. Light/dark is a client colour scheme
(`page.emulateMedia`), not a preview parameter; reuse the same path across schemes
and widths. Inspect light/dark × 1440/390 for `standard`, plus `empty`, `long`,
`unavailable` and `published-products`. Standard covers synthetic free, paid,
subscription and PWYW with absent media. Synthetic UUIDs differ from live bindings;
`published-products` is the authoritative visual binding check. Inspect 320/768,
200% zoom, reduced motion and long seller copy; check overflow, heading order,
contrast and protected notices. Large catalogue pagination and keyboard/filter/FAQ
behavior need the core fixture harness; an inert preview cannot prove interactions.
Do not invent a `large` fixture or claim a full a11y pass from screenshots.

`issuedAt` in the path is Unix epoch milliseconds; `expiresAt` is ISO-8601 UTC
(the trailing `Z` means UTC), exactly issuedAt + 10 minutes. Keep the returned
query intact. Each navigation verifies the READ key/admin again and checks that
the draft revision still matches and the lease has not expired; the path alone
grants no access. Any mutation invalidates the revision. After mutation/expiry,
POST a fresh preview and replace evidence before publishing. Anonymous/wrong-scope
pages are denied (404); stale preview POST is 409. A stale/expired page shows an
unavailable message with no inert composition, so HTTP 200 alone is insufficient.
Always quote a shell URL containing `previewPath`, e.g. `"${SELLF_API_URL}${previewPath}"`:
unquoted `&` splits shell commands. Never reconstruct or drop its query parameters.

Minimal Playwright example (save as `.mjs` in a private folder with Playwright
available; provide origin, key, returned path and private screenshot path as env):

```js
import { chromium } from 'playwright';
const origin = new URL(process.env.SELLF_API_URL).origin;
const target = new URL(process.env.PREVIEW_PATH, origin);
if (target.origin !== origin || !target.pathname.startsWith('/template-preview/')) throw new Error('Invalid preview path');
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin && url.pathname.startsWith('/template-preview/') && request.isNavigationRequest() && !request.frame().parentFrame()) {
      const response = await route.fetch({ maxRedirects: 0, headers: { ...request.headers(), authorization: `Bearer ${process.env.SELLF_API_KEY}` } });
      await route.fulfill({ response });
    } else if (url.origin === origin && url.pathname.startsWith('/_next/static/') && ['stylesheet', 'font'].includes(request.resourceType())) {
      await route.continue();
    } else await route.abort(); // Add only explicitly approved public media if needed.
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const response = await page.goto(target.href);
  if (response?.status() !== 200 || await page.locator('[data-preview-inert][inert]').count() !== 1) throw new Error('Preview unavailable');
  await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
} finally { await browser.close(); }
```

The fresh context has empty cookies. Headers are attached only to same-origin main
preview navigations, never globally; redirects to other origins are aborted. JS off
keeps Next CSS/fonts. Repeat with each locale/fixture path and client scheme/width;
apply the header/lang/key-absence checks above and inspect the screenshots.
