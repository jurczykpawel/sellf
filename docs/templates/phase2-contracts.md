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

## T2.6 renderer handoff

`resolveProductList` and `ProductList` accept the frozen comparison/featured specs;
`resolveCatalogue` and `Catalogue` accept compact as a single `all` group. Prices,
notes, availability and details destinations remain core DTO values. The caller
supplies batched product maps; these renderers perform no product reads. Comparison
copy joins on product ID, and selected binding order wins over translated item order.
The existing starter schema and default/D geometry remain unchanged.

D-055 adds optional localized editorial fields for these sections only:
comparison `eyebrow`/`actionLabel` (80 chars); featured `eyebrow`/`actionLabel`/
`detailActionLabel` (80), `detailsLabel` (120), and at most six distinct product-ID
annotations with optional `eyebrow` (80), `descriptor` (120), `detailHeading` (160),
`detailBody` (1000), `requirementsLabel` (240). All remain bounded plain text.
Compact may bind optional `home.catalogue` heading content (existing heading/body
limits plus optional 80-character eyebrow); pass resolved slots to its resolver.
Absent annotations use canonical product marketing and core EN/PL labels. Section
registration/selection, lifecycle storage adoption and A/B composition is described below; the shared list task itself did not register entries.

The binding loader accepts optional comparison/featured selections and returns
ordered `comparison`/`featured` arrays. It deduplicates all selected IDs and uses
batches of at most five, retaining the existing RPC bound without a migration
(maximum three batches across all bindings; six featured products use two).
Compact geometry checks substitute canonical localized format/requirements text
for the reference's synthetic caption. Core action styling remains token-driven.
Six compressed production card crops live outside the frozen reference directory;
no reference PNG or font was added or replaced.

## T2.5 shared renderers / D-055

`HeroProduct` accepts `OfferFocusProps`, `TaskNav` accepts `SearchHeroProps`, and
`ProductCta` accepts `CatalogueLinkProps`. `resolveSharedPhase2Section` validates
these three specs against the Phase 2 recipe, settings and public batches. It
rejects missing/non-catalogue targets, foreign category targets and non-core
product destinations. Closing has no product binding. Premium registration and
lifecycle adoption remain later tasks; no registry entry becomes selectable here.

D-055 extends **Phase 2 home.hero only** with optional `stepDetails` (up to six
plain-text strings of 1000 characters, paired by step index) and `mediaCaption` (plain text ≤80), plus `staticDemo`
(strict title ≤160 / body ≤1000). `home.search.eyebrow` is optional plain text
≤80. They are inside each source-locale content value, and the same localization
fallback applies. Missing new fields preserve older inputs. Phase 1 schemas,
D/default content and offer.hero remain unchanged. JSON Schema/capabilities derive
these additions directly from the schemas. Static demo text never creates a
player, embed, external link or request. Prices, format, requirements and product
actions continue to come from canonical public product DTOs.

The T2.5 browser fixture renders actual sections, compares structural positions
against T2.4's reference HTML at ≤2px, and uses .2/.005 for its small compressed
hero regression crops. Core action labels and canonical product format are content
substitutions; they do not change grid/gutter/media geometry. No reference PNG or
visual tolerance is changed. Run the shared harness with:

```sh
bunx playwright test --config playwright.sections.config.ts tests/storefront-phase2-shared.spec.ts --workers=1
```

## Installed A composition

`storefront-a` now installs the seven frozen A blocks in order: offer-focus hero,
category links, comparison pair, three starters, compact catalogue, FAQ and
catalogue-link closing. `phase2.installedTemplateIds` identifies this installed
subset; the full offline A/B/C/offer contract remains non-selectable as a group.
The category ribbon uses the existing target-scoped TaskNav events, with A-only
composition styling. No second finder or product request is added.

