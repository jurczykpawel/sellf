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
-- 1b) Shop country (ISO-3166-1 alpha-2, nullable) — gates Poland-only features
-- ============================================================================
alter table public.shop_config
  add column if not exists country text;

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

-- ============================================================================
-- VAT TAX SNAPSHOT
-- Consolidated into this single pre-release migration (project rule: until a
-- migration reaches prod, all changes since the last release stay in ONE file).
-- Per-line tax frozen at purchase (numbers from Stripe).
--
-- NOTE ON UNITS: the tax amount columns below are in MINOR units (cents/grosze),
-- matching payment_transactions.amount and Stripe. They sit next to
-- payment_line_items.unit_price/total_price which are MAJOR units. Do not mix.
--
-- @see docs/superpowers/specs/2026-06-22-vat-tax-snapshot-design.md
-- @see docs/superpowers/specs/2026-06-22-vat-tax-snapshot-stripe-extraction-research.md
-- ============================================================================

-- payment_line_items: per-line snapshot
ALTER TABLE public.payment_line_items
  ADD COLUMN tax_breakdown     jsonb   NOT NULL DEFAULT '[]'::jsonb, -- full Stripe components
  ADD COLUMN tax_amount        integer,            -- minor units; line.amount_tax
  ADD COLUMN net_amount        integer,            -- minor units; line.amount_subtotal (post-discount)
  ADD COLUMN vat_rate          numeric(5,2),       -- single-component effective %, else NULL (D5)
  ADD COLUMN tax_behavior      text,               -- 'inclusive' | 'exclusive'
  ADD COLUMN vat_exempt        boolean NOT NULL DEFAULT false, -- snapshot of products.vat_exempt
  ADD COLUMN taxability_reason text;               -- Stripe reason (stripe_tax mode)

COMMENT ON COLUMN public.payment_line_items.tax_amount IS 'MINOR units (cents). Unlike unit_price/total_price which are MAJOR units.';
COMMENT ON COLUMN public.payment_line_items.net_amount IS 'MINOR units (cents). Unlike unit_price/total_price which are MAJOR units.';
COMMENT ON COLUMN public.payment_line_items.tax_breakdown IS 'Array of Stripe tax components: {amount,taxableAmount,rate,effectiveRate,inclusive,taxType,jurisdiction,country,state,taxabilityReason}. amount/taxableAmount in MINOR units.';

-- payment_transactions: order-level totals + honesty flag
ALTER TABLE public.payment_transactions
  ADD COLUMN net_total integer,  -- minor units; session.amount_subtotal
  ADD COLUMN tax_total integer,  -- minor units; session.total_details.amount_tax
  ADD COLUMN tax_snapshot_status text NOT NULL DEFAULT 'none';

ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_tax_snapshot_status_chk
  CHECK (tax_snapshot_status IN ('none', 'captured', 'partial', 'unavailable'));

COMMENT ON COLUMN public.payment_transactions.tax_total IS 'MINOR units (cents); matches Stripe total_details.amount_tax verbatim.';
COMMENT ON COLUMN public.payment_transactions.net_total IS 'MINOR units (cents); Stripe amount_subtotal.';
COMMENT ON COLUMN public.payment_transactions.tax_snapshot_status IS 'none = no tax line; captured = full per-line snapshot; partial = totals only (line match failed); unavailable = tax not computable.';

-- products: explicit VAT-exempt status (distinct from rate 0)
ALTER TABLE public.products
  ADD COLUMN vat_exempt      boolean NOT NULL DEFAULT false,
  ADD COLUMN vat_exempt_note text;

COMMENT ON COLUMN public.products.vat_exempt IS 'Product sold VAT-exempt ("zwolniony / zw."), distinct from a 0% rate. Carried into the order tax snapshot.';

-- shop_config: default exempt status for new products
ALTER TABLE public.shop_config
  ADD COLUMN default_vat_exempt boolean;

COMMENT ON COLUMN public.shop_config.default_vat_exempt IS 'Default vat_exempt for newly created products (admin-only; not exposed to anon).';

-- Grants: products.vat_exempt/note must be readable by checkout (like vat_rate).
-- Column-level grant: harmless if products already has table-level SELECT to these
-- roles, required if products uses column-level grants. shop_config.default_vat_exempt
-- is admin-only (read via getMyShopConfig) — NO anon grant. New payment_* columns stay
-- service-role-only (inherit existing table grants).
GRANT SELECT (vat_exempt, vat_exempt_note) ON public.products TO anon, authenticated;
