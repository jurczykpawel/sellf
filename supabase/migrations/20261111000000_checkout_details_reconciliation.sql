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

-- Release 11.1: custom field values and the MERGED order details are saved in ONE transaction.
-- The pending row is locked and the merged JSON (order_details || p_details) is measured before the
-- write; an over-limit result raises details_too_large (54000) and saves nothing, custom fields included.
-- p_custom_field_values NULL keeps the stored values. The trailing parameter has a default, so the
-- five-argument named call keeps working.
-- @see admin-panel/src/app/api/update-payment-metadata/route.ts
DROP FUNCTION public.set_payment_order_details(jsonb, uuid, integer, text, text);
CREATE FUNCTION public.set_payment_order_details(
  p_details jsonb, p_product_id uuid, p_quantity integer,
  p_session_id text DEFAULT NULL, p_payment_intent_id text DEFAULT NULL,
  p_custom_field_values jsonb DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions; v_quantity integer; v_merged jsonb;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object'
     OR p_product_id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 100
     OR (p_session_id IS NULL) = (p_payment_intent_id IS NULL)
     OR (p_custom_field_values IS NOT NULL AND jsonb_typeof(p_custom_field_values) <> 'object') THEN
    RAISE EXCEPTION 'Invalid order details' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO tx FROM public.payment_transactions
    WHERE (session_id = p_session_id OR stripe_payment_intent_id = p_payment_intent_id)
      AND product_id = p_product_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT quantity INTO v_quantity FROM public.payment_line_items
    WHERE transaction_id = tx.id AND product_id = p_product_id AND item_type = 'main_product';
  IF v_quantity IS DISTINCT FROM p_quantity THEN RETURN -1; END IF;
  v_merged := coalesce(tx.order_details, '{}'::jsonb) || p_details;
  -- Same measure as the payment_transactions_order_details_check constraint.
  IF octet_length(v_merged::text) > 65536 THEN
    RAISE EXCEPTION 'details_too_large' USING ERRCODE = '54000';
  END IF;
  UPDATE public.payment_transactions
  SET order_details = v_merged,
      custom_field_values = coalesce(p_custom_field_values, custom_field_values),
      updated_at = now()
  WHERE id = tx.id;
  RETURN 1;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_payment_order_details(jsonb, uuid, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_order_details(jsonb, uuid, integer, text, text, jsonb) TO service_role;
