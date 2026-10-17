# Product offer authoring

The offer API reuses template authorization, errors, limits and the private preview
workflow in [api.md](api.md). An instance admin owns every scoped key. The product
UUID goes in `/api/v1/products/<productId>/offer/<endpoint>`, never in config/body.
Discover existing products by name in supplied public bindings or with a separately
authorized `products:read` key. Never ask the seller to type UUIDs.

| MCP tool | HTTP endpoint suffix | Body (MCP additionally takes productId) | Scope |
| --- | --- | --- | --- |
| offers_read | GET config | none | templates:read |
| offers_draft | PUT draft | `{expectedRevision,config}` | templates:write |
| offers_validate | POST validate | `{config,mode:"draft"\|"publish"}` | templates:read |
| offers_preview | POST preview | `{revision,locale:"en"\|"pl",fixture:"published-products"}` | templates:read |
| offers_diff | POST diff | `{fromRevision,toRevision}` | templates:read |
| offers_history | POST history | `{beforeRevision?,limit?}` | templates:read |
| offers_publish | POST publish | `{expectedRevision}` | templates:activate |
| offers_rollback | POST rollback | `{expectedRevision,targetRevision}` | templates:activate |
| offers_reset | POST reset | `{expectedRevision,field:"appearance"\|"density"}` | templates:write |

All calls return top-level bodies, without a data envelope. Read always returns exactly `{productId,productName,revision,draft,published,validation}`,
including absent and rolled-back offers; draft/published are nullable. No DB metadata
or snake_case aliases are returned. Mutation returns
revision/validation. History returns `{history:[...]}`, a descending array, at most 50 entries (default 20),
with an exclusive beforeRevision cursor. All revisions/history targets are per
product; storefront and other product revisions are unrelated. Diff compares
`draft ?? published` at two revisions using sorted JSON pointers. Errors preserve
`code,message,validation,currentRevision`; reconcile 409, never retry mutations
blindly. Private responses use no-store/noindex; 429 includes Retry-After: 60.

Use `templates_capabilities` for `offers` (IDs, slots, reset paths, route-product
binding) and `schemas["offer-config"]` / `schemas["offer-recipe"]`. Config has only
format, enabled, templateId, density settings, offer.hero/faq/closing content, and
tokens. Product/price/action overrides are rejected. `offer-default` is free;
non-null tokens must be a complete approved token set and require current theme
customization rights at publication/rollback. Free accounts may draft/preview it.
Reset appearance sets tokens to null; reset density restores comfortable. Neither
resets seller copy. Missing locale copy uses sourceLocale. Optional FAQ is absent
when no slot exists. A present slot missing EN or PL produces the same non-blocking
`TRANSLATION_FALLBACK` warning as storefront validation: path `/content/<slot>`,
message `Missing translation uses source locale`. Absent optional slots do not.

Read → save draft → validate publish → preview both locales → diff → publish →
read back → authorized rollback → read back. Publish takes only the saved revision;
active/listed product status and current rights are checked again. A clean product
uses revisions 0 → draft 1 → publish 2 → baseline rollback 3; baseline published
null means opt-out. Publish clears the working draft. Baseline rollback clears both
working draft and publication; copy survives in history (draft 1 / publication 2).
To keep editable copy while opted out, explicitly save the preserved candidate
(or history's draft/published payload) as a new draft using the latest revision,
only if authorized. This adds a revision without publishing. Alternatively, publish
`enabled:false` to opt out while retaining copy in the current publication.
Scheduled availability and actual price remain core truth.

Public default-locale URLs are `/offer/<slug>`; Polish uses `/pl/offer/<slug>`.
`/en/offer/<slug>` returns 307 to the unprefixed canonical. After enabled publication,
catalogue details links change from `/en/p/<slug>` to `/en/offer/<slug>` (and from
`/pl/p/<slug>` to `/pl/offer/<slug>`); opt-out reverses this. Buy links still reach
core checkout; direct `/p/<slug>` retains its behavior. If the product is absent
from the first catalogue page, find it through catalogue search/pagination; do not
claim a link rewrite from a product that was never rendered.

Preview returns metadata plus `/template-preview/<revision>?...&productId=<uuid>`.
Keep the whole returned path/query and use header auth on every navigation, empty
cookies and no scripts as in api.md. It is a private dynamic page, not a public
share link or portable HTML snapshot. Anonymous/wrong-scope access fails. Any
mutation or ten-minute expiry invalidates it; refresh metadata and inspect again.
Offers accept **only** `fixture:"published-products"`; other fixture names are
rejected (declared storefront fixtures return 404). Offers bind to the route product,
so storefront synthetic fixtures cannot create offer edge states. Use the offer
matrix below instead of api.md's storefront fixture matrix. Preserve core notices.

## Required offer evidence

| Check | Required evidence |
| --- | --- |
| Saved candidate | 8 inspected screenshots: EN/PL × light/dark × 1440/390, with paths and pass/fail. |
| Narrow/tablet, zoom, motion | EN/PL checks at 320/768; 200% zoom; reduced motion. Record dimensions/settings, overflow, headings and readable protected notices. |
| Missing copy/media, long copy | Inspect existing absent states and long supplied copy. If unavailable, record not exercised and why; do not invent facts/media or mutate extra drafts without authorization. Use authorized temporary drafts or the core harness for additional cases. |
| Preview boundary | 200, exact private headers, lang, inert marker, empty cookies, no scripts/key/off-origin or commerce requests; apply api.md assertions to every navigation. |
| Lifecycle/routing | Record revisions and read-backs, fallback warnings, authorized publication/rollback, public locale status/redirects, details rewrite and checkout destination. |
| Interaction/scope | Core harness for keyboard/FAQ/checkout behavior; separate product-only-key denial check when supplied. Mark missing keys/harness as not performed, never passed. |

Inert screenshots do not prove interactions or a full accessibility pass. Report
limitations explicitly; a reduced trial is not full matrix acceptance.

Return this offer-specific report (private evidence only; no credentials):

```ts
interface OfferReport {
  mode: 'compose'; productId: string; templateId: 'offer-default';
  validation: ValidationResult; // full returned validatorVersion/valid/errors/warnings
  revisions: { operation: string; before: number; after: number }[];
  evidence: { check: string; locale?: 'en'|'pl'; scheme?: 'light'|'dark';
    width?: number; status: 'passed'|'failed'|'not-performed';
    evidencePath?: string; reason?: string }[]; // cover every matrix row
  changedFiles: string[]; unusedSlots: string[];
  publication: { state: 'enabled'|'disabled'|'opted-out'; revision: number };
  rollback: { targetRevision: number; revision: number } | null;
  limitations: string[];
}
```

Compose changedFiles contains no app sources. Not-performed evidence requires a
reason; record routing/interaction observations separately from visual inspection.

Optional offline commands from an authorized local checkout (compose authors need
only the API; no install/source/env access is required):

```sh
bun run template:check -- --offer-config /private/path/offer.json --json
bun run template:check -- --print-schema offer-config
bun run template:check -- --print-schema offer-recipe
```

Offline offer checks enforce the frozen grammar, stored/input 100KiB limits and
bounded UTF-8 parser. Exit 0 = valid, 1 = invalid, 2 = input/I/O/usage. JSON stdout
is one ValidationResult. `--mode`, `--fixture`, `--contract` do not apply to
`--offer-config`; use instance validate in publish mode for rights/contrast checks.
Offline success cannot attest instance product availability or publication rights.
