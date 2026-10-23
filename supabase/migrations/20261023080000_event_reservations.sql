-- Event schedules, authoritative availability and atomic order reservations.
ALTER TABLE public.products ADD COLUMN event_mode boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD CONSTRAINT products_event_mode_check
  CHECK (NOT event_mode OR (product_type = 'one_time' AND NOT is_bundle AND NOT allow_custom_price));
GRANT SELECT (event_mode) ON public.products TO anon, authenticated;
CREATE FUNCTION public.enable_event_repeat_purchase() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.event_mode AND (TG_OP = 'INSERT' OR NOT OLD.event_mode) THEN NEW.allow_repeat_purchase := true; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enable_event_repeat_purchase() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER products_event_repeat BEFORE INSERT OR UPDATE OF event_mode ON public.products
FOR EACH ROW EXECUTE FUNCTION public.enable_event_repeat_purchase();

CREATE TABLE public.product_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL, ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'Europe/Warsaw', title text, venue text,
  online_url text CHECK (online_url IS NULL OR online_url ~ '^https://[^[:space:]]+$'), extra_days text,
  capacity integer CHECK (capacity > 0), sales_open boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE TRIGGER product_sessions_updated_at BEFORE UPDATE ON public.product_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX product_sessions_product_idx ON public.product_sessions(product_id);
CREATE TABLE public.product_price_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.product_sessions(id) ON DELETE CASCADE,
  label text, price numeric NOT NULL CHECK (price >= 0), seats integer CHECK (seats > 0),
  sale_ends_at timestamptz, sort integer NOT NULL, UNIQUE(session_id, sort), UNIQUE(id, session_id)
);
CREATE TABLE public.seat_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.product_sessions(id),
  tier_id uuid NOT NULL,
  transaction_id uuid NOT NULL UNIQUE REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('held','confirmed','released')),
  expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz, released_at timestamptz,
  FOREIGN KEY (tier_id, session_id) REFERENCES public.product_price_tiers(id, session_id),
  CHECK (status <> 'held' OR expires_at IS NOT NULL)
);
CREATE INDEX seat_reservations_session_status_idx ON public.seat_reservations(session_id, status);
CREATE INDEX seat_reservations_tier_status_idx ON public.seat_reservations(tier_id, status);
CREATE INDEX seat_reservations_expiry_idx ON public.seat_reservations(status, expires_at);
ALTER TABLE public.payment_line_items ADD COLUMN session_id uuid, ADD COLUMN tier_id uuid,
  ADD COLUMN session_label text, ADD COLUMN session_starts_at timestamptz;
ALTER TABLE public.product_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_price_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seat_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.product_price_tiers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seat_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.product_sessions TO service_role;
GRANT ALL ON public.product_price_tiers TO service_role;
GRANT ALL ON public.seat_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_price_tiers TO authenticated;
GRANT SELECT ON public.seat_reservations TO authenticated;
CREATE POLICY event_sessions_admin ON public.product_sessions TO authenticated
  USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));
CREATE POLICY event_tiers_admin ON public.product_price_tiers TO authenticated
  USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));
CREATE POLICY event_reservations_admin ON public.seat_reservations FOR SELECT TO authenticated USING ((select public.is_admin()));

