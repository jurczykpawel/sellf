-- Legal document generation feature (Sellf x legal-engine).
-- Single migration for the whole feature: (1) seller company fields on shop_config,
-- (2) column-level anon SELECT so the new seller-PII fields are admin-only,
-- (3) the public `legal` Storage bucket for generated Terms/Privacy HTML.

-- ============================================================================
-- 1) Seller company fields (read by the legal-engine API to build doc config)
-- ============================================================================
alter table public.shop_config
  add column if not exists legal_form text check (legal_form in ('jdg','spzoo','fundacja','osoba_fizyczna')),
  add column if not exists company_legal_name text,
  add column if not exists nip text,
  add column if not exists regon text,
  add column if not exists krs text,
  add column if not exists company_street text,
  add column if not exists company_building_no text,
  add column if not exists company_flat_no text,
  add column if not exists company_city text,
  add column if not exists company_postal text,
  add column if not exists company_phone text,
  add column if not exists complaints_email text,
  add column if not exists is_vat_exempt boolean not null default false,
  add column if not exists is_micro_enterprise boolean not null default false,
  add column if not exists has_dpo boolean not null default false,
  add column if not exists dpo_contact text;

-- ============================================================================
-- 2) Restrict anon SELECT to public-safe columns (seller PII = admin-only)
-- ============================================================================
-- shop_config already had a blanket GRANT SELECT ... TO anon (20250103000000_features.sql)
-- + a "Public read access" row policy USING (true). With the new PII columns that would
-- make NIP/REGON/KRS/address/phone/DPO world-readable via PostgREST. Switch anon to a
-- column-level grant covering only what the public storefront needs.
--
-- contact_email IS public — it's the shop's intentionally-public contact, already shown
-- to anonymous visitors on the "Coming Soon" page; NOT seller PII.
-- Excluded (admin-only): legal_form, company_legal_name, nip, regon, krs, company_street,
-- company_building_no, company_flat_no, company_city, company_postal, company_phone,
-- complaints_email, is_vat_exempt, is_micro_enterprise, has_dpo, dpo_contact.
--
-- NOTE: the app-side getShopConfig() (shop-config.ts) selects this exact column list via
-- the anon client (NOT select('*'), which column-level grants would deny). Keep the SQL
-- grant list and SHOP_CONFIG_PUBLIC_COLUMNS in sync.
REVOKE SELECT ON public.shop_config FROM anon;

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
  updated_at,
  contact_email
) ON public.shop_config TO anon;

-- ============================================================================
-- 3) Public `legal` Storage bucket for generated Terms/Privacy HTML
-- ============================================================================
-- Path layout (enforced by lib/legal/storage.ts):
--   {shopId}/terms.html, {shopId}/privacy.html  (current, stable public URLs)
--   {shopId}/terms/archive/..., {shopId}/privacy/archive/...  (frozen previous versions)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('legal', 'legal', true, 5242880, array['text/html', 'text/plain'])
on conflict (id) do nothing;

-- service_role (admin client) may upload/overwrite/delete; anyone may read (public bucket).
create policy "legal_bucket_service_role_all"
  on storage.objects for all to service_role
  using (bucket_id = 'legal') with check (bucket_id = 'legal');

create policy "legal_bucket_public_read"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'legal');
