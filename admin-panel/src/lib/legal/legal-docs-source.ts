import type { ConfigSource } from '@/lib/stripe/checkout-config'

/**
 * Resolved legal-document URL with provenance, mirroring the db/env/default
 * source model used for checkout config (see {@link ConfigSource} and
 * `resolveNullable` in `@/lib/stripe/checkout-config`).
 *
 * The `/terms` and `/privacy` routes resolve the URL as
 * `shop_config.<col> || process.env.<VAR>`, so an empty DB column can still
 * redirect via the env fallback. The settings UI was showing the raw (empty)
 * DB value, hiding that an env value was actually in effect. This surfaces it.
 */
export interface ResolvedDocUrl {
  /** The effective URL (DB wins, then env), or null when nothing is configured. */
  value: string | null
  /** Where `value` came from. */
  source: ConfigSource
  /** The env fallback value if set (regardless of whether DB overrides it), else null. */
  envValue: string | null
}

function normalize(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Resolve a single legal-doc URL the same way the public `/terms` /`/privacy`
 * routes do: DB value first, then env fallback, then nothing.
 */
export function resolveDocUrl(
  dbValue: string | null | undefined,
  envValue: string | null | undefined,
): ResolvedDocUrl {
  const env = normalize(envValue)
  // DB is user-managed — keep the stored value verbatim, but treat
  // whitespace-only as unset so it doesn't mask the env fallback.
  const dbSet = normalize(dbValue) !== null
  if (dbSet) {
    return { value: dbValue as string, source: 'db', envValue: env }
  }
  if (env) {
    return { value: env, source: 'env', envValue: env }
  }
  return { value: null, source: 'default', envValue: env }
}

export interface LegalDocsSource {
  terms: ResolvedDocUrl
  privacy: ResolvedDocUrl
}

/**
 * Resolve both legal-doc URLs from a shop config row plus the env fallbacks
 * (`TERMS_OF_SERVICE_URL` / `PRIVACY_POLICY_URL`).
 */
export function resolveLegalDocsSource(
  config: { terms_of_service_url?: string | null; privacy_policy_url?: string | null } | null,
  env: { terms?: string | null; privacy?: string | null },
): LegalDocsSource {
  return {
    terms: resolveDocUrl(config?.terms_of_service_url, env.terms),
    privacy: resolveDocUrl(config?.privacy_policy_url, env.privacy),
  }
}
