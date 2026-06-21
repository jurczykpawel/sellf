-- Seller company fields used to generate legal documents (Regulamin/Polityka).
-- These columns are read by the legal-engine API to build document config.
-- RLS: shop_config already has row-level policies ("Admins full access to shop_config"
-- and "Public read access to shop_config") — both are row-level, not column-scoped,
-- so new columns inherit them automatically. No new policies required.
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
