-- Traditional transfer configuration and transaction provenance.
CREATE TABLE public.bank_transfer_config (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  bank_transfer_enabled boolean NOT NULL DEFAULT false,
  bank_account_holder text NOT NULL DEFAULT '', bank_account_number text NOT NULL DEFAULT '', bank_name text NOT NULL DEFAULT '',
  bank_transfer_title_template text NOT NULL DEFAULT 'Zamówienie {order_number}',
  bank_transfer_due_days integer NOT NULL DEFAULT 14 CHECK(bank_transfer_due_days BETWEEN 1 AND 60),
  bank_transfer_grant_access_on_placement boolean NOT NULL DEFAULT true,
  bank_transfer_max_unpaid_per_email integer NOT NULL DEFAULT 3 CHECK(bank_transfer_max_unpaid_per_email BETWEEN 1 AND 100),
  CHECK(length(bank_account_holder)<=200 AND length(bank_name)<=200 AND length(bank_transfer_title_template)<=200),
  CHECK(position('{order_number}' in bank_transfer_title_template)>0),
  CHECK(NOT bank_transfer_enabled OR (length(btrim(bank_account_holder))>0 AND bank_account_number ~ '^PL[0-9]{26}$'))
);
ALTER TABLE public.bank_transfer_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_transfer_config FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.bank_transfer_config TO authenticated;
GRANT ALL ON public.bank_transfer_config TO service_role;
CREATE POLICY bank_transfer_admin ON public.bank_transfer_config FOR SELECT TO authenticated USING((select public.is_admin()));
INSERT INTO public.bank_transfer_config(id) VALUES(true);
ALTER TABLE public.payment_transactions ADD COLUMN payment_due_at timestamptz, ADD COLUMN paid_at timestamptz,
  ADD COLUMN transfer_details jsonb, ADD COLUMN order_placed_notified_at timestamptz,
  ADD COLUMN order_cancelled_notified_at timestamptz, ADD COLUMN order_overdue_notified_at timestamptz;
