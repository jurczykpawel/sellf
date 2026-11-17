-- W219: a cart change on an open Stripe checkout updates the same Checkout Session, so the saved
-- order snapshot (the webhook validates the payment against it) must follow the new cart in place.
--
-- 1. public._price_order_lines: line validation and pricing extracted unchanged from
--    public._place_order_without_event, so placing and replacing an order share one rule set.
-- 2. public._place_order_without_event: same behaviour, now pricing through the helper.
-- 3. public.replace_pending_order: replaces the lines, amount, coupon and context of a pending
--    Stripe order of the same product and buyer, atomically; events (seat holds) are excluded.
-- @see admin-panel/src/app/api/create-payment-intent/route.ts
-- @see admin-panel/src/lib/orders/place-order.ts

CREATE FUNCTION public._price_order_lines(p_order jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  li public.payment_line_items%ROWTYPE;
  product public.products%ROWTYPE;
  entry jsonb;
  saved_lines jsonb := '[]'::jsonb;
  provider text := coalesce(p_order->>'payment_provider', 'stripe');
  main_id uuid := (p_order->>'product_id')::uuid;
  currency_code text := upper(p_order->>'currency');
  factor numeric := public.currency_minor_factor(currency_code);
  main_count integer := 0;
  charge numeric := 0;
  net_sum numeric := 0;
  tax_sum numeric := 0;
  basis numeric;
  tax numeric;
BEGIN
  IF jsonb_typeof(p_order) IS DISTINCT FROM 'object' OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
    OR octet_length(p_order::text) > 65536 OR octet_length(p_lines::text) > 131072 THEN
    RAISE EXCEPTION 'Invalid order payload' USING ERRCODE = '22023';
  END IF;
  IF provider NOT IN ('stripe','bank_transfer') OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 21 THEN
    RAISE EXCEPTION 'Invalid order provider or line count' USING ERRCODE = '22023';
  END IF;
  -- Validate all bindings and compute the payable amount before storing any rows.
  FOR entry IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid line'; END IF;
    li := jsonb_populate_record(NULL::public.payment_line_items, entry);
    SELECT * INTO product FROM public.products WHERE id = li.product_id AND is_active FOR SHARE;
    IF NOT FOUND OR upper(product.currency) IS DISTINCT FROM currency_code
      OR upper(li.currency) IS DISTINCT FROM currency_code THEN RAISE EXCEPTION 'Invalid line product or currency'; END IF;
    IF li.quantity IS NULL OR li.quantity NOT BETWEEN 1 AND 100
      OR li.unit_price IS NULL OR li.unit_price NOT BETWEEN 0 AND 99999999
      OR li.total_price IS DISTINCT FROM li.unit_price * li.quantity
      OR li.discounted_total IS NULL OR li.discounted_total NOT BETWEEN 0 AND 99999999
      OR li.discounted_total * factor <> round(li.discounted_total * factor)
      OR li.unit_price * factor <> round(li.unit_price * factor)
      OR (li.vat_rate IS NOT NULL AND li.vat_rate NOT BETWEEN 0 AND 100)
      OR (li.tax_behavior IS NOT NULL AND li.tax_behavior NOT IN ('inclusive','exclusive')) THEN
      RAISE EXCEPTION 'Invalid line pricing';
    END IF;
    IF li.item_type = 'main_product' AND li.product_id = main_id AND li.order_bump_id IS NULL THEN
      main_count := main_count + 1;
    ELSIF li.item_type = 'order_bump' AND li.quantity = 1 AND EXISTS (
      SELECT 1 FROM public.order_bumps ob WHERE ob.id = li.order_bump_id
        AND ob.main_product_id = main_id AND ob.bump_product_id = li.product_id AND ob.is_active
    ) THEN NULL;
    ELSE RAISE EXCEPTION 'Invalid order line binding'; END IF;
    basis := round(li.discounted_total * factor);
    tax := CASE WHEN coalesce(li.vat_exempt, false) OR coalesce(li.vat_rate, 0) = 0 OR li.tax_behavior IS NULL THEN 0
      WHEN li.tax_behavior = 'inclusive' THEN round(basis * li.vat_rate / (100 + li.vat_rate))
      ELSE round(basis * li.vat_rate / 100) END;
    charge := charge + basis + CASE WHEN li.tax_behavior = 'exclusive' THEN tax ELSE 0 END;
    net_sum := net_sum + basis - CASE WHEN li.tax_behavior = 'inclusive' THEN tax ELSE 0 END;
    tax_sum := tax_sum + tax;
    li.net_amount := basis - CASE WHEN li.tax_behavior = 'inclusive' THEN tax ELSE 0 END;
    li.tax_amount := tax;
    saved_lines := saved_lines || jsonb_build_array(to_jsonb(li));
  END LOOP;
  IF main_count <> 1 THEN RAISE EXCEPTION 'Exactly one main product is required'; END IF;
  RETURN jsonb_build_object('lines', saved_lines, 'charge', charge, 'net_sum', net_sum, 'tax_sum', tax_sum);
END;
$$;
REVOKE EXECUTE ON FUNCTION public._price_order_lines(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Stores priced lines for an order; line net/tax are kept only for offline (locally taxed) orders.
CREATE FUNCTION public._insert_order_lines(p_transaction_id uuid, p_currency text, p_lines jsonb, p_offline boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  li public.payment_line_items%ROWTYPE;
  entry jsonb;
BEGIN
  FOR entry IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    li := jsonb_populate_record(NULL::public.payment_line_items, entry);
    INSERT INTO public.payment_line_items (
      transaction_id, product_id, item_type, quantity, unit_price, total_price, discounted_total,
      currency, product_name, order_bump_id, access_duration_override, vat_rate, tax_behavior, vat_exempt, net_amount, tax_amount
    ) VALUES (
      p_transaction_id, li.product_id, li.item_type, li.quantity, li.unit_price, li.total_price, li.discounted_total,
      p_currency, li.product_name, li.order_bump_id, li.access_duration_override, li.vat_rate,
      li.tax_behavior, coalesce(li.vat_exempt, false),
      CASE WHEN p_offline THEN li.net_amount END, CASE WHEN p_offline THEN li.tax_amount END
    );
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._insert_order_lines(uuid,text,jsonb,boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._place_order_without_event(p_order jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  priced jsonb;
  provider text := coalesce(p_order->>'payment_provider', 'stripe');
  main_id uuid := (p_order->>'product_id')::uuid;
  currency_code text := upper(p_order->>'currency');
  offline boolean := provider = 'bank_transfer';
  existing_user uuid;
BEGIN
  priced := public._price_order_lines(p_order, p_lines);
  INSERT INTO public.payment_transactions (
    payment_provider, pricing_snapshot_version, product_id, customer_email, user_id,
    session_id, stripe_payment_intent_id, coupon_id, livemode, status, amount, currency,
    order_details, metadata, custom_field_values, expires_at, tax_snapshot_status, net_total, tax_total
  ) VALUES (
    provider, 1, main_id, p_order->>'customer_email', (p_order->>'user_id')::uuid,
    p_order->>'session_id', p_order->>'stripe_payment_intent_id', (p_order->>'coupon_id')::uuid,
    coalesce((p_order->>'livemode')::boolean, false), CASE WHEN offline THEN 'awaiting_payment' ELSE 'pending' END,
    (priced->>'charge')::numeric, currency_code, p_order->'order_details', coalesce(p_order->'metadata','{}'::jsonb),
    coalesce(p_order->'custom_field_values','{}'::jsonb), (p_order->>'expires_at')::timestamptz,
    CASE WHEN offline THEN 'local' ELSE 'none' END,
    CASE WHEN offline THEN (priced->>'net_sum')::numeric END, CASE WHEN offline THEN (priced->>'tax_sum')::numeric END
  ) RETURNING * INTO tx;
  PERFORM public._insert_order_lines(tx.id, currency_code, priced->'lines', offline);
  IF offline AND tx.coupon_id IS NOT NULL THEN
    SELECT id INTO existing_user FROM auth.users WHERE lower(email) = lower(tx.customer_email) AND email_confirmed_at IS NOT NULL;
    PERFORM public._redeem_coupon_for_order(tx.coupon_id, tx.user_id, existing_user, tx.customer_email, tx.id);
  END IF;
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id, 'order_number', tx.order_number, 'amount', tx.amount);
END;
$$;
REVOKE EXECUTE ON FUNCTION public._place_order_without_event(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.replace_pending_order(p_order jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  priced jsonb;
BEGIN
  IF jsonb_typeof(p_order) IS DISTINCT FROM 'object' OR coalesce(p_order->>'payment_provider', 'stripe') <> 'stripe'
    OR coalesce(p_order->>'session_id', '') = '' THEN
    RAISE EXCEPTION 'Invalid order payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE session_id = p_order->>'session_id' FOR UPDATE;
  -- Only an unpaid online order of the same product, buyer and currency; event orders hold seats
  -- for the ordered quantity and are placed again instead.
  IF NOT FOUND OR tx.status <> 'pending' OR tx.payment_provider <> 'stripe'
    OR tx.product_id IS DISTINCT FROM (p_order->>'product_id')::uuid
    OR tx.user_id IS DISTINCT FROM (p_order->>'user_id')::uuid
    OR lower(tx.customer_email) IS DISTINCT FROM lower(trim(p_order->>'customer_email'))
    OR upper(tx.currency) IS DISTINCT FROM upper(p_order->>'currency')
    OR EXISTS (SELECT 1 FROM public.products WHERE id = tx.product_id AND event_mode)
    OR EXISTS (SELECT 1 FROM public.seat_reservations WHERE transaction_id = tx.id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_replaceable');
  END IF;
  priced := public._price_order_lines(p_order, p_lines);
  DELETE FROM public.payment_line_items WHERE transaction_id = tx.id;
  PERFORM public._insert_order_lines(tx.id, upper(tx.currency), priced->'lines', false);
  UPDATE public.payment_transactions SET
    amount = (priced->>'charge')::numeric,
    coupon_id = (p_order->>'coupon_id')::uuid,
    metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_order->'metadata', '{}'::jsonb),
    custom_field_values = coalesce(p_order->'custom_field_values', custom_field_values),
    updated_at = now()
  WHERE id = tx.id;
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id, 'amount', (priced->>'charge')::numeric);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.replace_pending_order(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_pending_order(jsonb,jsonb) TO service_role;
