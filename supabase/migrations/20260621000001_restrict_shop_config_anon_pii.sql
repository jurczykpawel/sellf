-- Restrict anon SELECT on shop_config to public-safe columns only.
--
-- Background: migration 20260621000000_legal_seller_fields.sql added 16 seller-PII
-- columns (NIP, REGON, KRS, address, phone, DPO contact, etc.) to shop_config.
-- The table already has GRANT SELECT ON public.shop_config TO anon (granted in
-- 20250103000000_features.sql) and a "Public read access to shop_config" row-level
-- policy USING (true), so those columns became world-readable via PostgREST.
--
-- Fix: revoke the blanket table-level grant, then grant only the columns that the
-- public storefront legitimately needs. The 16 PII columns are omitted intentionally.
--
-- Safe columns (anon legitimately needs):
--   id, shop_name, default_currency, tax_rate, tax_mode, stripe_tax_rate_cache,
--   logo_url, font_family, checkout_theme, automatic_tax_enabled,
--   tax_id_collection_enabled, checkout_billing_address, checkout_expires_hours,
--   checkout_collect_terms, terms_of_service_url, privacy_policy_url,
--   omnibus_enabled, custom_settings, created_at, updated_at
--
-- Note: contact_email is deliberately excluded — it is PII. The public storefront
-- reads shop_name, default_currency, logo_url, font_family, checkout_theme,
-- tax_mode, stripe_tax_rate_cache, omnibus_enabled, terms_of_service_url,
-- privacy_policy_url (via named-column select or the getShopConfig() path which
-- is fixed below to name columns explicitly).
--
-- IMPORTANT: The application-side getShopConfig() (shop-config.ts) was using
-- select('*') via createPublicClient(). That query must be changed to enumerate
-- only public columns; column-level grants break SELECT * for anon. That fix is
-- applied in the TypeScript layer alongside this migration.
--
-- Columns excluded from anon grant (seller PII — admin-only):
--   contact_email, legal_form, company_legal_name, nip, regon, krs,
--   company_street, company_building_no, company_flat_no, company_city,
--   company_postal, company_phone, complaints_email, is_vat_exempt,
--   is_micro_enterprise, has_dpo, dpo_contact

-- Step 1: Revoke blanket table SELECT from anon
REVOKE SELECT ON public.shop_config FROM anon;

-- Step 2: Re-grant only the public-safe columns
GRANT SELECT (
  id,
  shop_name,
  default_currency,
  tax_rate,
  tax_mode,
  stripe_tax_rate_cache,
  logo_url,
  font_family,
  checkout_theme,
  automatic_tax_enabled,
  tax_id_collection_enabled,
  checkout_billing_address,
  checkout_expires_hours,
  checkout_collect_terms,
  terms_of_service_url,
  privacy_policy_url,
  omnibus_enabled,
  custom_settings,
  created_at,
  updated_at
) ON public.shop_config TO anon;
