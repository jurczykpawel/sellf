-- New products inherit the shop's VAT stance (default rate + "zwolniony / zw."
-- exemption) regardless of how they are created — admin UI, public v1 API, or
-- direct SQL. The server is the single source of truth for the default; the
-- wizard's client-side seeding is no longer the only mechanism (UI + API parity).
--
-- This implements the intent already documented in 20260621000000:
--   "Default for new products inherits shop_config.is_vat_exempt."

CREATE OR REPLACE FUNCTION public.apply_shop_vat_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tax_rate   numeric;
  v_vat_exempt boolean;
BEGIN
  -- Only fill when the caller expressed no VAT stance. "Unspecified" == the
  -- column defaults: vat_rate IS NULL AND vat_exempt = false. An explicit rate
  -- or an explicit exemption is therefore never overridden.
  IF NEW.vat_rate IS NULL AND NEW.vat_exempt = false THEN
    SELECT tax_rate, is_vat_exempt
      INTO v_tax_rate, v_vat_exempt
      FROM public.shop_config
      ORDER BY created_at
      LIMIT 1;

    IF v_vat_exempt THEN
      NEW.vat_exempt := true;        -- shop is VAT-exempt → product is "zw." by default
    ELSIF v_tax_rate IS NOT NULL THEN
      NEW.vat_rate := v_tax_rate;    -- otherwise copy the shop's default rate
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger functions are fired by the DML itself, not called directly, so the
-- triggering role needs no EXECUTE privilege — lock it down (security rule #7).
REVOKE EXECUTE ON FUNCTION public.apply_shop_vat_defaults() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS products_apply_shop_vat_defaults ON public.products;
CREATE TRIGGER products_apply_shop_vat_defaults
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_shop_vat_defaults();