`base-schemas.ts` retains the Phase 1 grammar used to build the frozen extension.
`schemas.ts` adopts the installed A/B sections, slots and retained settings for runtime
validation; default/D bounds remain unchanged. A's default composition retains that order. Its descriptor-derived override map
uses `order?: KnownId[]` and `sections.<id>.visibility/variant`; tasks, starters and
FAQ may hide, while hero, comparison, catalogue and closing remain visible. Only
declared variants are accepted (offer-focus, comparison, compact catalogue,
catalogue-link closing; starters also accept compact). Reads accept unique known
subsets up to 32 IDs; writers materialize the complete anchored order through
`effectiveLayout()`. Missing intent inherits defaults, and reset removes one leaf.
The hero remains the first visible section; catalogue targets remain visible.
Density and seller tokens remain editable. Comparison copy joins the
two selected products by ID; product selectors use the existing name-based picker.
A's blue palette, bundled Geist and canonical action labels are approved content
substitutions for the prototype; there is no seller-specific shipped claim.

The A source section in `20261110235900_release_2026_11_0_storefront.sql` installs the generated
schema and extends stored item validation for comparison product IDs. The schema
generator updates named source sections in that release file; the Phase 1 section stays frozen.
Seed data retains optional A bindings while publishing the free default, without
credentials or premium activation. Runtime rights still combine local platform
and matching A confirmation; missing rights select the free storefront.
T2.8 owns the complete premium author/purchase trial before release.

## Final stored section intent

D-056 replaces the unreleased `hidden`/`variants` fields with strict, finite
`sections` maps. `section-descriptors.ts` declares visibility, variants and
pin/after/before placement for default/D/A/B and installed C. Installed
and frozen Zod/JSON Schema contracts derive from those descriptors; unknown IDs,
unknown leaves and variants needing different bindings are rejected. Resolver, content checks, editor, reset paths, capabilities,
preview and authored-order normalization share `effectiveLayout()`.

Offers retain their independent frozen config: no section overrides, product IDs,
visibility or variant controls. The offer editor only edits opt-in, copy, density
and appearance. The release gate enumerates every offer permutation with/without
FAQ against the frozen route-product grammar, plus all legacy default/D/A/B/C orders
and optional visibility subsets through the real storefront resolver, including
an anchored additive section. No adapter or historic JSON rewrite is introduced.

The A and B schema snapshots are preserved as named source sections in
`20261110235900_release_2026_11_0_storefront.sql`; the C section below owns the current schema.
The Phase 1 section retains its D-056 schema and conditional published-row validation.
Credential and offer sections share the same release file. Frozen sections must never be regenerated.

## Installed B composition

`storefront-b` installs search/task hero → up to six featured products → compact
catalogue (24/page) → optional starter product → FAQ → catalogue-link closing.
It reuses the frozen Phase 2 grammar, descriptors, public batches and section
implementations. The B confirmation and Pro/Business are both required; an A key
does not select B. Missing rights retain saved B state and render the free default.

B's hero, catalogue and closing remain visible; featured, starter and FAQ may hide.
Explicit orders normalize through the same anchored resolver, and the exhaustive
legacy-order/visibility gate includes B and additive sections. Category descriptions
and featured annotations remain localized seller copy. The editor uses product
and category names; descriptions follow the chosen category order. The optional
starter uses `closingProduct` and the separate `home.starter` slot, while closing
only targets the required catalogue. Public/preview reads include the existing
bounded featured batch; there is no new catalogue or per-card query.

The B source section in `20261110235900_release_2026_11_0_storefront.sql` contains the B generated storefront
schema and adds item identity checks for B. Its generated block remains frozen
after C adoption; A and released Phase 1 SQL also remain unchanged. Seed retains B bindings
without selecting or activating it. B uses the reviewed blue palette and bundled
Geist, with the same core prices, details/offer routing and checkout actions.
The opt-in premium trial reuses `playwright.premium.config.ts` with
`PREMIUM_TRIAL=b` and disposable coordinator inputs in `/private/tmp/sellf-t213/`.

## T2.14 author hero handoff

`authorHeroDefinition` exposes the frozen `author-hero/1` component and
`resolveAuthorHero`. Pass the visible recipe after D-056 layout resolution: the
resolver validates both section targets and membership in that recipe. Inputs are
localized `home.author` and already approved public `mediaById` DTOs; no product,
client or fetch is required. Missing media is omitted. Missing/blank author copy
keeps one heading using the author name or the core catalogue label.
C registration and lifecycle storage adoption remain T2.18; `home.story` remains
biography, separate from the hero. No trial slot or schema extension is introduced.

