-- Preserve completion while recording missing required checkout modules.
-- @see admin-panel/src/lib/checkout-modules/registry.ts
CREATE OR REPLACE FUNCTION public.mark_checkout_details_missing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  profile jsonb;
  module jsonb;
  details jsonb := coalesce(NEW.order_details, '{}'::jsonb);
  missing boolean := false;
  missing_modules jsonb := '[]'::jsonb;
BEGIN
  SELECT checkout_profile INTO profile FROM public.products WHERE id = NEW.product_id;
  IF profile IS NULL THEN
    IF NEW.order_details ? 'details_missing' OR NEW.order_details ? 'missing_modules' THEN
      NEW.order_details := NEW.order_details - 'details_missing' - 'missing_modules';
    END IF;
    RETURN NEW;
  END IF;
  FOR module IN SELECT value FROM jsonb_array_elements(profile->'modules') LOOP
    missing := false;
    CASE module->>'id'
      WHEN 'buyer' THEN
        missing := missing OR coalesce(jsonb_typeof(details->'buyer') <> 'object'
          OR details->'buyer'->>'type' NOT IN ('person', 'organization'), true);
      WHEN 'recipient' THEN
        IF details->'buyer'->>'type' = 'organization' THEN
          missing := missing OR coalesce(jsonb_typeof(details->'recipient'->'differs') <> 'boolean', true);
        END IF;
      WHEN 'quantity' THEN
        missing := missing OR coalesce(jsonb_typeof(details->'quantity'->'value') <> 'number', true);
      WHEN 'phone' THEN
        IF (module->>'required')::boolean THEN
          missing := missing OR coalesce(length(details->'phone'->>'value'), 0) = 0;
        END IF;
      WHEN 'participants' THEN
        IF (module->>'required')::boolean THEN
          missing := missing OR coalesce(jsonb_typeof(details->'participants'->'people') <> 'array', true);
          IF jsonb_typeof(details->'participants'->'people') = 'array' THEN
            missing := missing OR jsonb_array_length(details->'participants'->'people') = 0;
          END IF;
        END IF;
      ELSE NULL;
    END CASE;
    IF missing THEN missing_modules := missing_modules || jsonb_build_array(module->>'id'); END IF;
  END LOOP;
  NEW.order_details := details - 'details_missing' - 'missing_modules';
  IF jsonb_array_length(missing_modules) > 0 THEN
    NEW.order_details := NEW.order_details || jsonb_build_object('details_missing', true, 'missing_modules', missing_modules);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_checkout_details_missing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_checkout_details_missing() TO service_role;
DROP TRIGGER checkout_details_on_completion ON public.payment_transactions;
CREATE TRIGGER checkout_details_on_completion
  BEFORE INSERT OR UPDATE OF status, order_details ON public.payment_transactions
  FOR EACH ROW WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.mark_checkout_details_missing();

-- Reconcile already completed orders, including participant lists saved before this release.
UPDATE public.payment_transactions t SET order_details = coalesce(t.order_details, '{}'::jsonb)
WHERE t.status = 'completed' AND (t.order_details->'details_missing' = 'true'::jsonb
  OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = t.product_id AND p.checkout_profile IS NOT NULL));