CREATE INDEX bank_transfer_due_idx ON public.payment_transactions(payment_due_at) WHERE status='awaiting_payment';
ALTER TABLE public.user_product_access ADD COLUMN transfer_transaction_id uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL;
CREATE INDEX transfer_access_idx ON public.user_product_access(transfer_transaction_id) WHERE transfer_transaction_id IS NOT NULL;
ALTER TABLE public.seat_reservations DROP CONSTRAINT seat_reservations_check;
CREATE OR REPLACE FUNCTION public.event_availability(p_product_id uuid, p_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
WITH sessions AS (
  SELECT s.*, greatest(0, s.capacity - coalesce((SELECT sum(r.quantity) FROM public.seat_reservations r
    WHERE r.session_id = s.id AND (r.status = 'confirmed' OR (r.status = 'held' AND (r.expires_at IS NULL OR r.expires_at > p_at)))),0)) remaining_count
  FROM public.product_sessions s WHERE s.product_id = p_product_id
), tiers AS (
  SELECT t.*, CASE WHEN t.seats IS NULL THEN NULL ELSE greatest(0, t.seats - coalesce((SELECT sum(r.quantity)
    FROM public.seat_reservations r WHERE r.tier_id = t.id
    AND (r.status = 'confirmed' OR (r.status = 'held' AND (r.expires_at IS NULL OR r.expires_at > p_at)))),0)) END tier_remaining
  FROM public.product_price_tiers t JOIN sessions s ON s.id = t.session_id
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'timezone', s.timezone,
  'title', s.title, 'venue', s.venue, 'extra_days', s.extra_days,
  'remaining', CASE WHEN s.capacity IS NULL THEN NULL ELSE s.remaining_count END,
  'sold_out', (s.capacity IS NOT NULL AND s.remaining_count = 0) OR
    (EXISTS (SELECT 1 FROM tiers t WHERE t.session_id=s.id) AND NOT EXISTS (
      SELECT 1 FROM tiers t WHERE t.session_id=s.id AND (t.tier_remaining IS NULL OR t.tier_remaining > 0))),
  'current_tier', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'label', c.label,
    'price', c.price, 'seats_left', c.tier_remaining, 'ends_at', c.sale_ends_at) END,
  'current_tier_seats_left', c.tier_remaining, 'current_tier_ends_at', c.sale_ends_at,
  'cheaper_sold_out', EXISTS (SELECT 1 FROM tiers t WHERE t.session_id=s.id AND t.price < c.price
    AND (t.tier_remaining = 0 OR t.sale_ends_at <= p_at)),
  'next_tier_price', (SELECT t.price FROM tiers t WHERE t.session_id=s.id
    AND (t.price, t.sort) > (c.price, c.sort) ORDER BY t.price, t.sort LIMIT 1)
) ORDER BY s.sort, s.starts_at, s.id), '[]'::jsonb)
FROM sessions s LEFT JOIN LATERAL (
  SELECT t.* FROM tiers t WHERE t.session_id=s.id AND s.sales_open AND s.starts_at > p_at
    AND (s.capacity IS NULL OR s.remaining_count > 0) AND (t.tier_remaining IS NULL OR t.tier_remaining > 0)
    AND (t.sale_ends_at IS NULL OR t.sale_ends_at > p_at) ORDER BY t.price, t.sort LIMIT 1
) c ON true;
$$;
REVOKE ALL ON FUNCTION public.event_availability(uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_availability(uuid,timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.event_hold_limits(p_session_id uuid, p_email text, p_ip text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT count(*) FILTER (WHERE lower(t.customer_email)=lower(p_email)) < 3
  AND count(*) FILTER (WHERE t.metadata->>'event_ip'=p_ip) < 5
FROM public.seat_reservations r JOIN public.payment_transactions t ON t.id=r.transaction_id
WHERE r.session_id=p_session_id AND r.status='held' AND (r.expires_at IS NULL OR r.expires_at > now());
$$;
REVOKE ALL ON FUNCTION public.event_hold_limits(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_hold_limits(uuid,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.place_order(p_order jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  event boolean; sid uuid; selected jsonb; tier jsonb; main jsonb; result jsonb;
  deadline timestamptz; q integer; txid uuid;
BEGIN
  SELECT event_mode INTO event FROM public.products WHERE id=(p_order->>'product_id')::uuid FOR SHARE;
  IF NOT coalesce(event,false) THEN RETURN public._place_order_without_event(p_order,p_lines); END IF;
  SELECT value INTO main FROM jsonb_array_elements(p_lines) WHERE value->>'item_type'='main_product';
  sid := (main->>'session_id')::uuid; q := (main->>'quantity')::integer;
  IF sid IS NULL OR q IS NULL OR q NOT BETWEEN 1 AND 100 OR coalesce(p_order->>'customer_email','')='' THEN
    RAISE EXCEPTION 'Invalid event order' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(sid::text, 0));
  IF NOT public.event_hold_limits(sid,p_order->>'customer_email',p_order->'metadata'->>'event_ip') THEN
    RAISE EXCEPTION 'event_hold_limit' USING ERRCODE='P0429';
  END IF;
  SELECT value INTO selected FROM jsonb_array_elements(public.event_availability((p_order->>'product_id')::uuid))
    WHERE value->>'id'=sid::text;
  tier := selected->'current_tier';
  IF tier IS NULL OR tier='null'::jsonb OR (selected->>'remaining')::integer < q
    OR (tier->>'seats_left')::integer < q THEN RAISE EXCEPTION 'sold_out' USING ERRCODE='P0409'; END IF;
  IF (main->>'unit_price')::numeric IS DISTINCT FROM (tier->>'price')::numeric THEN
    RAISE EXCEPTION 'event_price_changed' USING ERRCODE='P0409';
  END IF;
  deadline := coalesce((p_order->>'expires_at')::timestamptz, now()+interval '30 minutes');
  IF deadline <= now() OR deadline > now()+interval '31 minutes' THEN RAISE EXCEPTION 'Invalid event expiry'; END IF;
  IF p_order->>'payment_provider'='bank_transfer' THEN deadline:=NULL; END IF;
  p_order := jsonb_set(p_order,'{expires_at}',coalesce(to_jsonb(deadline),'null'::jsonb));
  result := public._place_order_without_event(p_order,p_lines); txid := (result->>'transaction_id')::uuid;
  UPDATE public.payment_line_items SET session_id=sid, tier_id=(tier->>'id')::uuid,
    session_label=selected->>'title', session_starts_at=(selected->>'starts_at')::timestamptz
    WHERE transaction_id=txid AND item_type='main_product';
  INSERT INTO public.seat_reservations(session_id,tier_id,transaction_id,quantity,status,expires_at)
    VALUES (sid,(tier->>'id')::uuid,txid,q,'held',deadline);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.place_order(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.confirm_event_order(p_transaction_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE li public.payment_line_items%ROWTYPE; r public.seat_reservations%ROWTYPE;
  available integer; tier_available integer; s public.product_sessions%ROWTYPE; tier public.product_price_tiers%ROWTYPE;
BEGIN
  FOR li IN SELECT * FROM public.payment_line_items WHERE transaction_id=p_transaction_id AND session_id IS NOT NULL ORDER BY session_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(li.session_id::text,0));
    SELECT * INTO r FROM public.seat_reservations WHERE transaction_id=p_transaction_id FOR UPDATE;
    IF r.status='confirmed' THEN CONTINUE; END IF;
    IF r.status='held' AND (r.expires_at IS NULL OR r.expires_at>now()) THEN
      UPDATE public.seat_reservations SET status='confirmed',confirmed_at=now() WHERE id=r.id;
      CONTINUE;
    END IF;
    SELECT * INTO s FROM public.product_sessions WHERE id=li.session_id;
    SELECT * INTO tier FROM public.product_price_tiers WHERE id=li.tier_id;
    SELECT s.capacity-coalesce(sum(quantity),0) INTO available FROM public.seat_reservations
      WHERE session_id=li.session_id AND transaction_id<>p_transaction_id
        AND (status='confirmed' OR (status='held' AND (expires_at IS NULL OR expires_at>now())));
    SELECT tier.seats-coalesce(sum(quantity),0) INTO tier_available FROM public.seat_reservations
      WHERE tier_id=li.tier_id AND transaction_id<>p_transaction_id
        AND (status='confirmed' OR (status='held' AND (expires_at IS NULL OR expires_at>now())));
    IF (s.capacity IS NOT NULL AND available<li.quantity) OR (tier.seats IS NOT NULL AND tier_available<li.quantity) THEN
      UPDATE public.payment_transactions SET metadata=coalesce(metadata,'{}'::jsonb)||'{"oversold":true}'::jsonb WHERE id=p_transaction_id;
      UPDATE public.seat_reservations SET status='released',released_at=now() WHERE id=r.id;
      INSERT INTO public.audit_log(table_name,operation,new_values) VALUES ('payment_transactions','UPDATE',
        jsonb_build_object('action','event.oversold','transaction_id',p_transaction_id,'session_id',li.session_id));
      RAISE LOG 'event.oversold transaction=% session=%',p_transaction_id,li.session_id;
    ELSE
      INSERT INTO public.seat_reservations(session_id,tier_id,transaction_id,quantity,status,confirmed_at)
        VALUES (li.session_id,li.tier_id,p_transaction_id,li.quantity,'confirmed',now())
        ON CONFLICT (transaction_id) DO UPDATE SET status='confirmed',confirmed_at=now(),released_at=NULL;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.confirm_event_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_event_order(uuid) TO service_role;
CREATE FUNCTION public.transfer_access_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE txid uuid := nullif(current_setting('sellf.transfer_order',true),'')::uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.transfer_transaction_id IS DISTINCT FROM OLD.transfer_transaction_id THEN RETURN NEW; END IF;
  IF txid IS NOT NULL AND EXISTS(SELECT 1 FROM public.payment_transactions WHERE id=txid AND status='awaiting_payment') THEN
    IF TG_OP='UPDATE' AND (OLD.access_expires_at IS NULL OR OLD.access_expires_at>now()) THEN RETURN OLD; END IF;
    NEW.transfer_transaction_id:=txid;
  ELSE NEW.transfer_transaction_id:=NULL; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.transfer_access_source() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER transfer_access_source BEFORE INSERT OR UPDATE ON public.user_product_access FOR EACH ROW EXECUTE FUNCTION public.transfer_access_source();
CREATE OR REPLACE FUNCTION public.claim_guest_purchases_for_user(p_user_id uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='30s' AS $$
DECLARE email text; claim record; bump record; result jsonb; claimed integer:=0;
BEGIN
  IF NOT public.check_rate_limit('claim_guest_purchases_for_user',10,3600) THEN
    RETURN json_build_object('success',false,'error','Rate limit exceeded. Please wait before trying again.'); END IF;
  SELECT u.email INTO email FROM auth.users u WHERE u.id=p_user_id AND email_confirmed_at IS NOT NULL;
  IF email IS NULL OR NOT public.validate_email_format(email) THEN RETURN json_build_object('success',false,'error','User not found'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext(email));
  FOR claim IN SELECT gp.id, gp.product_id, gp.session_id, pt.id as transaction_id,pt.product_id main_product_id
    FROM public.guest_purchases gp LEFT JOIN public.payment_transactions pt ON pt.id=gp.transaction_id
      OR (gp.transaction_id IS NULL AND pt.session_id=gp.session_id)
    WHERE gp.customer_email=email AND gp.claimed_by_user_id IS NULL FOR UPDATE OF gp SKIP LOCKED LOOP
    BEGIN
      PERFORM set_config('sellf.transfer_order',coalesce(claim.transaction_id::text,''),true);
      UPDATE public.guest_purchases SET claimed_by_user_id=p_user_id,claimed_at=now() WHERE id=claim.id;
      result:=public.grant_product_and_bundle_components(p_user_id,claim.product_id);
      IF (result->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Access grant failed'; END IF;
      claimed:=claimed+1;
      UPDATE public.payment_transactions SET user_id=p_user_id,updated_at=now()
        WHERE id=claim.transaction_id AND user_id IS NULL AND lower(customer_email)=lower(email);
      IF claim.product_id=claim.main_product_id THEN
        FOR bump IN SELECT product_id,access_duration_override FROM public.payment_line_items
          WHERE transaction_id=claim.transaction_id AND item_type='order_bump' LOOP
          PERFORM public.grant_product_access_service_role(p_user_id,bump.product_id,override_duration_days_param=>bump.access_duration_override);
          claimed:=claimed+1;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_admin_action('guest_claim_grant_failure','guest_purchases',claim.id::text,
        jsonb_build_object('user_id',p_user_id,'product_id',claim.product_id,'transaction_id',claim.transaction_id));
    END;
    PERFORM set_config('sellf.transfer_order','',true);
  END LOOP;
  RETURN json_build_object('success',true,'claimed_count',claimed,'user_email',email);
END $$;
REVOKE ALL ON FUNCTION public.claim_guest_purchases_for_user(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_purchases_for_user(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public._order_grant_and_record(p_transaction_id uuid,p_user_id uuid,p_existing_user_id uuid,
  p_requested_user_id uuid,p_coupon_id uuid,p_coupon_mode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; line record; bumps integer;
BEGIN
  SELECT * INTO STRICT tx FROM public.payment_transactions WHERE id=p_transaction_id;
  PERFORM public.confirm_event_order(tx.id);
  SELECT count(*) INTO bumps FROM public.payment_line_items WHERE transaction_id=tx.id AND item_type='order_bump';
  IF p_coupon_mode IS NULL OR p_coupon_mode NOT IN ('consume_reservation','already_redeemed','none')
    OR (p_coupon_mode='none' AND p_coupon_id IS NOT NULL) THEN RAISE EXCEPTION 'Invalid coupon mode'; END IF;
  IF p_coupon_mode='consume_reservation' THEN
    PERFORM public._redeem_coupon_for_order(p_coupon_id,p_user_id,p_existing_user_id,tx.customer_email,tx.id);
  ELSIF p_coupon_mode='already_redeemed' AND p_coupon_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.coupon_redemptions WHERE transaction_id=tx.id AND coupon_id=p_coupon_id
  ) THEN RAISE EXCEPTION 'Order coupon has not been redeemed'; END IF;
  IF tx.pricing_snapshot_version IS NULL THEN PERFORM public.increment_sale_quantity_sold(tx.product_id);
  ELSE
    FOR line IN SELECT product_id,quantity FROM public.payment_line_items WHERE transaction_id=tx.id LOOP
      PERFORM public.increment_sale_quantity_sold(line.product_id,line.quantity);
    END LOOP;
  END IF;
  IF tx.payment_provider='bank_transfer' AND coalesce((tx.metadata->>'access_on_placement')::boolean,false) THEN
    RETURN jsonb_build_object('success',true,'access_granted',true); END IF;
  IF jsonb_typeof(tx.order_details->'participants'->'people')='array' THEN
    INSERT INTO public.guest_purchases(customer_email,product_id,transaction_amount,session_id,transaction_id)
    SELECT DISTINCT lower(btrim(person->>'email')),li.product_id,0,NULL,tx.id
    FROM jsonb_array_elements(tx.order_details->'participants'->'people') person CROSS JOIN public.payment_line_items li
    WHERE li.transaction_id=tx.id AND li.item_type='order_bump' AND public.validate_email_format(lower(btrim(person->>'email')))
      AND lower(btrim(person->>'email'))<>lower(tx.customer_email) ON CONFLICT DO NOTHING;
    PERFORM public.claim_guest_purchases_for_user(u.id) FROM auth.users u WHERE u.email_confirmed_at IS NOT NULL AND EXISTS(
      SELECT 1 FROM public.guest_purchases gp WHERE gp.transaction_id=tx.id AND gp.customer_email=u.email AND gp.claimed_by_user_id IS NULL);
  END IF;
  IF p_user_id IS NOT NULL THEN
    PERFORM public.grant_product_and_bundle_components(p_user_id,tx.product_id);
    FOR line IN SELECT product_id,access_duration_override FROM public.payment_line_items WHERE transaction_id=tx.id AND item_type='order_bump' LOOP
      PERFORM public.grant_product_access_service_role(p_user_id,line.product_id,override_duration_days_param=>line.access_duration_override);
    END LOOP;
    IF p_requested_user_id IS NULL AND p_existing_user_id IS NOT NULL THEN
      RETURN jsonb_build_object('success',true,'scenario','guest_purchase_user_exists_with_bump','access_granted',true,'is_guest_purchase',false,
        'send_magic_link',true,'requires_login',true,'bump_access_granted',bumps>0,'bump_count',bumps,'customer_email',tx.customer_email);
    END IF;
    RETURN jsonb_build_object('success',true,'scenario','logged_in_user_with_bump','access_granted',true,
      'bump_access_granted',bumps>0,'bump_count',bumps,'customer_email',tx.customer_email);
  END IF;
  INSERT INTO public.guest_purchases(customer_email,product_id,transaction_amount,session_id,transaction_id)
    VALUES(tx.customer_email,tx.product_id,tx.amount,tx.session_id,tx.id);
  RETURN jsonb_build_object('success',true,'scenario','guest_purchase_new_user_with_bump','access_granted',false,
    'is_guest_purchase',true,'send_magic_link',true,'customer_email',tx.customer_email);
END $$;
REVOKE ALL ON FUNCTION public._order_grant_and_record(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._order_grant_and_record(uuid,uuid,uuid,uuid,uuid,text) TO service_role;
CREATE FUNCTION public.bank_transfer_order(p_order jsonb,p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.bank_transfer_config%ROWTYPE; result jsonb; txid uuid; buyer_type text;
  email text:=lower(btrim(p_order->>'customer_email')); profile jsonb; transfer jsonb; person record;
BEGIN
  SELECT * INTO STRICT cfg FROM public.bank_transfer_config WHERE id;
  SELECT checkout_profile INTO profile FROM public.products WHERE id=(p_order->>'product_id')::uuid AND is_active
    AND product_type='one_time' AND NOT is_bundle AND NOT allow_custom_price FOR SHARE;
  buyer_type:=p_order->'order_details'->'buyer'->>'type';
  IF NOT cfg.bank_transfer_enabled OR profile IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(profile->'modules') m
    WHERE m->>'id'='buyer' AND m->'bank_transfer_for' ? buyer_type AND m->'types' ? buyer_type)
    OR NOT public.validate_email_format(email) OR (p_order->'order_details'->'buyer'->>'terms_accepted') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(email,1));
  IF (SELECT count(*) FROM public.payment_transactions WHERE payment_provider='bank_transfer' AND status='awaiting_payment'
    AND lower(customer_email)=email)>=cfg.bank_transfer_max_unpaid_per_email THEN RAISE EXCEPTION 'unpaid_limit' USING ERRCODE='P0429'; END IF;
  p_order:=p_order||jsonb_build_object('payment_provider','bank_transfer','customer_email',email,'session_id',NULL,'stripe_payment_intent_id',NULL,
    'metadata',coalesce(p_order->'metadata','{}')||jsonb_build_object('access_on_placement',cfg.bank_transfer_grant_access_on_placement));
  result:=public.place_order(p_order,p_lines); txid:=(result->>'transaction_id')::uuid;
  transfer:=jsonb_build_object('holder',cfg.bank_account_holder,'account',cfg.bank_account_number,'bank',cfg.bank_name,
    'title',replace(cfg.bank_transfer_title_template,'{order_number}',result->>'order_number'));
  UPDATE public.payment_transactions SET payment_due_at=now()+make_interval(days=>cfg.bank_transfer_due_days),transfer_details=transfer WHERE id=txid;
  IF cfg.bank_transfer_grant_access_on_placement THEN
    INSERT INTO public.guest_purchases(customer_email,product_id,transaction_amount,transaction_id)
      SELECT email,product_id,0,txid FROM public.payment_line_items WHERE transaction_id=txid ON CONFLICT DO NOTHING;
    INSERT INTO public.guest_purchases(customer_email,product_id,transaction_amount,transaction_id)
      SELECT DISTINCT lower(btrim(p->>'email')),li.product_id,0,txid
      FROM jsonb_array_elements(coalesce(p_order->'order_details'->'participants'->'people','[]')) p
      CROSS JOIN public.payment_line_items li WHERE li.transaction_id=txid AND li.item_type='order_bump'
      AND public.validate_email_format(lower(btrim(p->>'email'))) ON CONFLICT DO NOTHING;
    FOR person IN SELECT DISTINCT u.id FROM auth.users u JOIN public.guest_purchases gp ON gp.customer_email=lower(u.email)
      WHERE gp.transaction_id=txid AND u.email_confirmed_at IS NOT NULL LOOP
      PERFORM public.claim_guest_purchases_for_user(person.id);
    END LOOP;
  END IF;
  RETURN result||jsonb_build_object('currency',p_order->>'currency','dueAt',now()+make_interval(days=>cfg.bank_transfer_due_days),'transfer',transfer);
END $$;
REVOKE ALL ON FUNCTION public.bank_transfer_order(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bank_transfer_order(jsonb,jsonb) TO service_role;
CREATE FUNCTION public.admin_bank_transfer_order(p_id uuid,p_action text,p_amount numeric DEFAULT NULL,p_paid_at timestamptz DEFAULT NULL,p_reason text DEFAULT NULL,p_actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; tx public.payment_transactions%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=p_actor) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF p_action='mark-paid' THEN
    IF p_paid_at IS NULL OR p_paid_at>now() THEN RAISE EXCEPTION 'Invalid payment date' USING ERRCODE='22023'; END IF;
    result:=public.complete_offline_order(p_id,p_amount);
    IF (result->>'success')::boolean AND tx.status<>'completed' THEN UPDATE public.payment_transactions SET paid_at=p_paid_at WHERE id=p_id; END IF;
  ELSIF p_action='cancel' THEN result:=public.cancel_unpaid_order(p_id,p_reason);
  ELSE RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
  IF (result->>'success')::boolean AND tx.status='awaiting_payment' THEN
    INSERT INTO public.audit_log(table_name,operation,performed_by,user_id,new_values)
      VALUES('payment_transactions','UPDATE',p_actor,p_actor,jsonb_build_object('action',p_action,'transaction_id',p_id));
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid) TO service_role;
CREATE FUNCTION public.release_transfer_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status='cancelled' AND OLD.status='awaiting_payment' THEN
      DELETE FROM public.guest_purchases WHERE transaction_id=NEW.id;
      UPDATE public.user_product_access a SET transfer_transaction_id=(SELECT gp.transaction_id FROM public.guest_purchases gp
        JOIN public.payment_transactions t ON t.id=gp.transaction_id WHERE gp.claimed_by_user_id=a.user_id AND (gp.product_id=a.product_id OR EXISTS(SELECT 1 FROM public.bundle_items bi WHERE bi.bundle_product_id=gp.product_id AND bi.component_product_id=a.product_id))
        AND t.status IN ('awaiting_payment','completed') ORDER BY t.created_at LIMIT 1)
        WHERE transfer_transaction_id=NEW.id AND EXISTS(SELECT 1 FROM public.guest_purchases gp JOIN public.payment_transactions t ON t.id=gp.transaction_id
          WHERE gp.claimed_by_user_id=a.user_id AND (gp.product_id=a.product_id OR EXISTS(SELECT 1 FROM public.bundle_items bi WHERE bi.bundle_product_id=gp.product_id AND bi.component_product_id=a.product_id)) AND t.status IN ('awaiting_payment','completed'));
      DELETE FROM public.user_product_access WHERE transfer_transaction_id=NEW.id;
    END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.release_transfer_access() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER bank_transfer_access_release AFTER UPDATE OF status ON public.payment_transactions
FOR EACH ROW WHEN(NEW.payment_provider='bank_transfer') EXECUTE FUNCTION public.release_transfer_access();
CREATE OR REPLACE FUNCTION public.release_participant_recordings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE claim record;
BEGIN
  IF NEW.payment_provider='bank_transfer' AND coalesce((NEW.metadata->>'access_on_placement')::boolean,false) THEN RETURN NEW; END IF;
  IF NEW.status IN ('refunded','cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    FOR claim IN SELECT product_id,claimed_by_user_id FROM public.guest_purchases
      WHERE transaction_id=NEW.id AND session_id IS NULL AND product_id<>NEW.product_id FOR UPDATE LOOP
      IF claim.claimed_by_user_id IS NOT NULL THEN
        DELETE FROM public.user_product_access WHERE user_id=claim.claimed_by_user_id AND product_id IN (
          SELECT claim.product_id UNION SELECT component_product_id FROM public.bundle_items WHERE bundle_product_id=claim.product_id
        );
      END IF;
    END LOOP;
    DELETE FROM public.guest_purchases WHERE transaction_id=NEW.id AND session_id IS NULL AND product_id<>NEW.product_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.release_participant_recordings() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_participant_recordings() TO service_role;
CREATE FUNCTION public.save_bank_transfer_config(p_config jsonb,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.bank_transfer_config%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=p_actor) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
  cfg:=jsonb_populate_record(NULL::public.bank_transfer_config,p_config);
  UPDATE public.bank_transfer_config SET bank_transfer_enabled=cfg.bank_transfer_enabled,bank_account_holder=cfg.bank_account_holder,
    bank_account_number=cfg.bank_account_number,bank_name=cfg.bank_name,bank_transfer_title_template=cfg.bank_transfer_title_template,
    bank_transfer_due_days=cfg.bank_transfer_due_days,bank_transfer_grant_access_on_placement=cfg.bank_transfer_grant_access_on_placement,
    bank_transfer_max_unpaid_per_email=cfg.bank_transfer_max_unpaid_per_email WHERE id;
  INSERT INTO public.audit_log(table_name,operation,performed_by,user_id,new_values) VALUES('bank_transfer_config','UPDATE',p_actor,p_actor,
    jsonb_build_object('action','bank_transfer.settings','enabled',cfg.bank_transfer_enabled));
END $$;
REVOKE ALL ON FUNCTION public.save_bank_transfer_config(jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_bank_transfer_config(jsonb,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.my_event_sessions(p_product_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.check_rate_limit('my_event_sessions',1000,3600) THEN RETURN '[]'::jsonb; END IF;
  RETURN (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id',s.id,'starts_at',s.starts_at,'timezone',s.timezone,'title',s.title,'online_url',s.online_url)), '[]')
    FROM public.product_sessions s JOIN public.seat_reservations r ON r.session_id=s.id
    JOIN public.payment_transactions t ON t.id=r.transaction_id
    WHERE (r.status='confirmed' OR (r.status='held' AND r.expires_at IS NULL AND t.status='awaiting_payment' AND t.metadata->>'access_on_placement'='true'))
    AND s.product_id=p_product_id AND EXISTS (SELECT 1 FROM public.user_product_access a WHERE a.product_id=p_product_id AND a.user_id=auth.uid() AND (a.access_expires_at IS NULL OR a.access_expires_at>now()))
    AND (t.user_id=auth.uid() OR lower(t.customer_email)=(SELECT lower(email) FROM auth.users WHERE id=auth.uid())
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(t.order_details->'participants'->'people','[]')) p WHERE lower(p->>'email')=(SELECT lower(email) FROM auth.users WHERE id=auth.uid()))));
END $$;
REVOKE ALL ON FUNCTION public.my_event_sessions(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_event_sessions(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.event_session_admin(p_session_id uuid, p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT jsonb_build_object('availability', (SELECT a FROM jsonb_array_elements(public.event_availability(s.product_id)) a WHERE a->>'id'=s.id::text),
  'sold', (SELECT coalesce(sum(quantity),0) FROM public.seat_reservations WHERE session_id=s.id AND status='confirmed'),
  'held', (SELECT coalesce(sum(quantity),0) FROM public.seat_reservations WHERE session_id=s.id AND status='held' AND (expires_at IS NULL OR expires_at>now())),
  'orders', (SELECT coalesce(jsonb_agg(q),'[]') FROM (SELECT r.transaction_id,r.status,t.customer_email,t.order_details
    FROM public.seat_reservations r JOIN public.payment_transactions t ON t.id=r.transaction_id WHERE r.session_id=s.id
    ORDER BY r.created_at,r.id LIMIT 100 OFFSET greatest(0,p_offset)) q)) FROM public.product_sessions s WHERE s.id=p_session_id;
$$;
REVOKE ALL ON FUNCTION public.event_session_admin(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_session_admin(uuid,integer) TO service_role;
