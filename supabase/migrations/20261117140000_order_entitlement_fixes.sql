-- 11.1 order entitlement fixes (W264).
--
-- ===== Bundle components granted per order =====
-- An order of a bundle records the components the bundle held when the order was placed or paid, so
-- a later full refund or dispute acts on exactly what that order granted, also after the seller
-- re-composes or deletes the bundle. Orders created before this migration get the current
-- composition as their record.

CREATE TABLE public.order_bundle_components (
  transaction_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  component_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  bundle_product_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, component_product_id)
);
CREATE INDEX order_bundle_components_component_idx ON public.order_bundle_components(component_product_id);
COMMENT ON TABLE public.order_bundle_components IS
  'Bundle components an order grants, recorded when the order is placed or paid; refunds and disputes act on this set.';
ALTER TABLE public.order_bundle_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_bundle_components FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_bundle_components TO service_role;
CREATE POLICY order_bundle_components_service ON public.order_bundle_components FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

CREATE FUNCTION public.record_order_bundle_components() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.product_id IS NOT NULL AND NEW.status IN ('awaiting_payment', 'completed')
    AND NOT EXISTS (SELECT 1 FROM public.order_bundle_components WHERE transaction_id = NEW.id) THEN
    INSERT INTO public.order_bundle_components (transaction_id, component_product_id, bundle_product_id)
    SELECT NEW.id, b.component_product_id, b.bundle_product_id
    FROM public.bundle_items b JOIN public.products p ON p.id = b.bundle_product_id AND p.is_bundle
    WHERE b.bundle_product_id = NEW.product_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_order_bundle_components() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER record_order_bundle_components AFTER INSERT OR UPDATE OF status ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.record_order_bundle_components();

INSERT INTO public.order_bundle_components (transaction_id, component_product_id, bundle_product_id)
SELECT t.id, b.component_product_id, b.bundle_product_id
FROM public.payment_transactions t
JOIN public.products p ON p.id = t.product_id AND p.is_bundle
JOIN public.bundle_items b ON b.bundle_product_id = t.product_id
WHERE t.status IN ('awaiting_payment', 'completed', 'partially_refunded', 'disputed', 'refunded')
ON CONFLICT DO NOTHING;

