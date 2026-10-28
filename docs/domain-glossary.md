# Sellf domain glossary

Use these terms in code, UI and discussion. English identifiers remain English;
Polish translations are UI labels for the same concepts.

| Canonical term | Definition | Code or schema evidence |
|---|---|---|
| API key | An owner's credential for scoped API calls; activation, rotation grace and permanent revocation jointly determine whether it works. | `public.api_keys`; `admin-panel/src/lib/api/api-key-status.ts` → `getApiKeyStatus` |
| Rotation grace period | A retired API key's limited period of continued use, unless revoked or expired. `is_active=false` denotes retirement; `rotation_grace_until` bounds continued use. | `public.api_keys.rotation_grace_until`; `public.verify_api_key` |
| Lead submission | An email request awaiting confirmation through its own magic link before product access and lead.captured. Distinct from a waitlist or purchase. | `public.lead_submissions`; `admin-panel/src/lib/leads/server.ts` → `leadSubmit`, `confirmLead` |
| Marketing consent | The server-recorded wording and version accepted with a lead submission, active after email confirmation. Distinct from cookie consent and mailing list membership. | `public.lead_submissions` → `marketing_consent`, `consent_text`, `confirmed_at` |
