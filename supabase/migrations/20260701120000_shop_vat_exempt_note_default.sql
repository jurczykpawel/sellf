-- Shop-level default VAT exemption note ("Podstawa zwolnienia", e.g. "art. 113
-- ust. 1"). Mirrors the existing shop_config.tax_rate -> products.vat_rate
-- default: sellers whose whole shop is VAT-exempt were retyping the same
-- exemption basis on every product. This column lets them set it once.
--
-- Admin-only (mirrors is_vat_exempt): NOT added to the anon column-level GRANT
-- in 20260621000000_legal_docs_vat_tax_and_payment_rpc.sql, and NOT added to
-- SHOP_CONFIG_PUBLIC_COLUMNS (admin-panel/src/lib/shop-config-columns.ts) —
-- both must stay in sync per that migration's own comment.
alter table public.shop_config
  add column if not exists vat_exempt_note text;

-- Extend the existing BEFORE INSERT trigger (20260625010000) so a new product
-- also inherits the shop's default exemption note, not just the exemption
-- flag itself. Only fills when the caller gave no explicit note (NULL) — an
-- explicit note (including '') is never overridden. Verbatim copy of the
-- prior definition plus the note branch.
CREATE OR REPLACE FUNCTION public.apply_shop_vat_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tax_rate    numeric;
  v_vat_exempt  boolean;
  v_exempt_note text;
BEGIN
  -- Single unconditional lookup — both defaulting rules below read from it.
  SELECT tax_rate, is_vat_exempt, vat_exempt_note
    INTO v_tax_rate, v_vat_exempt, v_exempt_note
    FROM public.shop_config
    ORDER BY created_at
    LIMIT 1;

  -- Only fill when the caller expressed no VAT stance. "Unspecified" == the
  -- column defaults: vat_rate IS NULL AND vat_exempt = false. An explicit rate
  -- or an explicit exemption is therefore never overridden.
  IF NEW.vat_rate IS NULL AND NEW.vat_exempt = false THEN
    IF v_vat_exempt THEN
      NEW.vat_exempt := true;        -- shop is VAT-exempt → product is "zw." by default
    ELSIF v_tax_rate IS NOT NULL THEN
      NEW.vat_rate := v_tax_rate;    -- otherwise copy the shop's default rate
    END IF;
  END IF;

  -- Independent of the branch above: a caller may pass vat_exempt=true
  -- explicitly (skipping that block) without a note. Fill the note from the
  -- shop default whenever the product ends up exempt and the caller gave none.
  IF NEW.vat_exempt = true AND NEW.vat_exempt_note IS NULL THEN
    NEW.vat_exempt_note := v_exempt_note;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_shop_vat_defaults() FROM anon, authenticated, PUBLIC;

-- Scope `authenticated` SELECT on shop_config to the same public column subset
-- as anon (20260621000000). The blanket grant from 20250103000000 was broader
-- than the app needs: public reads use the anon client + explicit column list,
-- admin reads go through service_role. Keep this list in sync with
-- SHOP_CONFIG_PUBLIC_COLUMNS (admin-panel/src/lib/shop-config-columns.ts).
REVOKE SELECT ON public.shop_config FROM authenticated;
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
  created_at,
  updated_at,
  contact_email
) ON public.shop_config TO authenticated;
