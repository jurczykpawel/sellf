# Sellf domain glossary

Use these terms in code, UI and discussion. English identifiers remain English;
Polish translations are UI labels for the same concepts.

| Canonical term | Definition | Code or schema evidence |
|---|---|---|
| API key | An owner's credential for scoped API calls; activation, rotation grace and permanent revocation jointly determine whether it works. | `public.api_keys`; `admin-panel/src/lib/api/api-key-status.ts` → `getApiKeyStatus` |
| Rotation grace period | A retired API key's limited period of continued use, unless revoked or expired. `is_active=false` denotes retirement; `rotation_grace_until` bounds continued use. | `public.api_keys.rotation_grace_until`; `public.verify_api_key` |
| Business event | A committed order, access or reservation change captured transactionally for signed webhook delivery. | `public.business_events`; `admin-panel/src/lib/services/business-events.ts` |
| Free grant context | Validated checkout answers stored before the sign-in email and bound to a verified buyer and product when free access is granted. | `public.free_grant_contexts`; `admin-panel/src/lib/services/free-grant-context.ts` |
