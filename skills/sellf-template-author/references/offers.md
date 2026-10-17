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

All calls return top-level bodies, without a data envelope. Read returns productId,
productName, revision, nullable draft/published and validation. Mutation returns
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
when no slot exists. Do not claim a translation warning unless validation returns it.

Read → save draft → validate publish → preview both locales → diff → publish →
read back → authorized rollback → read back. Publish takes only the saved revision;
active/listed product status and current rights are checked again. A clean product
uses revisions 0 → draft 1 → publish 2 → baseline rollback 3; baseline published
null means opt-out. Scheduled availability and actual price remain core truth.

Preview returns metadata plus `/template-preview/<revision>?...&productId=<uuid>`.
Keep the whole returned path/query and use header auth on every navigation, empty
cookies and no scripts as in api.md. It is a private dynamic page, not a public
share link or portable HTML snapshot. Anonymous/wrong-scope access fails. Any
mutation or ten-minute expiry invalidates it; refresh metadata and inspect again.
Use `published-products`: offers bind only to their route product; storefront
synthetic fixtures do not establish separate offer edge states. Inspect EN/PL ×
light/dark × 1440/390, missing copy/media and long supplied copy. Core fixture
harness supplies interaction evidence; inert snapshots cannot prove checkout or
FAQ keyboard behavior. Preserve core notices and never embed credentials.

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
