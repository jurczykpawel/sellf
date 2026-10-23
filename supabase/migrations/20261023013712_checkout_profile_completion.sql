-- Preserve completion while recording missing required checkout modules.
-- @see admin-panel/src/lib/checkout-modules/registry.ts
CREATE FUNCTION public.mark_checkout_details_missing()
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
BEGIN
  SELECT checkout_profile INTO profile FROM public.products WHERE id = NEW.product_id;
  IF profile IS NULL THEN RETURN NEW; END IF;
  FOR module IN SELECT value FROM jsonb_array_elements(profile->'modules') LOOP
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
  END LOOP;
  IF missing THEN
    NEW.order_details := details || '{"details_missing":true}'::jsonb;
    RAISE LOG '[checkout] Required order details missing for transaction %', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_checkout_details_missing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_checkout_details_missing() TO service_role;
CREATE TRIGGER checkout_details_on_completion
  BEFORE INSERT OR UPDATE OF status ON public.payment_transactions
  FOR EACH ROW WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.mark_checkout_details_missing();
