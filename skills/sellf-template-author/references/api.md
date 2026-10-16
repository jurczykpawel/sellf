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
`draft`, `published`, `rights`, `effectiveTemplateId`, validation and resolved tokens.
Mutation returns `revision` and validation. Diff contains sorted JSON Pointer changes
and unused slots. Keep all warnings. Revisions are exact safe nonnegative integers.
Typical clean stack: read0 → draft1 → validate → preview1 → diff0/1 → publish2 →
rollback(target0,expected2)3. Always use actual returned revisions.

Config input and stored JSON each have a 102400-byte UTF-8 limit; request envelope
131072 bytes; depth 12. Partial settings are retained per template, tokens are partial
approved values. Order is a permutation of current section IDs; catalogue stays
visible. There is no API for uploading arbitrary recipes/components.

Errors: `code,message,validation,currentRevision`; 401 unauthenticated, 403 scope/
admin/rights, 404 missing fixture/history, 409 conflict, 422 invalid/limit, 429 rate
limit, 503 unavailable. Fix validation by pointer; reconcile 409; pause on 429 until
its retry window; surface unavailable/denied operations without alternate access.

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

Request EN/PL × light/dark × 1440/390 for `standard`; also inspect `empty`, `long`,
`unavailable` and `published-products`. Standard covers synthetic free, paid,
subscription and PWYW with absent media. Synthetic UUIDs differ from live bindings;
`published-products` is the authoritative visual binding check. Inspect 320/768,
200% zoom, reduced motion and long seller copy; check overflow, heading order,
contrast and protected notices. Large catalogue pagination and keyboard/filter/FAQ
behavior need the core fixture harness; an inert preview cannot prove interactions.
Do not invent a `large` fixture or claim a full a11y pass from screenshots.

The page reauthenticates and rejects old drafts; lease is ten minutes. After any
draft mutation or expiry request fresh preview metadata and new evidence before
publishing. Anonymous/wrong-scope pages are denied (404); stale POST is 409.
