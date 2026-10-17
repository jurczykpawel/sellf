-- Shop defaults store fractional rates; product rates use percentage points.
CREATE OR REPLACE FUNCTION public.apply_shop_vat_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tax_rate numeric;
  v_vat_exempt boolean;
  v_exempt_note text;
BEGIN
  SELECT tax_rate, is_vat_exempt, vat_exempt_note
    INTO v_tax_rate, v_vat_exempt, v_exempt_note
    FROM public.shop_config
    ORDER BY created_at
    LIMIT 1;

  IF NEW.vat_rate IS NULL AND NEW.vat_exempt = false THEN
    IF v_vat_exempt THEN
      NEW.vat_exempt := true;
    ELSIF v_tax_rate IS NOT NULL THEN
      NEW.vat_rate := v_tax_rate * 100;
    END IF;
  END IF;

  IF NEW.vat_exempt = true AND NEW.vat_exempt_note IS NULL THEN
    NEW.vat_exempt_note := v_exempt_note;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_shop_vat_defaults() FROM anon, authenticated, PUBLIC;
