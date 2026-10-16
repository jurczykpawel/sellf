# Frozen Phase 2 authoring contract (T2.4)

`admin-panel/src/lib/storefront-templates/phase2-contracts.ts` is the shared source
for T2.5/T2.6 and the subsequent C/offer tasks. It extends the Phase 1 grammar
without changing its schemas, migration, D/default fixtures, or selectable registry.
`phase2.selectable: false` distinguishes frozen contracts from installed renderers.
Renderer tasks adopt these exact schemas/DTOs when registering their implementations;
storage/lifecycle adoption must keep the existing 100 KiB wire/stored budgets.
Do not regenerate the released Phase 1 migration to install this extension.

From `admin-panel/`:

```sh
bun run template:check -- --capabilities
bun run template:check -- --print-schema phase2-config
bun run template:check -- --print-schema phase2-recipe
bun run template:check -- --recipe example.json --contract phase2 --json
bun run template:check -- --config example.json --contract phase2 --json
```

These are structural offline checks, never activation/publication attestations.
`--contract phase2` rejects publish/fixture mode; existing default/D commands retain
their semantics. JSON Schema is generated on demand; cross-section targets, distinct
object keys and h1 ownership additionally require the shared Zod validator.

| Section/variant | Binding and content slot | Limit |
|---|---|---|
| hero-product/1 offer-focus | heroProduct / home.hero (hero) | one product |
| task-nav/1 search-hero | taskCategories / home.search (search) / catalogue target | 12 descriptions |
| product-list/1 comparison | comparisonProducts / home.comparison (comparison) | exactly 2 distinct products |
| product-list/1 featured-grid | featuredProducts / home.featured (heading) | 6 distinct products |
| catalogue/1 compact | listed-products / core density, filters, cursor | 24 per page |
| product-cta/1 starter | closingProduct / home.starter (cta) / details | one product |
| product-cta/1 catalogue-link | home.closing (cta) / catalogue target; no product/action | one visible target |
| author-hero/1 | home.author (author) / pathsTarget + catalogueTarget | one author; nullable portrait media ID |
| author-story/1 | home.story (biography) | 6 paragraphs × 2000 characters |
| product-paths/1 | home.paths (paths), ordered canonical product IDs | 4 distinct products and path IDs |
| project-showcase/1 | home.projects (projects) | 3 distinct project IDs |

B has a separate home.starter slot so its free starter does not overwrite closing copy.
All nested objects are strict. Text is bounded plain prose; slots are source-locale
EN/PL pairs. Existing starters remain ≤3. Comparison copy is product-specific, with
no commercial fields; resolve its product IDs against the configured ordered pair,
not array position in a translated slot. Search descriptions bind existing category
IDs, never substitute category names. Missing optional products/media have no invented
replacement. Core supplies all price/availability/action DTOs in batches.
`Phase2PublicInputs` adds only typed slots/settings and resolved public media-by-ID;
media IDs are adapter inputs, never network locations. Resolvers must project approved
media through the existing core media handling before these inputs reach components.
Project links allow plain HTTPS DNS-host paths only (optional port 443), with no
credentials/query/fragment/encoding/private-host literals; render as links, never fetch
or follow redirects. No media player is inferred from a missing sample.

A/B/C have separate retained settings keys `storefront-a/b/c`. Seller content stays
outside selection and survives switches. Premium registrations, override controls,
rights enforcement and public rendering remain their assigned tasks. Offer recipes
use `offer/1`: simple hero → optional FAQ → buy CTA. Both products use
`{source:"route-product"}` exclusively; offer config accepts only offer.hero/faq/closing,
core density and complete approved theme tokens, never product IDs. Product-scoped
storage/history remains T2.9; no singleton offer map is introduced.

## Visual handoff

`tests/fixtures/storefront-sections/phase2/` contains synthetic author/public inputs,
reference CSS and exactly twelve compressed PNGs: desktop-1440, mobile-390 and
card-detail for each of A/B/C/offer. Only PL carries committed pixel baselines;
both EN/PL still run geometry, heading, disclosure and network checks, with full
1440×900/390×844 captures written to `/tmp/t2-4-<concept>-<locale>-<width>.png`.
Desktop/mobile baselines retain full-page order; card-detail is the first expanded
product card for A/B/C and the core buy CTA for offer. Section and consent crops
are not stored separately. The fixture directory has a 1,500,000-byte test budget.

`sources.json` pins the original A/B/C index.html and named source images by SHA-256.
The reference CSS retains source grid, spacing, image geometry and colors, using
Geist already bundled in the app (`geist/dist/fonts/geist-sans/Geist-Variable.woff2`)
in place of Inter/Outfit. No additional font binaries or license copies are shipped.
This approved substitution changes line wrapping; the structural tolerance applies
to grids/gutters/card dimensions, not exact source-font text wraps. C's system Georgia
editorial accents remain. Synthetic names, prose, prices, covers and portrait replace
seller facts; there is no mock playback or invented proof.

`referenceConfig()`, `referenceProducts(locale)`, `referenceCategories(locale)` and
`referenceCopy` expose matching author inputs, public DTOs and reference labels.
Portrait media ID `uuid(20)` uses the same static SVG with 440×484 dimensions and
the synthetic author name as alt text. A retains its tilted panel, process row,
comparison pair and three starts; B retains its search/task hero, six features and
starter; C retains portrait/story, four paths, three projects and three paid cards.
Offer uses the shipped simple HeroProduct, Faq and buy ProductCta components.
Reference chrome is inert; functional renderer, a11y and commerce acceptance still
belongs to the assigned implementation tasks and their existing shared harness.

Structural tolerance remains ≤2 CSS px; pixel threshold 0.2 and maximum differing
ratio 0.005 compare repeated synthetic captures with no whole-section masks.
From `admin-panel/`, run:

```sh
bunx playwright test --config playwright.sections.config.ts tests/storefront-phase2-reference.spec.ts --workers=1
```

After intentionally updating and inspecting the twelve PNGs, compress them with
`pngquant --quality=90-100 --speed 1 --strip --force --ext .png <files>` and rerun
comparison without updates. Native PNG comparisons require no new harness codec.
EN/PL/dark/320/768/zoom/keyboard/reduced-motion/long/empty/price-kind renderer coverage
remains required; it does not require committing every generated screenshot.
