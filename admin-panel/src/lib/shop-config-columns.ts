/**
 * Public-safe columns of `shop_config` that anon (the public storefront) may read.
 *
 * MUST stay in sync with the column-level GRANTs in
 * `supabase/migrations/20260621000000_legal_docs_vat_tax_and_payment_rpc.sql`
 * (anon) and `20260701120000_shop_vat_exempt_note_default.sql` (authenticated).
 * Both roles get this same public subset; the admin panel reads the full row
 * via service_role.
 *
 * Excluded (admin-only — read via getMyShopConfig / service_role):
 *  - Seller PII: legal_form, company_legal_name, nip, regon, krs, company_street,
 *    company_building_no, company_flat_no, company_city, company_postal, company_phone,
 *    complaints_email, is_vat_exempt, vat_exempt_note, is_micro_enterprise, has_dpo, dpo_contact
 *  - `country`: admin-only (PL legal-doc gate); read via getMyShopConfig (select '*').
 *  - `custom_settings`: free-form jsonb, admin-only. Never anon-exposed so a future write
 *    (e.g. an integration secret) can't silently leak via the public storefront read.
 *
 * `contact_email` IS included — the shop's intentionally-public contact, already
 * shown to anonymous visitors on the "Coming Soon" page.
 *
 * Lives in its own (non-`'use server'`) module so the storefront-anon-read security
 * test can import the exact list and assert it matches the SQL grant — catching
 * drift (a column listed here but not GRANTed, which 42501s the public storefront).
 */
export const SHOP_CONFIG_PUBLIC_COLUMNS = [
  'id',
  'shop_name',
  'default_currency',
  'tax_rate',
  'tax_mode',
  'stripe_tax_rate_cache',
  'logo_url',
  'font_family',
  'checkout_theme',
  'automatic_tax_enabled',
  'tax_id_collection_enabled',
  'checkout_billing_address',
  'checkout_expires_hours',
  'checkout_collect_terms',
  'terms_of_service_url',
  'privacy_policy_url',
  'omnibus_enabled',
  'created_at',
  'updated_at',
  'contact_email',
] as const

/** Comma-joined form for PostgREST `.select(...)`. */
export const SHOP_CONFIG_PUBLIC_COLUMNS_CSV = SHOP_CONFIG_PUBLIC_COLUMNS.join(',')
