# Storefront performance acceptance

Run from `admin-panel` with Bun 1.3.14, Node, Docker, the Supabase CLI and Playwright Chromium installed. The test exits nonzero if any case misses p75 LCP 2500ms, CLS .1 or scripted INP 200ms, any measurement is absent, or 100k catalogue reads scan more than 250 product/history/category rows. Tiny 1k relations may legitimately use sequential scans; their plans are retained too. It collects all 144 browser cases (720 navigations) before evaluating the vitals gates. There are no retries or discarded outliers.

Prepare a disposable `/private/tmp/sellf-perf/supabase` copy of the repository's `supabase/` directory (exclude `.temp`/`.branches`). In **that copy only**, change `project_id` to `sellf-perf`, replace ports `54320–54329` with `55320–55329`, and disable the GitHub OAuth provider. Then:

```sh
supabase start --workdir /private/tmp/sellf-perf
supabase db reset --workdir /private/tmp/sellf-perf
docker restart supabase_kong_sellf-perf
/tmp/bun-1314/bun-darwin-aarch64/bun scripts/storefront-perf.mjs /private/tmp/storefront-perf-results
supabase stop --no-backup --workdir /private/tmp/sellf-perf
```

The runner verifies the exact API/container identity before any writes; it never operates another stack. Its fixture replaces products and related data, and publishes synthetic default/D settings directly in the disposable database. The app runs at `http://sellf-perf.localhost:55325` (Chromium loopback resolution, no hosts-file changes). D uses a temporary, locally signed Pro credential bound to that valid dotted hostname through the supported fallback-key configuration. No credential is saved in results. `.env.local` supplies **test-mode** Stripe keys only; the runner asserts their prefixes. Checkout entry can create test sessions, but never submits a payment, email or access request. Stop the stack and remove its copy after the run. The runner always stops its own Node/browser processes. It builds the production standalone app once, copies static/public assets, and preserves `.env.local`. `--skip-build` reuses that build during affected reruns; do not reuse after application changes.

Datasets: exactly 1,000 and 100,000 active/listed one-time products, sparse featured/free groups, complete reporting-category membership, three tied microsecond timestamps, canonical names, bounded descriptions/marketing, and one initial price-history row per product. The fixture batches initial price history while temporarily disabling just its per-product trigger within a transaction, retaining all CHECK constraints and restoring the trigger before commit. Ingestion is outside measurements. No seller image/demo/testimonial or tracking service is invented; image frames use the core static fallback. This profile measures synthetic content, not arbitrary seller media or production capacity.

Mobile: Chromium, 390×844, DPR 2/touch, 4× CDP CPU slowdown. Network matches the current [DevTools Fast 4G preset](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/core/sdk/NetworkManager.ts): 9Mbps down/1.5Mbps up with .9 bandwidth adjustment, target RTT 60ms (CDP latency 165ms). Desktop: 1440×1000, DPR 1, no CPU/network throttle. The exact browser, CPU/core count, RAM, macOS, Node, Bun, Next and Postgres versions are written to `profile.json`. Before every fixture/query batch and navigation the runner waits for the one-minute host load to be **strictly below 8**; `load.json` retains each admitted load. Do not run other builds/tests during measurement.

Each size/template/device/path case has five pairs. Cold: new browser context (empty HTTP cache), fresh standalone Node process, and removal of that process's actual `.next/cache`; DB/OS buffers remain warm. Warm: the same browser context and Node process revisit the same URL after the mandatory load check; normal public-data TTLs remain active. Readiness checks only the listening TCP socket; the measured navigation is the fresh process's first HTTP request. Routes are `/`, `/store`, `/pl`, `/p/perf-course-1`, `/checkout/perf-course-1`, `/p/perf-course-11`, `/checkout/perf-course-11` for both default/D. Catalogue interactions focus/type/submit search and await its real response; purchase entry waits for its email input and types a synthetic address without submitting. Cold visits dismiss the visible consent dialog with its real localized Reject all control before the remaining interactions; warm visits retain that necessary-only preference. INP is the observed scripted journey, not a field-population estimate or a TBT substitute.