The browser harness compares C heading/portrait geometry within 2px in EN/PL,
with desktop arch and mobile circular crop. Frozen author grammar has no note or
caption body, so those reference-only fields are omitted; core action labels and
token colors replace prototype labels/colors. Newlines in the plain heading mark
the editorial second phrase. Long/empty/missing media, dark, keyboard, reduced
motion, 320/768/1440px, 200% zoom, escaping and request bounds run without a DB:
`bunx playwright test --config playwright.sections.config.ts tests/storefront-author-hero.spec.ts --workers=1`.

## T2.15 author story handoff

`authorStoryDefinition` exposes `author-story/1`, `resolveAuthorStory` and the
server-rendered `AuthorStory`. It binds only frozen `home.story` biography copy;
there are no products, links, media or reads. Pass already localized public slots
using the shared selection rule `slot[locale] ?? slot[slot.sourceLocale]`.
Absent and entirely blank stories render nothing. The first nonblank paragraph
uses C's Georgia lead treatment; subsequent paragraphs use supporting prose.
Newlines remain plain text. No credentials or biography defaults are supplied.

Serialized Phase 2 A→C→D fixtures retain both locale values byte-for-byte; source
fallback is tested in both directions. C installation, editor/storage adoption
and dispatch remain T2.18, using the existing D-056 `story` descriptor and frozen
slot. No runtime registry, schema, migration or released fixture changes here.
The isolated browser harness checks C story geometry within 2px, PL repeatable
crops at .2/.005, EN/PL headings, keyboard traversal, contrast, dark/long/empty,
320/390/768/1440px, reduced motion, 200% zoom and request bounds:
`bunx playwright test --config playwright.sections.config.ts tests/storefront-author-story.spec.ts --workers=1`.

## T2.16 product starting paths handoff

`productPathsDefinition` exposes the frozen `product-paths/1`, `resolveProductPaths`
and server-rendered `ProductPaths`. Pass the already localized `home.paths` slot
and the public binding map; four distinct product IDs and path IDs retain seller
order. Unknown binding keys fail resolution. Explicit null or unavailable products
omit their optional paths; absent content or no available paths renders nothing.

`loadStorefrontBindings` accepts optional `pathProducts` (≤4 distinct UUIDs), sharing
its existing deduplicated five-ID RPC batches with other bindings. Its `paths` map
contains every requested UUID, with null for products absent from the public read.
Use `bound.data.paths` as the resolver's `productsById`; never fill missing entries
from private product reads. The adapter supplies public media, localized free/price
labels and offer-aware details actions. Cards reuse `PublicProductPrice` and
`PublicProductFacts`, including tax/prior-price/access facts. No price, action,
category or collection state is added to editorial content.

C installation, localized binding collection, D-056 dispatch and storage adoption
remain T2.18, like the preceding author families. D-055 adds optional bounded
localized `eyebrow`, `actionLabel` and per-path `label`
to preserve the C reference decorations. Existing core details/format labels remain
the fallback; price and free labels always come from the public product DTO.
Colors inherit approved theme tokens.
The isolated harness checks C card columns/covers within 2px, repeatable PL crops
at .2/.005, EN/PL at 320/390/768/1440px, dark, long, absent/unavailable products,
missing media, all price kinds, keyboard, reduced motion, 200% zoom and no commerce
or licensing requests:
`bunx playwright test --config playwright.sections.config.ts tests/storefront-product-paths.spec.ts --workers=1`.
Mobile ordinals use 38px with tighter tracking inside the frozen 35px column,
keeping two digits together with clear separation from the situation heading.

## T2.17 project showcase handoff

`projectShowcaseDefinition` exposes `project-showcase/1`, `resolveProjectShowcase`
and server-rendered `ProjectShowcase`. Pass the already localized `home.projects`
slot and `mediaById` containing only reviewed product-image adapter DTOs. The
frozen schema permits three distinct project IDs, bounded name/body and a plain
HTTPS page link. A fourth item, duplicate IDs, unknown fields, URL media IDs,
credentials, non-HTTPS schemes, private-host literals, queries, fragments and
encoded paths fail resolution. Project page links are rendered directly with no
prefetch, server fetch, redirect resolution or embed. They are never media sources.