-- Components an order granted: its record, or the bundle's current composition for an order that
-- has no record (its bundle had no components when it was paid).
CREATE FUNCTION public.order_granted_components(p_transaction_id uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT component_product_id FROM public.order_bundle_components WHERE transaction_id = p_transaction_id
  UNION
  SELECT b.component_product_id FROM public.payment_transactions t
  JOIN public.bundle_items b ON b.bundle_product_id = t.product_id
  WHERE t.id = p_transaction_id
    AND NOT EXISTS (SELECT 1 FROM public.order_bundle_components o WHERE o.transaction_id = p_transaction_id);
$$;
REVOKE EXECUTE ON FUNCTION public.order_granted_components(uuid) FROM PUBLIC, anon, authenticated;

-- Full refund: removes the bundle-component access this order granted to the buyer, except
-- components the buyer still holds through another live order or an independent grant.
CREATE FUNCTION public.revoke_order_bundle_components(p_transaction_id uuid, p_user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.payment_transactions; removed integer;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.payment_transactions WHERE id = p_transaction_id;
  IF NOT FOUND OR p_user_id IS NULL THEN RETURN 0; END IF;
  DELETE FROM public.user_product_access a
  WHERE a.user_id = p_user_id
    AND a.product_id IN (SELECT public.order_granted_components(t.id))
    AND a.product_id IS DISTINCT FROM t.product_id
    AND a.grant_source = 'bundle'
    AND a.subscription_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_transactions o
      WHERE o.id <> t.id
        AND o.status IN ('awaiting_payment', 'completed', 'partially_refunded', 'disputed')
        AND (o.amount = 0 OR coalesce(o.refunded_amount, 0) < o.amount)
        AND (o.user_id = p_user_id OR EXISTS (
          SELECT 1 FROM public.guest_purchases g
          WHERE g.claimed_by_user_id = p_user_id AND (g.transaction_id = o.id OR (g.transaction_id IS NULL AND g.session_id = o.session_id))))
        AND (o.product_id = a.product_id
          OR EXISTS (SELECT 1 FROM public.payment_line_items l WHERE l.transaction_id = o.id AND l.product_id = a.product_id)
          OR a.product_id IN (SELECT public.order_granted_components(o.id)))
    );
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;
REVOKE EXECUTE ON FUNCTION public.revoke_order_bundle_components(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_order_bundle_components(uuid, uuid) TO service_role;


-- ===== Disputes act on the components the order granted =====
-- Same function as in 20261110235906; only the bundle product set changes: the main bundle's
-- components come from the order's record (order_granted_components) instead of the bundle's
-- current composition.
CREATE OR REPLACE FUNCTION public.apply_payment_dispute_before_guest_claim(p_transaction_id uuid, p_dispute_id text, p_status text, p_closed boolean, p_reason text, p_amount integer, p_currency text, p_created timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  t public.payment_transactions;
  d public.payment_disputes;
  original jsonb; item jsonb; result jsonb; product_ids uuid[]; buyer_ids uuid[];
  stamp timestamptz := now();
  restored_access jsonb := '[]'; term record;
  restored boolean := false; changed integer; entitled boolean; can_restore boolean;
  next_status text; stripe_subscription text;
  license record; restored_license public.issued_licenses; restored_licenses jsonb:='[]'; can_restore_license boolean;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_dispute_id IS NULL OR length(p_dispute_id)>255 OR p_status NOT IN
    ('needs_response','under_review','won','lost','warning_needs_response','warning_under_review','warning_closed')
    OR p_amount<0 OR p_currency IS NULL THEN RAISE EXCEPTION 'Invalid dispute'; END IF;
  SELECT * INTO STRICT t FROM public.payment_transactions WHERE id=p_transaction_id FOR UPDATE;
  IF t.status='pending' THEN RAISE EXCEPTION 'Payment awaiting completion' USING ERRCODE='40001'; END IF;
  SELECT * INTO d FROM public.payment_disputes WHERE stripe_dispute_id=p_dispute_id;
  IF FOUND THEN
    IF d.transaction_id<>t.id THEN RAISE EXCEPTION 'Dispute binding differs'; END IF;
    IF d.closed AND (NOT p_closed OR d.status<>p_status) THEN RETURN NULL; END IF;
    IF d.status=p_status AND d.closed=p_closed THEN RETURN d.payload; END IF;
  ELSE
    SELECT array_agg(DISTINCT id) INTO product_ids FROM (
      SELECT t.product_id id UNION SELECT product_id FROM public.payment_line_items WHERE transaction_id=t.id
      UNION SELECT public.order_granted_components(t.id)
      UNION SELECT b.component_product_id FROM public.bundle_items b JOIN public.payment_line_items l
        ON l.product_id=b.bundle_product_id WHERE l.transaction_id=t.id AND l.product_id IS DISTINCT FROM t.product_id
    ) products;
    SELECT array_agg(DISTINCT id) INTO buyer_ids FROM (
      SELECT t.user_id id UNION SELECT claimed_by_user_id FROM public.guest_purchases
        WHERE session_id=t.session_id OR transaction_id=t.id
    ) buyers WHERE id IS NOT NULL;
    entitled := t.status NOT IN ('refunded','cancelled') AND coalesce(t.refunded_amount,0)<t.amount;
    INSERT INTO public.payment_disputes(stripe_dispute_id,transaction_id,status,previous_payment_status,suspended_at)
      VALUES(p_dispute_id,t.id,p_status,CASE WHEN t.status='disputed' THEN
        CASE WHEN coalesce(t.refunded_amount,0)>0 THEN 'partially_refunded' ELSE 'completed' END ELSE t.status END,stamp)
      RETURNING * INTO d;
    IF entitled AND p_status<>'won' THEN
      FOR license IN SELECT l.id FROM public.issued_licenses l WHERE l.order_id=ANY(public.license_order_references(t)) AND l.revoked_at IS NULL ORDER BY l.id FOR UPDATE
      LOOP
        UPDATE public.issued_licenses l SET revoked_at=stamp,revoked_by_dispute_id=p_dispute_id WHERE l.id=license.id;
        d.revoked_license_ids:=array_append(d.revoked_license_ids,license.id);
      END LOOP;
      UPDATE public.payment_disputes SET revoked_license_ids=d.revoked_license_ids WHERE stripe_dispute_id=p_dispute_id;
      PERFORM set_config('sellf.event_context','{"reason":"stripe_dispute"}',true);
      FOR original IN SELECT to_jsonb(a) FROM public.user_product_access a
        WHERE a.user_id=ANY(buyer_ids) AND a.product_id=ANY(product_ids)
        AND (a.access_expires_at IS NULL OR a.access_expires_at>stamp)
        AND (a.subscription_id IS NULL OR a.subscription_id=t.subscription_id)
        AND (a.transfer_transaction_id IS NULL OR a.transfer_transaction_id=t.id) FOR UPDATE
      LOOP
        d.account_access := d.account_access||jsonb_build_array(original);
        UPDATE public.user_product_access SET access_expires_at=stamp,expiry_notified_at=stamp WHERE id=(original->>'id')::uuid;
      END LOOP;
      WITH removed AS (
        DELETE FROM public.guest_purchases WHERE (session_id=t.session_id OR transaction_id=t.id)
          AND claimed_by_user_id IS NULL RETURNING *
      ) SELECT coalesce(jsonb_agg(jsonb_set(to_jsonb(removed),'{metadata}',coalesce(removed.metadata,'{}')||
        jsonb_build_object('_dispute_access_terms',coalesce(removed.metadata->'_dispute_access_terms',(
          SELECT jsonb_object_agg(p.id::text,jsonb_build_object('grantedAt',removed.created_at,'expiresAt',
            CASE WHEN coalesce((SELECT l.access_duration_override FROM public.payment_line_items l
              WHERE l.transaction_id=t.id AND l.product_id=p.id LIMIT 1),p.auto_grant_duration_days) IS NULL THEN NULL
            ELSE removed.created_at+make_interval(days=>coalesce((SELECT l.access_duration_override FROM public.payment_line_items l
              WHERE l.transaction_id=t.id AND l.product_id=p.id LIMIT 1),p.auto_grant_duration_days)) END))
          FROM public.products p WHERE p.id=ANY(product_ids)
        ))))),'[]') INTO d.guest_access FROM removed;
      UPDATE public.payment_disputes SET account_access=d.account_access,guest_access=d.guest_access WHERE stripe_dispute_id=p_dispute_id;
    END IF;
  END IF;

  next_status := t.status;
  IF p_status='won' THEN
    next_status := CASE WHEN t.status IN ('refunded','cancelled') THEN t.status
      WHEN coalesce(t.refunded_amount,0)>=t.amount THEN 'refunded'
      WHEN coalesce(t.refunded_amount,0)>0 THEN 'partially_refunded'
      ELSE d.previous_payment_status END;
    can_restore := next_status IN ('completed','partially_refunded') AND NOT EXISTS(
      SELECT 1 FROM public.payment_disputes other WHERE other.transaction_id=t.id AND other.stripe_dispute_id<>p_dispute_id AND other.status<>'won');
    can_restore_license:=can_restore;
    IF can_restore_license THEN
      PERFORM l.id FROM public.issued_licenses l WHERE l.order_id=ANY(public.license_order_references(t)) ORDER BY l.id FOR UPDATE;
      FOR license IN SELECT l.id FROM public.issued_licenses l WHERE l.id=ANY(d.revoked_license_ids)
        AND l.revoked_by_dispute_id=p_dispute_id AND l.revoked_at IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM public.issued_licenses other WHERE other.original_seller_id=l.original_seller_id
          AND other.order_id=l.order_id AND other.revoked_at IS NOT NULL AND other.revoked_by_dispute_id IS DISTINCT FROM p_dispute_id)
        ORDER BY l.id FOR UPDATE
      LOOP
        UPDATE public.issued_licenses l SET revoked_at=NULL,revoked_by_dispute_id=NULL WHERE l.id=license.id RETURNING l.* INTO restored_license;
        restored_licenses:=restored_licenses||jsonb_build_array(public.license_event_snapshot(restored_license));
      END LOOP;
    END IF;
    IF t.subscription_id IS NOT NULL THEN
      can_restore := can_restore AND EXISTS(SELECT 1 FROM public.subscriptions s WHERE s.id=t.subscription_id
        AND s.status IN ('active','trialing','past_due') AND (s.current_period_end IS NULL OR s.current_period_end>stamp));
    END IF;
    IF can_restore THEN
      PERFORM set_config('sellf.event_context','{"reason":"dispute_won"}',true);
      FOR item IN SELECT value FROM jsonb_array_elements(d.account_access) LOOP
        IF item->>'access_expires_at' IS NULL OR (item->>'access_expires_at')::timestamptz>stamp THEN
          UPDATE public.user_product_access SET access_expires_at=(item->>'access_expires_at')::timestamptz,
            expiry_notified_at=(item->>'expiry_notified_at')::timestamptz
            WHERE id=(item->>'id')::uuid AND access_expires_at=d.suspended_at
              AND user_id=(item->>'user_id')::uuid AND product_id=(item->>'product_id')::uuid
              AND subscription_id IS NOT DISTINCT FROM (item->>'subscription_id')::uuid
              AND access_duration_days IS NOT DISTINCT FROM (item->>'access_duration_days')::integer;
          GET DIAGNOSTICS changed=ROW_COUNT; restored := restored OR changed>0;
          IF changed>0 THEN restored_access:=restored_access||jsonb_build_array(jsonb_build_object(
            'productId',item->'product_id','userId',item->'user_id','grantedAt',item->'access_granted_at','expiresAt',item->'access_expires_at')); END IF;
        END IF;
      END LOOP;
      FOR item IN SELECT value FROM jsonb_array_elements(d.guest_access) LOOP
        IF EXISTS(SELECT 1 FROM jsonb_each(item->'metadata'->'_dispute_access_terms') saved
          WHERE saved.value->>'expiresAt' IS NULL OR (saved.value->>'expiresAt')::timestamptz>stamp) THEN
          INSERT INTO public.guest_purchases SELECT (jsonb_populate_record(NULL::public.guest_purchases,item)).*
            ON CONFLICT DO NOTHING;
          GET DIAGNOSTICS changed=ROW_COUNT; restored := restored OR changed>0;
          IF changed>0 THEN
            FOR term IN SELECT * FROM jsonb_each(item->'metadata'->'_dispute_access_terms') LOOP
              IF term.value->>'expiresAt' IS NULL OR (term.value->>'expiresAt')::timestamptz>stamp THEN
                restored_access:=restored_access||jsonb_build_array(jsonb_build_object('productId',term.key,'userId',NULL,
                  'guestPurchaseId',item->'id','grantedAt',term.value->'grantedAt','expiresAt',term.value->'expiresAt'));
              END IF;
            END LOOP;
          END IF;
        END IF;
      END LOOP;
    END IF;
  ELSIF t.status NOT IN ('refunded','cancelled') THEN next_status := 'disputed';
  END IF;
  UPDATE public.payment_transactions SET status=next_status,updated_at=stamp,
    metadata=coalesce(metadata,'{}')||jsonb_build_object('dispute_id',p_dispute_id,'dispute_reason',p_reason,
      'dispute_status',p_status,'dispute_created',p_created)
    WHERE id=t.id;
  SELECT stripe_subscription_id INTO stripe_subscription FROM public.subscriptions WHERE id=t.subscription_id;
  result := jsonb_build_object(
    'customer',jsonb_build_object('email',t.customer_email,'userId',t.user_id),
    'product',jsonb_build_object('id',t.product_id),
    'payment',jsonb_build_object('id',t.id,'amount',t.amount,'currency',t.currency,'sessionId',t.session_id,
      'paymentIntentId',t.stripe_payment_intent_id,'stripeInvoiceId',t.stripe_invoice_id,'subscriptionId',t.subscription_id,
      'statusBefore',t.status,'statusAfter',next_status),
    'dispute',jsonb_build_object('stripeDisputeId',p_dispute_id,'status',p_status,'reason',p_reason,'amount',p_amount,
      'currency',upper(p_currency),'createdAt',p_created,'accessRevoked',p_status<>'won','accessRestored',restored,
      'licenseRestored',jsonb_array_length(restored_licenses)>0,'restoredLicenses',restored_licenses,'restoredAccess',restored_access));
  IF t.subscription_id IS NOT NULL THEN result:=result||jsonb_build_object('subscription',jsonb_build_object(
    'id',t.subscription_id,'stripeSubscriptionId',stripe_subscription)); END IF;
  UPDATE public.payment_disputes SET status=p_status,closed=p_closed,payload=result WHERE stripe_dispute_id=p_dispute_id;
  PERFORM set_config('sellf.event_context','',true);
  RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.apply_payment_dispute_before_guest_claim(uuid,text,text,boolean,text,integer,text,timestamptz) FROM PUBLIC, anon, authenticated, service_role;


-- ===== Coupon checks hold a limited slot only when the payment starts =====
-- verify_coupon gains reserve_param (default true): storefront preview checks pass false, so only
-- the server paths that create or update a payment session reserve a slot. The function is called
-- by the server only (service role); the storefront roles lose EXECUTE.
DROP FUNCTION public.verify_coupon(text, uuid, text, text);
DROP FUNCTION public._reserve_coupon(uuid, uuid, text, text);

CREATE FUNCTION public._reserve_coupon(coupon_id_param uuid, product_id_param uuid, customer_email_param text, currency_param text, reserve_param boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  coupon_record RECORD;
  user_usage_count INTEGER; reserved_count INTEGER; available_slots INTEGER;
  existing_reservation_id UUID;
  clean_email TEXT;
BEGIN
  IF customer_email_param IS NOT NULL THEN
    clean_email := lower(trim(customer_email_param));
    IF clean_email ~ '[^[:print:]]' THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Invalid email format');
    END IF;
    IF clean_email = '' OR clean_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Invalid email');
    END IF;
  ELSE
    clean_email := NULL;
  END IF;
  SELECT * INTO coupon_record
  FROM public.coupons
  WHERE id = coupon_id_param
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid code');
  END IF;
  DELETE FROM public.coupon_reservations
  WHERE coupon_id = coupon_id_param AND expires_at < NOW();
  IF coupon_record.discount_type IN ('fixed', 'set_price') AND coupon_record.currency IS NOT NULL AND upper(coupon_record.currency) != upper(currency_param) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Code invalid for this currency');
  END IF;
  IF jsonb_array_length(coupon_record.allowed_product_ids) > 0 THEN
    IF NOT (coupon_record.allowed_product_ids @> to_jsonb(product_id_param)) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code not valid for this product');
    END IF;
  END IF;
  IF jsonb_array_length(coupon_record.allowed_emails) > 0 THEN
    IF clean_email IS NULL OR NOT (coupon_record.allowed_emails @> to_jsonb(clean_email)) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code not authorized for this email');
    END IF;
  END IF;
  IF clean_email IS NOT NULL THEN
    SELECT COUNT(*) INTO user_usage_count
    FROM public.coupon_redemptions
    WHERE coupon_id = coupon_record.id AND customer_email = clean_email;
    IF user_usage_count >= coupon_record.usage_limit_per_user THEN
      RETURN jsonb_build_object('valid', false, 'error', 'You have already used this code');
    END IF;
  END IF;
  IF clean_email IS NOT NULL THEN
    SELECT id INTO existing_reservation_id
    FROM public.coupon_reservations
    WHERE coupon_id = coupon_record.id
      AND customer_email = clean_email
      AND expires_at > NOW();
    IF existing_reservation_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'valid', true, 'id', coupon_record.id,
        'code', coupon_record.code, 'discount_type', coupon_record.discount_type,
        'discount_value', coupon_record.discount_value, 'exclude_order_bumps', coupon_record.exclude_order_bumps,
        'allowed_product_ids', coupon_record.allowed_product_ids, 'already_reserved', true,
        'reservation_id', existing_reservation_id
      );
    END IF;
  END IF;
  IF coupon_record.usage_limit_global IS NOT NULL THEN
    SELECT COUNT(*) INTO reserved_count
    FROM public.coupon_reservations
    WHERE coupon_id = coupon_record.id AND expires_at > NOW();
    available_slots := coupon_record.usage_limit_global
                     - coupon_record.current_usage_count
                     - reserved_count;
    IF available_slots <= 0 THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code usage limit reached');
    END IF;
  END IF;
  IF clean_email IS NOT NULL AND reserve_param THEN
    INSERT INTO public.coupon_reservations (coupon_id, customer_email, expires_at)
    VALUES (coupon_record.id, clean_email, NOW() + INTERVAL '15 minutes')
    ON CONFLICT (coupon_id, customer_email) DO UPDATE
    SET expires_at = NOW() + INTERVAL '15 minutes',
        reserved_at = NOW();
  END IF;
  RETURN jsonb_build_object(
    'valid', true, 'id', coupon_record.id,
    'code', coupon_record.code, 'discount_type', coupon_record.discount_type,
    'discount_value', coupon_record.discount_value, 'exclude_order_bumps', coupon_record.exclude_order_bumps,
    'allowed_product_ids', coupon_record.allowed_product_ids, 'reserved', reserve_param,
    'expires_in_minutes', CASE WHEN reserve_param THEN 15 END
  );
END;
$_$;
REVOKE EXECUTE ON FUNCTION public._reserve_coupon(uuid, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reserve_coupon(uuid, uuid, text, text, boolean) TO service_role;

CREATE FUNCTION public.verify_coupon(code_param text, product_id_param uuid, customer_email_param text DEFAULT NULL::text, currency_param text DEFAULT 'USD'::text, reserve_param boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  coupon_record public.coupons%ROWTYPE;
  clean_email text := lower(trim(customer_email_param));
BEGIN
  IF code_param IS NOT NULL AND length(code_param) > 0 THEN
    IF NOT public.check_rate_limit(
      'verify_coupon', 5, 60,
      'code:' || lower(left(code_param, 80)) || ':' ||
        COALESCE((select auth.uid())::text, clean_email, 'anonymous')
    ) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Too many attempts. Please try again later.');
    END IF;
  END IF;
  IF NOT public.check_rate_limit('verify_coupon', 100, 60) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Too many attempts. Please try again later.');
  END IF;
  SELECT * INTO coupon_record
  FROM public.coupons
  WHERE code = code_param AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid code');
  END IF;
  IF coupon_record.expires_at IS NOT NULL AND coupon_record.expires_at < NOW() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Code expired');
  END IF;
  IF coupon_record.starts_at > NOW() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Code not active yet');
  END IF;
  RETURN public._reserve_coupon(coupon_record.id, product_id_param, customer_email_param, currency_param, reserve_param);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verify_coupon(text, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_coupon(text, uuid, text, text, boolean) TO service_role;

-- ===== Mail retry queue: license mails first, a re-sent link keeps its attempts =====
-- Refused license mails are claimed ahead of post-payment links. Re-sending a post-payment link
-- whose retries ran out puts it back with its attempt count and a fresh wait, so it is not due at
-- once with a full set of attempts; a repeated license grant still starts over (unchanged).
CREATE OR REPLACE FUNCTION public.claim_auth_mail_retries(p_limit integer DEFAULT 20)
RETURNS SETOF public.auth_mail_retries LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- A purged license mail was never delivered: dropping its receipt lets a repeated grant send it again.
  WITH purged AS (
    DELETE FROM public.auth_mail_retries WHERE given_up_at < now() - interval '7 days' RETURNING license_mail_key
  )
  DELETE FROM public.license_mail_receipts r USING purged p WHERE r.mail_key = p.license_mail_key;
  RETURN QUERY
  UPDATE public.auth_mail_retries r SET attempts = r.attempts + 1, next_attempt_at = now() + interval '10 minutes'
  WHERE r.id IN (SELECT q.id FROM public.auth_mail_retries q WHERE q.given_up_at IS NULL AND q.next_attempt_at <= now()
    ORDER BY (q.kind = 'license') DESC, q.next_attempt_at LIMIT least(greatest(coalesce(p_limit, 20), 1), 100) FOR UPDATE SKIP LOCKED)
  RETURNING r.*;
END $$;
REVOKE EXECUTE ON FUNCTION public.claim_auth_mail_retries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_auth_mail_retries(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_auth_mail_retry(p_email text, p_redirect_to text, p_data jsonb, p_kind text, p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.auth_mail_retries(email, redirect_to, data, kind, next_attempt_at, last_error)
  VALUES (lower(btrim(p_email)), p_redirect_to, coalesce(p_data, '{}'::jsonb), p_kind, now() + interval '2 minutes', left(p_error, 40))
  ON CONFLICT (email, redirect_to) DO UPDATE SET data = CASE WHEN public.auth_mail_retries.kind='license' AND EXCLUDED.kind='post_checkout' THEN public.auth_mail_retries.data ELSE EXCLUDED.data END,
    kind = CASE WHEN public.auth_mail_retries.kind='license' THEN 'license' ELSE EXCLUDED.kind END, last_error = EXCLUDED.last_error,
    given_up_at = NULL,
    attempts = CASE WHEN public.auth_mail_retries.given_up_at IS NULL THEN public.auth_mail_retries.attempts
      WHEN public.auth_mail_retries.kind = 'post_checkout' AND EXCLUDED.kind = 'post_checkout' THEN public.auth_mail_retries.attempts
      ELSE 0 END,
    next_attempt_at = CASE WHEN public.auth_mail_retries.given_up_at IS NULL THEN public.auth_mail_retries.next_attempt_at
      ELSE greatest(public.auth_mail_retries.next_attempt_at, EXCLUDED.next_attempt_at) END;
$$;
REVOKE EXECUTE ON FUNCTION public.queue_auth_mail_retry(text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_auth_mail_retry(text, text, jsonb, text, text) TO service_role;

-- ===== An ended subscription stays ended =====
-- Stripe never reopens a canceled or expired subscription. A subscription event handled
-- concurrently with the cancellation may still carry an older, active snapshot: it must not
-- reopen the stored row, and it must not grant access through the ended subscription.
CREATE FUNCTION public.keep_ended_subscription_ended() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status IN ('canceled', 'incomplete_expired') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.keep_ended_subscription_ended() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER keep_ended_subscription_ended BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.keep_ended_subscription_ended();

CREATE FUNCTION public.refuse_access_from_ended_subscription() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.subscription_id IS NOT NULL AND NEW.access_expires_at IS NULL
    AND (TG_OP = 'INSERT' OR OLD.subscription_id IS DISTINCT FROM NEW.subscription_id)
    AND EXISTS (SELECT 1 FROM public.subscriptions s
      WHERE s.id = NEW.subscription_id AND s.status IN ('canceled', 'incomplete_expired')) THEN
    IF TG_OP = 'INSERT' THEN RETURN NULL; END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.refuse_access_from_ended_subscription() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER refuse_access_from_ended_subscription BEFORE INSERT OR UPDATE OF subscription_id, access_expires_at
  ON public.user_product_access FOR EACH ROW EXECUTE FUNCTION public.refuse_access_from_ended_subscription();
