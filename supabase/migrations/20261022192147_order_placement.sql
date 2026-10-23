-- Shared reservation consumption preserves the existing Stripe completion behavior.
CREATE FUNCTION public._redeem_coupon_for_order(
  coupon_id_param uuid, current_user_id uuid, existing_user_id uuid,
  customer_email_param text, transaction_id_var uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF coupon_id_param IS NOT NULL THEN
      DELETE FROM public.coupon_reservations
      WHERE coupon_id = coupon_id_param
        AND customer_email = customer_email_param
        AND expires_at > NOW();

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No valid coupon reservation found. Coupon may have expired or reached limit.';
      END IF;

      UPDATE public.coupons
      SET current_usage_count = COALESCE(current_usage_count, 0) + 1
      WHERE id = coupon_id_param
        AND is_active = true
        AND (usage_limit_global IS NULL OR COALESCE(current_usage_count, 0) < usage_limit_global);

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Coupon limit reached despite reservation (system error)';
      END IF;

      INSERT INTO public.coupon_redemptions (
        coupon_id, user_id, customer_email, transaction_id, discount_amount
      ) VALUES (
        coupon_id_param,
        COALESCE(current_user_id, existing_user_id),
        customer_email_param,
        transaction_id_var,
        0
      );
    END IF;

END;
$$;
REVOKE ALL ON FUNCTION public._redeem_coupon_for_order(uuid,uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._redeem_coupon_for_order(uuid,uuid,uuid,text,uuid) TO service_role;

CREATE FUNCTION public.place_order(p_order jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  li public.payment_line_items%ROWTYPE;
  product public.products%ROWTYPE;
  entry jsonb;
  saved_lines jsonb := '[]'::jsonb;
  provider text := coalesce(p_order->>'payment_provider', 'stripe');
  main_id uuid := (p_order->>'product_id')::uuid;
  currency_code text := upper(p_order->>'currency');
  factor numeric := public.currency_minor_factor(currency_code);
  offline boolean := provider = 'bank_transfer';
  main_count integer := 0;
  charge numeric := 0;
  net_sum numeric := 0;
  tax_sum numeric := 0;
  basis numeric;
  tax numeric;
  existing_user uuid;
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
  INSERT INTO public.payment_transactions (
    payment_provider, pricing_snapshot_version, product_id, customer_email, user_id,
    session_id, stripe_payment_intent_id, coupon_id, livemode, status, amount, currency,
    order_details, metadata, custom_field_values, expires_at, tax_snapshot_status, net_total, tax_total
  ) VALUES (
    provider, 1, main_id, p_order->>'customer_email', (p_order->>'user_id')::uuid,
    p_order->>'session_id', p_order->>'stripe_payment_intent_id', (p_order->>'coupon_id')::uuid,
    coalesce((p_order->>'livemode')::boolean, false), CASE WHEN offline THEN 'awaiting_payment' ELSE 'pending' END,
    charge, currency_code, p_order->'order_details', coalesce(p_order->'metadata','{}'::jsonb),
    coalesce(p_order->'custom_field_values','{}'::jsonb), (p_order->>'expires_at')::timestamptz,
    CASE WHEN offline THEN 'local' ELSE 'none' END,
    CASE WHEN offline THEN net_sum END, CASE WHEN offline THEN tax_sum END
  ) RETURNING * INTO tx;
  FOR entry IN SELECT value FROM jsonb_array_elements(saved_lines) LOOP
    li := jsonb_populate_record(NULL::public.payment_line_items, entry);
    INSERT INTO public.payment_line_items (
      transaction_id, product_id, item_type, quantity, unit_price, total_price, discounted_total,
      currency, product_name, order_bump_id, access_duration_override, vat_rate, tax_behavior, vat_exempt, net_amount, tax_amount
    ) VALUES (
      tx.id, li.product_id, li.item_type, li.quantity, li.unit_price, li.total_price, li.discounted_total,
      currency_code, li.product_name, li.order_bump_id, li.access_duration_override, li.vat_rate,
      li.tax_behavior, coalesce(li.vat_exempt, false),
      CASE WHEN offline THEN li.net_amount END, CASE WHEN offline THEN li.tax_amount END
    );
  END LOOP;
  IF offline AND tx.coupon_id IS NOT NULL THEN
    SELECT id INTO existing_user FROM auth.users WHERE lower(email) = lower(tx.customer_email) AND email_confirmed_at IS NOT NULL;
    PERFORM public._redeem_coupon_for_order(tx.coupon_id, tx.user_id, existing_user, tx.customer_email, tx.id);
  END IF;
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id, 'order_number', tx.order_number, 'amount', tx.amount);
END;
$$;
REVOKE ALL ON FUNCTION public.place_order(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb,jsonb) TO service_role;

CREATE FUNCTION public.cancel_unpaid_order(p_transaction_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  redeemed uuid;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Cancellation reason required'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider <> 'bank_transfer' THEN RAISE EXCEPTION 'Unpaid transfer required'; END IF;
  IF tx.status = 'cancelled' THEN RETURN jsonb_build_object('success', true, 'already_cancelled', true); END IF;
  IF tx.status <> 'awaiting_payment' THEN RAISE EXCEPTION 'Unpaid transfer required'; END IF;
  FOR redeemed IN DELETE FROM public.coupon_redemptions WHERE transaction_id = tx.id RETURNING coupon_id LOOP
    UPDATE public.coupons SET current_usage_count = greatest(0, current_usage_count - 1) WHERE id = redeemed;
  END LOOP;
  UPDATE public.payment_transactions SET status = 'cancelled', updated_at = now() WHERE id = tx.id;
  PERFORM public.log_admin_action('cancel_unpaid_order', 'payment_transaction', tx.id::text,
    jsonb_build_object('reason', p_reason, 'coupon_id', tx.coupon_id, 'transaction_id', tx.id));
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_unpaid_order(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_order(uuid,text) TO service_role;
