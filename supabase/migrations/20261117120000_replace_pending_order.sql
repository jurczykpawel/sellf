-- W219/W219b: a cart change on an open Stripe checkout updates the same Checkout Session. A paid
-- payment must always settle, whatever the order of the cart change, the Stripe update and the
-- payment, so every cart the session may carry is kept as a numbered version until the order is
-- paid, and the payment settles against the version Stripe actually charged (session metadata
-- `sellf_cart_version`, written in the same Stripe call as the line items).
--
-- 1. public._price_order_lines: line validation and pricing extracted unchanged from
--    public._place_order_without_event, so placing and updating an order share one rule set.
-- 2. public._place_order_without_event: same behaviour, now pricing through the helper.
-- 3. public.checkout_cart_versions: the carts of one pending order (service role only). Version 1
--    is the cart the order was placed with; a row in state 'updating' younger than 60 seconds is
--    the single in-flight update of that session (a second one is refused, the browser retries).
-- 4. public.begin_pending_order_update / finish_pending_order_update: store the new cart and lock
--    the session before the Stripe call; make it the saved order only after Stripe confirmed it.
--    An unconfirmed or failed update keeps the saved order and every version.
-- 5. public.process_stripe_payment_completion_with_bump: new cart_version_param; the paid version
--    becomes the saved order before the usual amount, coupon and line checks run.
-- @see admin-panel/src/app/api/create-payment-intent/route.ts
-- @see admin-panel/src/lib/stripe/checkout-session-update.ts
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

