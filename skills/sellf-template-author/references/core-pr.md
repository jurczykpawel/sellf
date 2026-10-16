# New core section or slot kind

Read repository AGENTS.md and the closest implementation. Relevant sources:
`admin-panel/src/lib/storefront-templates/{schemas,registry,resolver,capabilities}.ts`,
`admin-panel/src/components/storefront/StorefrontComposition.tsx`, sections under
`admin-panel/src/components/storefront/sections/`, fixtures under
`admin-panel/tests/fixtures/storefront-sections/`. All paths are repo-relative.

1. Explain why a shipped variant cannot satisfy the request. Declare a stable
   versioned type, surfaces, strict props, variants, bindings, slot kinds and bounds.
   Breaking behavior gets `/2`; preserve `/1` while referenced.
2. Write failing contract/projection tests first. For the separate `author-story/1`
   exercise add **biography**, not an untyped text/HTML escape: strict bounded
   content schema, SlotContent union member, localized validation through `localized`
   in schemas.ts (the LocalizedSlot contract), stable `home.author` slot catalogue,
   section union and kind-specific binding validation, in the same PR.
3. Extend PublicInputs and explicit public projection/resolution, typed resolved
   section union, component dispatch and registry defaults together. Props contain
   public DTOs only: no env/request/client/user/customer/content_config/keys. Resolve
   approved portrait media through existing core adapters; no component fetching,
   commerce/auth queries, arbitrary URLs, styles, hooks or price/action overrides.
4. Add EN/PL fixtures, empty/absent media/long copy, light/dark, 320/390/768/1440,
   200% zoom, reduced motion, keyboard/focus/heading/contrast and network checks.
   Reuse core price/action/media/unavailable states and fixture harness; preserve
   consent/legal/notices/errors/watermark. No invented seller proof.
5. Verify unit, lint (no new warnings), typecheck, build, relevant visual/commerce
   checks. Record bundle/query/vitals deltas; zero per-section/per-card DB reads.
6. Regenerate capabilities/JSON Schema from Zod; update starter and skill examples.
   `bun run template:check -- --capabilities` and `--print-schema config` (or recipe)
   expose generated contracts from admin-panel/. No standalone schema copies.
   `template:schema` updates embedded SQL only in an unreleased migration; released
   migrations are immutable. Follow repo migration/seed/RLS/type checks if needed.
7. Submit a reviewable core PR with changed paths, fixtures/evidence and validation;
   do not activate an unpublished component through seller config or deploy it.

Separate trial acceptance: a new biography slot must round-trip both locales,
reject unknown/wrong-kind fields, stay public-only, appear in generated schemas/
capabilities, resolve/render through the registered section, preserve existing `/1`
fixtures and pass required checks. A component alone fails. Record changed files
and evidence in the author report. Coordinator runs this trial independently.