Metrics use Next's pinned [reference web-vitals implementation](https://github.com/GoogleChrome/web-vitals) injected into the acceptance browser only, with `reportAllChanges`. The scripted observation window ends after interactions, two animation frames, font readiness and an idle callback (matching the reference INP observer's idle processing). The runner reads metrics before navigation destroys the document. p75 uses nearest rank (fourth of five), with no rounding before assertions. TTFB is navigation responseStart. CDP encoded transfer bytes include headers and are grouped by resource type; browser cache hits report their actual transfer. `pg_stat_statements` counters record query calls/rows/time/buffers per journey, separately from nested `auto_explain` ANALYZE/BUFFERS plans and their scan-row assertions. Screenshots cover EN/PL at 390/1440. All raw samples and plans remain alongside `summary.json`; a failing run is never an acceptance pass.

`--probe-checkout --skip-build` (or `--probe-free --skip-build`) runs five cold/warm pairs for the paid (or free) entry on the mobile 1k/default fixture. It applies the same vitals assertions and explicitly reports a diagnostic result; it cannot report full acceptance. `--sql-only` runs scan assertions against the loaded 100k performance fixture; add `--original-fixture` for the `Catalogue fixture` dataset used by `storefront-catalogue.sql`.

`--probe-d --skip-build` applies the same assertions to five mobile cold/warm D storefront pairs before a full run. Every storefront navigation asserts its actual rendered template, so a license fallback cannot supply D measurements.

The default matrix also includes empty search results and unavailable persistent-cache storage for both sizes/templates/devices/temperatures. Empty cases assert zero catalogue cards. Failed-cache cases replace only the owned standalone `.next/cache` directory with a regular file, assert actual `ENOTDIR` errors and continued card rendering, and verify the fault remains present. Process memory stays available; the fault targets disk-backed caching. Cleanup removes the injected file. `--probe-cache --skip-build` checks five cold/warm mobile pairs, while `--cache-cases --skip-build` runs only the 32 cache/empty cases; the default 144-case run is required for full acceptance.

## Phase 2 acceptance

`--phase2 --skip-build` uses the owned `sellf-t219` project in
`/private/tmp/sellf-t219`, API 55441, database 55442 and app 55445. Prepare that
copy as above with ports 55440–55449. Reuse the final production build only when
application sources have not changed. All original Q5 device, network, five-pair,
cold/warm, load <8, quantile and metric gates remain unchanged.

The matrix is 152 cases / 760 navigations: A/B/C each render `/`, `/store`, `/pl`,
empty search and unavailable persistent cache; offer-default renders paid/free
offers in EN/PL. Both catalogue sizes, devices and temperatures apply to every
route. Actual rendered template identity is asserted. Offers exercise the real
FAQ disclosure; catalogue journeys use real search. Offer queries are included
in per-navigation counters. Screenshots use `/tmp/t2-19-*.png`.

A/B/C use the existing bilingual reference-copy fixture remapped to actual
benchmark products and one category; optional seller media are omitted. Each
has a separate locally signed, encrypted credential and pinned product/template/
host policy. A narrowly scoped Node preload supplies the deterministic empty
revocation response at `https://example.com/t219-revoked`; credential decryption,
signature, policy, status recording, refresh and public rights resolution are
unchanged. This fixture removes external issuer availability from the performance
profile; outage, expiry and rollback behavior belong to the rights test matrix.
No credential or encryption key is written to evidence.

Before performance, `template-persistence.mjs` provides destructive acceptance
on an explicitly named owned `sellf-t*` stack; it refuses the shared project and
verifies its API/container pairing:

```sh
TEMPLATE_TEST_STACK=/private/tmp/sellf-t219 bun scripts/template-persistence.mjs prepare
# Replace/restart the application image, retaining APP_ENCRYPTION_KEY.
TEMPLATE_TEST_STACK=/private/tmp/sellf-t219 bun scripts/template-persistence.mjs verify
TEMPLATE_TEST_STACK=/private/tmp/sellf-t219 bun scripts/template-persistence.mjs restore
TEMPLATE_TEST_STACK=/private/tmp/sellf-t219 bun scripts/template-persistence.mjs cleanup
```

Preparation creates A/B/C publication history, a separate draft, independent
encrypted credentials, a scoped API key and distinct product-offer draft/history.
The private custom-format public-schema data dump is restored over emptied tables
using the disposable stack's `supabase_admin` role for constraint triggers. Auth
identities, schema/migrations and the operator encryption key remain in place.
Verification compares exact table hashes/counts and decrypts all three retained
credentials. Logs contain only digests; cleanup removes the private dump. This is
a presentation-data restore check, not a substitute for an operator's full Auth,
storage and external secret backup.