-- ===== 3. Cart versions of a pending order =====
CREATE TABLE public.checkout_cart_versions (
  transaction_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 100),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  amount numeric NOT NULL CHECK (amount >= 0),
  coupon_id uuid REFERENCES public.coupons(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL CHECK (state IN ('placed', 'updating', 'unconfirmed', 'applied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, version)
);
CREATE INDEX idx_checkout_cart_versions_coupon ON public.checkout_cart_versions (coupon_id) WHERE coupon_id IS NOT NULL;
ALTER TABLE public.checkout_cart_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.checkout_cart_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admin read" ON public.checkout_cart_versions
  FOR SELECT TO authenticated USING ((select public.is_admin()));
REVOKE ALL ON public.checkout_cart_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.checkout_cart_versions TO authenticated;
GRANT ALL ON public.checkout_cart_versions TO service_role;

-- Makes a stored version the saved order: its lines, amount, coupon and cart metadata. The buyer's
-- answers (custom field values, buyer details) are not part of a cart; whatever the form saved last
-- stays on the order whichever version is paid.
CREATE FUNCTION public._apply_cart_version(p_transaction_id uuid, p_version integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ver public.checkout_cart_versions%ROWTYPE;
BEGIN
  SELECT * INTO STRICT ver FROM public.checkout_cart_versions
    WHERE transaction_id = p_transaction_id AND version = p_version;
  DELETE FROM public.payment_line_items WHERE transaction_id = p_transaction_id;
  PERFORM public._insert_order_lines(p_transaction_id,
    (SELECT upper(currency) FROM public.payment_transactions WHERE id = p_transaction_id), ver.lines, false);
  UPDATE public.payment_transactions SET
    amount = ver.amount,
    coupon_id = ver.coupon_id,
    metadata = coalesce(metadata, '{}'::jsonb) || ver.metadata,
    updated_at = now()
  WHERE id = p_transaction_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._apply_cart_version(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;

-- ===== 4. Update of an open session: begin before the Stripe call, finish after it =====
CREATE FUNCTION public.begin_pending_order_update(p_order jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  priced jsonb;
  next_version integer;
  base_metadata jsonb;
BEGIN
  IF jsonb_typeof(p_order) IS DISTINCT FROM 'object' OR coalesce(p_order->>'payment_provider', 'stripe') <> 'stripe'
    OR coalesce(p_order->>'session_id', '') = '' THEN
    RAISE EXCEPTION 'Invalid order payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE session_id = p_order->>'session_id' FOR UPDATE;
  -- Only an unpaid online order of the same product, buyer and currency; event orders hold seats
  -- for the ordered quantity and get a new session instead.
  IF NOT FOUND OR tx.status <> 'pending' OR tx.payment_provider <> 'stripe'
    OR tx.product_id IS DISTINCT FROM (p_order->>'product_id')::uuid
    OR tx.user_id IS DISTINCT FROM (p_order->>'user_id')::uuid
    OR lower(tx.customer_email) IS DISTINCT FROM lower(trim(p_order->>'customer_email'))
    OR upper(tx.currency) IS DISTINCT FROM upper(p_order->>'currency')
    OR EXISTS (SELECT 1 FROM public.products WHERE id = tx.product_id AND event_mode)
    OR EXISTS (SELECT 1 FROM public.seat_reservations WHERE transaction_id = tx.id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_replaceable');
  END IF;
  IF EXISTS (SELECT 1 FROM public.checkout_cart_versions WHERE transaction_id = tx.id
    AND state = 'updating' AND created_at > now() - interval '60 seconds') THEN
    RETURN jsonb_build_object('success', false, 'error', 'update_in_progress');
  END IF;
  -- An update that never finished: Stripe may or may not carry it, so it stays payable.
  UPDATE public.checkout_cart_versions SET state = 'unconfirmed' WHERE transaction_id = tx.id AND state = 'updating';
  priced := public._price_order_lines(p_order, p_lines);
  IF NOT EXISTS (SELECT 1 FROM public.checkout_cart_versions WHERE transaction_id = tx.id) THEN
    INSERT INTO public.checkout_cart_versions (transaction_id, version, lines, amount, coupon_id, metadata, state)
    SELECT tx.id, 1, coalesce(jsonb_agg(to_jsonb(li)), '[]'::jsonb), tx.amount, tx.coupon_id,
      coalesce(tx.metadata, '{}'::jsonb), 'placed'
    FROM public.payment_line_items li WHERE li.transaction_id = tx.id;
  END IF;
  SELECT max(version) + 1, (array_agg(metadata ORDER BY version))[1] INTO next_version, base_metadata
    FROM public.checkout_cart_versions WHERE transaction_id = tx.id;
  IF next_version > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_replaceable');
  END IF;
  INSERT INTO public.checkout_cart_versions (transaction_id, version, lines, amount, coupon_id, metadata, state)
  VALUES (tx.id, next_version, priced->'lines', (priced->>'charge')::numeric, (p_order->>'coupon_id')::uuid,
    base_metadata || coalesce(p_order->'metadata', '{}'::jsonb), 'updating');
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id, 'version', next_version, 'amount', (priced->>'charge')::numeric);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.begin_pending_order_update(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_pending_order_update(jsonb,jsonb) TO service_role;

-- p_confirmed: Stripe answered with this version's metadata and the cart's subtotal. Only then the
-- version becomes the saved order and the reservation of a coupon it dropped is released (the old
-- cart can no longer be paid). Otherwise the saved order stays and the version stays payable.
CREATE FUNCTION public.finish_pending_order_update(p_session_id text, p_version integer, p_confirmed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  ver public.checkout_cart_versions%ROWTYPE;
BEGIN
  SELECT * INTO tx FROM public.payment_transactions WHERE session_id = p_session_id FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO ver FROM public.checkout_cart_versions WHERE transaction_id = tx.id AND version = p_version;
  END IF;
  IF ver.transaction_id IS NULL OR ver.state <> 'updating' THEN
    RETURN jsonb_build_object('success', false, 'error', 'update_not_in_progress');
  END IF;
  IF NOT coalesce(p_confirmed, false) OR tx.status <> 'pending' THEN
    UPDATE public.checkout_cart_versions SET state = 'unconfirmed' WHERE transaction_id = tx.id AND version = p_version;
    RETURN jsonb_build_object('success', false, 'error', 'update_not_confirmed');
  END IF;
  PERFORM public._apply_cart_version(tx.id, p_version);
  UPDATE public.checkout_cart_versions SET state = 'applied' WHERE transaction_id = tx.id AND version = p_version;
  IF tx.coupon_id IS NOT NULL AND tx.coupon_id IS DISTINCT FROM ver.coupon_id THEN
    DELETE FROM public.coupon_reservations
      WHERE coupon_id = tx.coupon_id AND customer_email = lower(trim(tx.customer_email));
  END IF;
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id, 'version', p_version);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finish_pending_order_update(text,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_pending_order_update(text,integer,boolean) TO service_role;

-- ===== 5. Completion settles the cart version Stripe charged =====
DROP FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric,boolean);
CREATE FUNCTION public.process_stripe_payment_completion_with_bump(
  session_id_param text, product_id_param uuid, customer_email_param text,
  amount_total numeric, currency_param text,
  stripe_payment_intent_id text DEFAULT NULL, user_id_param uuid DEFAULT NULL,
  bump_product_ids_param uuid[] DEFAULT NULL, coupon_id_param uuid DEFAULT NULL,
  amount_subtotal_param numeric DEFAULT NULL,
  allow_inactive_product_param boolean DEFAULT false,
  cart_version_param integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  pi_param text := stripe_payment_intent_id;
  tx public.payment_transactions%ROWTYPE;
  result jsonb;
  full_bumps uuid[];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(coalesce(pi_param, session_id_param)));
  SELECT pt.* INTO tx FROM public.payment_transactions pt
    WHERE pt.session_id = session_id_param OR (pi_param IS NOT NULL AND pt.stripe_payment_intent_id = pi_param)
    ORDER BY (pt.session_id = session_id_param) DESC LIMIT 1 FOR UPDATE;

  IF tx.id IS NOT NULL THEN
    IF tx.payment_provider <> 'stripe'
       OR tx.product_id IS DISTINCT FROM product_id_param
       OR upper(tx.currency) IS DISTINCT FROM upper(currency_param)
       OR (tx.stripe_payment_intent_id IS NOT NULL AND tx.stripe_payment_intent_id IS DISTINCT FROM pi_param)
       OR (tx.session_id LIKE 'cs_%' AND session_id_param LIKE 'cs_%' AND tx.session_id <> session_id_param)
       OR tx.status NOT IN ('pending', 'abandoned', 'completed')
       OR (tx.status = 'completed' AND (tx.amount IS DISTINCT FROM amount_total OR lower(tx.customer_email) IS DISTINCT FROM lower(trim(customer_email_param))))
    THEN
      RETURN jsonb_build_object('success', false, 'error', 'Order details do not match', 'error_kind', 'data');
    END IF;
    IF EXISTS (SELECT 1 FROM public.payment_transactions pt
      WHERE pt.id <> tx.id AND (pt.session_id = session_id_param OR pt.stripe_payment_intent_id = pi_param)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Order records need review', 'error_kind', 'data');
    END IF;
    -- The cart Stripe charged (no version in the session metadata = the cart the order was placed with).
    IF tx.status IN ('pending', 'abandoned') AND EXISTS (SELECT 1 FROM public.checkout_cart_versions v
      WHERE v.transaction_id = tx.id AND v.version = coalesce(cart_version_param, 1)) THEN
      PERFORM public._apply_cart_version(tx.id, coalesce(cart_version_param, 1));
      SELECT pt.* INTO tx FROM public.payment_transactions pt WHERE pt.id = tx.id;
    END IF;
    IF tx.session_id LIKE 'cs_%' THEN session_id_param := tx.session_id; END IF;
    IF jsonb_typeof(tx.metadata->'bump_product_ids_full') = 'array' THEN
      SELECT array_agg(value::uuid) INTO full_bumps
        FROM jsonb_array_elements_text(tx.metadata->'bump_product_ids_full');
      IF coalesce(cardinality(full_bumps), 0) > coalesce(cardinality(bump_product_ids_param), 0) THEN
        bump_product_ids_param := full_bumps;
      END IF;
    END IF;
  END IF;

  -- Attach the order and complete it within one savepoint.
  BEGIN
    IF tx.id IS NOT NULL THEN
      UPDATE public.payment_transactions SET
        stripe_payment_intent_id = coalesce(pi_param, tx.stripe_payment_intent_id),
        session_id = session_id_param,
        status = CASE WHEN status = 'abandoned' THEN 'pending' ELSE status END,
        amount = CASE WHEN status IN ('pending', 'abandoned') THEN amount_total ELSE amount END,
        currency = upper(currency_param)
      WHERE id = tx.id;
      IF tx.session_id <> session_id_param THEN
        UPDATE public.guest_purchases SET session_id = session_id_param
        WHERE session_id = tx.session_id AND product_id = tx.product_id;
      END IF;
    END IF;
    result := public._process_stripe_payment_completion_with_bump_impl(
      session_id_param, product_id_param, lower(trim(customer_email_param)), amount_total,
      currency_param, pi_param, user_id_param, bump_product_ids_param, coupon_id_param, amount_subtotal_param,
      allow_inactive_product_param
    );
    IF NOT coalesce((result->>'success')::boolean, false) THEN
      RAISE EXCEPTION USING MESSAGE = 'Completion not accepted', DETAIL = result::text;
    END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Completion not accepted' THEN
      GET STACKED DIAGNOSTICS result = PG_EXCEPTION_DETAIL;
      RETURN result::jsonb || jsonb_build_object('error_kind', CASE WHEN result->>'error' = 'Rate limit exceeded' OR result->>'code' IN ('40001','40P01','57014') THEN 'transient' ELSE 'data' END);
    END IF;
    RAISE;
  END;

  SELECT pt.* INTO tx FROM public.payment_transactions pt WHERE pt.session_id = session_id_param;
  IF result->>'message' = 'Payment already processed (idempotent)'
     OR result->>'scenario' = 'idempotent_claimed_for_logged_in_user' THEN
    result := result || jsonb_build_object('already_had_access', true);
  END IF;
  RETURN result || jsonb_build_object('transaction_id', tx.id, 'session_id', tx.session_id,
    'bump_product_ids', coalesce(bump_product_ids_param, '{}'::uuid[]),
    'pricing_source', CASE WHEN tx.pricing_snapshot_version IS NULL THEN 'legacy' ELSE 'snapshot' END);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric,boolean,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric,boolean,integer) TO service_role;