CREATE FUNCTION public.event_availability(p_product_id uuid, p_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
WITH sessions AS (
  SELECT s.*, greatest(0, s.capacity - coalesce((SELECT sum(r.quantity) FROM public.seat_reservations r
    WHERE r.session_id = s.id AND (r.status = 'confirmed' OR (r.status = 'held' AND r.expires_at > p_at))),0)) remaining_count
  FROM public.product_sessions s WHERE s.product_id = p_product_id
), tiers AS (
  SELECT t.*, CASE WHEN t.seats IS NULL THEN NULL ELSE greatest(0, t.seats - coalesce((SELECT sum(r.quantity)
    FROM public.seat_reservations r WHERE r.tier_id = t.id
    AND (r.status = 'confirmed' OR (r.status = 'held' AND r.expires_at > p_at))),0)) END tier_remaining
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

-- This projection contains public presentation only; HTTP callers apply their visitor limit.
CREATE FUNCTION public.public_event_availability(p_product_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.products WHERE id=p_product_id AND event_mode AND is_active AND is_listed)
  THEN public.event_availability(p_product_id) ELSE '[]'::jsonb END;
$$;
REVOKE ALL ON FUNCTION public.public_event_availability(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_event_availability(uuid) TO service_role;

CREATE FUNCTION public.event_hold_limits(p_session_id uuid, p_email text, p_ip text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT count(*) FILTER (WHERE lower(t.customer_email)=lower(p_email)) < 3
  AND count(*) FILTER (WHERE t.metadata->>'event_ip'=p_ip) < 5
FROM public.seat_reservations r JOIN public.payment_transactions t ON t.id=r.transaction_id
WHERE r.session_id=p_session_id AND r.status='held' AND r.expires_at > now();
$$;
REVOKE ALL ON FUNCTION public.event_hold_limits(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_hold_limits(uuid,text,text) TO service_role;

-- Keep the existing order validation and coupon accounting in the same transaction.
ALTER FUNCTION public.place_order(jsonb,jsonb) RENAME TO _place_order_without_event;
REVOKE ALL ON FUNCTION public._place_order_without_event(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.place_order(p_order jsonb, p_lines jsonb)
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
  p_order := jsonb_set(p_order,'{expires_at}',to_jsonb(deadline));
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

CREATE FUNCTION public.release_event_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('abandoned','cancelled','refunded','failed','expired') THEN
    UPDATE public.seat_reservations SET status='released', released_at=now()
      WHERE transaction_id=NEW.id AND status IN ('held','confirmed');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.release_event_order() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER event_order_release AFTER UPDATE OF status ON public.payment_transactions
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.release_event_order();

CREATE FUNCTION public.expire_seat_reservations() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  UPDATE public.seat_reservations SET status='released',released_at=now() WHERE status='held' AND expires_at<=now();
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.expire_seat_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_seat_reservations() TO service_role;

CREATE FUNCTION public.confirm_event_order(p_transaction_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE li public.payment_line_items%ROWTYPE; r public.seat_reservations%ROWTYPE;
  available integer; tier_available integer; s public.product_sessions%ROWTYPE; tier public.product_price_tiers%ROWTYPE;
BEGIN
  FOR li IN SELECT * FROM public.payment_line_items WHERE transaction_id=p_transaction_id AND session_id IS NOT NULL ORDER BY session_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(li.session_id::text,0));
    SELECT * INTO r FROM public.seat_reservations WHERE transaction_id=p_transaction_id FOR UPDATE;
    IF r.status='confirmed' THEN CONTINUE; END IF;
    IF r.status='held' AND r.expires_at>now() THEN
      UPDATE public.seat_reservations SET status='confirmed',confirmed_at=now() WHERE id=r.id;
      CONTINUE;
    END IF;
    SELECT * INTO s FROM public.product_sessions WHERE id=li.session_id;
    SELECT * INTO tier FROM public.product_price_tiers WHERE id=li.tier_id;
    SELECT s.capacity-coalesce(sum(quantity),0) INTO available FROM public.seat_reservations
      WHERE session_id=li.session_id AND transaction_id<>p_transaction_id
        AND (status='confirmed' OR (status='held' AND expires_at>now()));
    SELECT tier.seats-coalesce(sum(quantity),0) INTO tier_available FROM public.seat_reservations
      WHERE tier_id=li.tier_id AND transaction_id<>p_transaction_id
        AND (status='confirmed' OR (status='held' AND expires_at>now()));
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

CREATE OR REPLACE FUNCTION public._order_grant_and_record(
  p_transaction_id uuid, p_user_id uuid, p_existing_user_id uuid,
  p_requested_user_id uuid, p_coupon_id uuid, p_coupon_mode text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  transaction_id_var uuid := p_transaction_id;
  current_user_id uuid := p_user_id;
  existing_user_id uuid := p_existing_user_id;
  user_id_param uuid := p_requested_user_id;
  product_id_param uuid;
  customer_email_param text;
  amount_total numeric;
  session_id_param text;
  bump_count integer;
  bump_rec record;
BEGIN
  SELECT * INTO STRICT tx FROM public.payment_transactions WHERE id = p_transaction_id;
  PERFORM public.confirm_event_order(tx.id);
  product_id_param := tx.product_id;
  customer_email_param := tx.customer_email;
  amount_total := tx.amount;
  session_id_param := tx.session_id;
  SELECT count(*) INTO bump_count FROM public.payment_line_items
    WHERE transaction_id = tx.id AND item_type = 'order_bump';
  IF p_coupon_mode IS NULL OR p_coupon_mode NOT IN ('consume_reservation','already_redeemed','none')
    OR (p_coupon_mode = 'none' AND p_coupon_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid coupon mode';
  END IF;
  IF p_coupon_mode = 'consume_reservation' THEN
    PERFORM public._redeem_coupon_for_order(p_coupon_id, current_user_id, existing_user_id, customer_email_param, tx.id);
  ELSIF p_coupon_mode = 'already_redeemed' AND p_coupon_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.coupon_redemptions WHERE transaction_id = tx.id AND coupon_id = p_coupon_id
  ) THEN RAISE EXCEPTION 'Order coupon has not been redeemed';
  END IF;
  IF tx.pricing_snapshot_version IS NULL THEN
    PERFORM public.increment_sale_quantity_sold(product_id_param);
  ELSE
    FOR bump_rec IN SELECT product_id, quantity FROM public.payment_line_items WHERE transaction_id = tx.id LOOP
      PERFORM public.increment_sale_quantity_sold(bump_rec.product_id, bump_rec.quantity);
    END LOOP;
  END IF;
    IF current_user_id IS NOT NULL THEN
      PERFORM public.grant_product_and_bundle_components(current_user_id, product_id_param);

      FOR bump_rec IN
        SELECT product_id, access_duration_override FROM public.payment_line_items
        WHERE transaction_id = transaction_id_var AND item_type = 'order_bump'
      LOOP
        PERFORM public.grant_product_access_service_role(current_user_id, bump_rec.product_id,
          override_duration_days_param => bump_rec.access_duration_override);
      END LOOP;

      IF user_id_param IS NULL AND existing_user_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'scenario', 'guest_purchase_user_exists_with_bump',
          'access_granted', true,
          'is_guest_purchase', false,
          'send_magic_link', true,
          'requires_login', true,
          'bump_access_granted', bump_count > 0,
          'bump_count', bump_count,
          'customer_email', customer_email_param
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'logged_in_user_with_bump',
        'access_granted', true,
        'bump_access_granted', bump_count > 0,
        'bump_count', bump_count,
        'customer_email', customer_email_param
      );
    ELSE
      INSERT INTO public.guest_purchases (customer_email, product_id, transaction_amount, session_id, transaction_id)
      VALUES (customer_email_param, product_id_param, amount_total, session_id_param, transaction_id_var);

      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_new_user_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param
      );
    END IF;

END;
$$;
REVOKE ALL ON FUNCTION public._order_grant_and_record(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._order_grant_and_record(uuid,uuid,uuid,uuid,uuid,text) TO service_role;