`public-media.ts` shares the existing author-hero image projection without changing
its accepted DTOs. Extra image fields are stripped; missing or malformed approved
images are omitted. Supplied images use the same unoptimized Next Image rendering
as the other C families, explicit dimensions, lazy loading and an 8:5 contain
frame. No player, sample placeholder or proof is manufactured. Empty slots/lists
render nothing; link labels come from EN/PL messages with the project name in the
accessible label. C registration, D-056 dispatch, localized slot collection and
storage/editor adoption remain T2.18, using the frozen `projects` descriptor.

The isolated harness compares C's band padding, gutters, heading position and
three-column/stacked card geometry within 2px. It removes only reference fields
absent from the frozen grammar (eyebrow, requirements and missing-sample boxes)
before structural comparisons. Approved tokens replace prototype colors; localized
core project-link labels replace the reference offer labels. PL crops are pinned
at .2/.005; EN/PL 1440/390 captures are `/tmp/t2-17-<locale>-<width>.png`.
Long/empty/missing media, supplied static media, light/dark, 320/768/1440px,
200% zoom, keyboard focus, reduced motion, contrast and request bounds run without
an app server or database:
`bunx playwright test --config playwright.sections.config.ts tests/storefront-project-showcase.spec.ts --workers=1`.


## Installed C composition

`storefront-c` installs author hero → optional biography → up to four product
paths → optional three-project showcase → optional three starters → compact
catalogue (24/page) → FAQ → catalogue-link closing. It adopts the frozen four
families and D-056 descriptors, with its own confirmation plus Pro/Business.
A/B confirmations do not unlock C; expiry selects the free default while retaining
all localized content and inactive settings. No biography route is introduced.

The editor uses named product pickers for paths and optional cover images.
Portrait/project media UUIDs refer to existing public product covers; unresolved
or unavailable covers are omitted. These references add no media store or URL
fetch. Biography paragraphs, project links and path descriptions follow EN/PL
source-locale fallback. The bounded media/product batches remain private to the
core resolver. C orders and all 16 optional-visibility combinations join the
exhaustive release gate, including an anchored additive section.

The C source section in `20261110235900_release_2026_11_0_storefront.sql` owns the current generated config
schema and adds C path identity and project-link validation. The frozen Phase 1,
A and B source sections remain unchanged. Seed examples retain inactive C copy
and bindings while the free default stays published.


### D-057 hosted migration validation

The current RC release migration is inherited verbatim, including its internal
bounded JSON-Schema validator; the separate VAT migration remains separate (D-058).
A/B/C and offer snapshots use `jsonschema_subset_matches`, with their existing
identity, text, link and lifecycle checks retained. The unreleased A migration
extends the subset with `minItems` and the plain-label/HTTPS patterns emitted by
Phase 2. Depth, shared node budget, stored byte bounds and service-only privileges
remain unchanged. No production migration installs or calls pg_jsonschema.

`bun run template:schema` validates every RC/A/B emitted schema and generates only
the current C/offer blocks plus the additive A pattern map. Unknown keywords,
formats or unreviewed patterns fail before any write. RC/A/B schema snapshots are
not regenerated. `lint:migrations` also rejects extension dependencies, including
calls inside SQL function bodies.

The repeatable hosted-path regression is:

```sh
python3 supabase/tests/jsonschema-regression.py --phase2 --prepare
python3 supabase/tests/jsonschema-regression.py --phase2 --rpc
python3 supabase/tests/jsonschema-regression.py --phase2 --parity
```

It owns only `sellf-p2d057` at `/private/tmp/sellf-p2d057`, ports 55440–55449.
The real HTTP RPC applies all nine migrations from RC through Phase 2/VAT as
service_role, with a non-superuser RPC owner, an extension-permission negative
control, exactly-once history and idempotent repeats. Only the later test parity
step installs pg_jsonschema 0.3.3 as the harness superuser. The full reference
corpus includes RC config/marketing, A/B/C, offers, every emitted subschema and
all seven patterns, including minItems boundaries and URL adversaries.
