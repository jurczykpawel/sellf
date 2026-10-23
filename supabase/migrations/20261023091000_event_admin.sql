-- Atomic event authoring through the existing audited product mutation.
CREATE OR REPLACE FUNCTION public.mutate_product_with_audit(
  operation_param text,
  product_data jsonb,
  product_id uuid,
  actor_id uuid
) RETURNS SETOF public.products
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  before_row public.products;
  after_row public.products;
  columns_sql text;
  sessions jsonb := product_data->'sessions';
  session_json jsonb; tier_json jsonb; sid uuid; tid uuid;
  kept_sessions uuid[] := '{}'; kept_tiers uuid[]; before_sessions jsonb;

BEGIN
  -- Only the server supplies the actor, after session or API-key authentication.
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     OR NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = actor_id) THEN
    RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501';
  END IF;
  IF operation_param NOT IN ('INSERT', 'UPDATE', 'DELETE') OR operation_param IS NULL
     OR product_data IS NULL OR jsonb_typeof(product_data) <> 'object' THEN
    RAISE EXCEPTION 'Invalid product mutation' USING ERRCODE = '22023';
  END IF;
  product_data := product_data - 'sessions';
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(product_data) AS k(name)
    WHERE name IN ('id', 'created_at', 'updated_at') OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.products'::regclass AND attname = k.name
        AND attnum > 0 AND NOT attisdropped
    )
  ) THEN
    RAISE EXCEPTION 'Invalid product fields' USING ERRCODE = '22023';
  END IF;

  IF operation_param IN ('UPDATE', 'DELETE') THEN
    SELECT * INTO before_row FROM public.products WHERE id = product_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF sessions IS NOT NULL THEN
    IF jsonb_typeof(sessions) <> 'array' OR jsonb_array_length(sessions) > 50 THEN
      RAISE EXCEPTION 'Invalid sessions' USING ERRCODE = '23514';
    END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]') INTO before_sessions FROM public.product_sessions s WHERE s.product_id = mutate_product_with_audit.product_id;
    FOR sid IN SELECT id FROM public.product_sessions WHERE product_sessions.product_id = mutate_product_with_audit.product_id ORDER BY id LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(sid::text, 0));
    END LOOP;
  END IF;

  SELECT string_agg(format('%I', name), ', ' ORDER BY name)
    INTO columns_sql FROM jsonb_object_keys(product_data) AS k(name);
  IF operation_param = 'INSERT' THEN
    IF columns_sql IS NULL THEN
      RAISE EXCEPTION 'Product fields required' USING ERRCODE = '22023';
    END IF;
    EXECUTE format(
      'INSERT INTO public.products (%s) SELECT %s FROM jsonb_populate_record(NULL::public.products, $1) RETURNING *',
      columns_sql, columns_sql
    ) INTO after_row USING product_data;
  ELSIF operation_param = 'UPDATE' THEN
    IF columns_sql IS NULL THEN
      UPDATE public.products SET updated_at = now() WHERE id = product_id RETURNING * INTO after_row;
    ELSE
      EXECUTE format(
        'UPDATE public.products SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.products, $1)) WHERE id = $2 RETURNING *',
        columns_sql, columns_sql
      ) INTO after_row USING product_data, product_id;
    END IF;
  ELSE
    DELETE FROM public.products WHERE id = product_id;
  END IF;

  IF sessions IS NOT NULL AND operation_param <> 'DELETE' THEN
    FOR session_json IN SELECT value FROM jsonb_array_elements(sessions) LOOP
      sid := coalesce((session_json->>'id')::uuid, gen_random_uuid());
      IF sid = ANY(kept_sessions) THEN RAISE EXCEPTION 'Duplicate session' USING ERRCODE = '23514'; END IF;
      kept_sessions := array_append(kept_sessions, sid);
      IF jsonb_typeof(session_json->'tiers') IS DISTINCT FROM 'array'
        OR jsonb_array_length(session_json->'tiers') NOT BETWEEN 1 AND 50
        OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=coalesce(session_json->>'timezone','Europe/Warsaw')) THEN
        RAISE EXCEPTION 'Invalid session or tiers' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.product_sessions(id, product_id, starts_at, ends_at, timezone, title, venue, online_url, extra_days, capacity, sales_open, sort)
      VALUES(sid, after_row.id, (session_json->>'starts_at')::timestamptz, (session_json->>'ends_at')::timestamptz,
        coalesce(session_json->>'timezone','Europe/Warsaw'), session_json->>'title', session_json->>'venue', session_json->>'online_url',
        session_json->>'extra_days', (session_json->>'capacity')::integer, coalesce((session_json->>'sales_open')::boolean,true), coalesce((session_json->>'sort')::integer,0))
      ON CONFLICT(id) DO UPDATE SET starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at, timezone=EXCLUDED.timezone,
        title=EXCLUDED.title, venue=EXCLUDED.venue, online_url=EXCLUDED.online_url, extra_days=EXCLUDED.extra_days,
        capacity=EXCLUDED.capacity, sales_open=EXCLUDED.sales_open, sort=EXCLUDED.sort
      WHERE product_sessions.product_id=after_row.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Invalid session ID' USING ERRCODE='23514'; END IF;
      UPDATE public.product_price_tiers SET sort=-sort-1 WHERE session_id=sid;
      kept_tiers := '{}';
      FOR tier_json IN SELECT value FROM jsonb_array_elements(session_json->'tiers') LOOP
        tid := coalesce((tier_json->>'id')::uuid,gen_random_uuid());
        IF tid = ANY(kept_tiers) OR (tier_json->>'sort')::integer < 0 THEN RAISE EXCEPTION 'Invalid tier' USING ERRCODE='23514'; END IF;
        kept_tiers := array_append(kept_tiers,tid);
        INSERT INTO public.product_price_tiers(id,session_id,label,price,seats,sale_ends_at,sort)
        VALUES(tid,sid,tier_json->>'label',(tier_json->>'price')::numeric,(tier_json->>'seats')::integer,
          (tier_json->>'sale_ends_at')::timestamptz,(tier_json->>'sort')::integer)
        ON CONFLICT(id) DO UPDATE SET label=EXCLUDED.label,price=EXCLUDED.price,seats=EXCLUDED.seats,sale_ends_at=EXCLUDED.sale_ends_at,sort=EXCLUDED.sort
        WHERE product_price_tiers.session_id=sid;
        IF NOT FOUND THEN RAISE EXCEPTION 'Invalid tier ID' USING ERRCODE='23514'; END IF;
      END LOOP;
      DELETE FROM public.product_price_tiers WHERE session_id=sid AND NOT(id=ANY(kept_tiers));
    END LOOP;
    DELETE FROM public.product_sessions WHERE product_sessions.product_id=after_row.id AND NOT(id=ANY(kept_sessions));
  END IF;

  INSERT INTO public.audit_log (table_name, operation, old_values, new_values, user_id, performed_by)
  VALUES (
    'products', operation_param,
    CASE WHEN operation_param <> 'INSERT' THEN to_jsonb(before_row) || CASE WHEN sessions IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sessions',before_sessions) END END,
    CASE WHEN operation_param <> 'DELETE' THEN to_jsonb(after_row) || CASE WHEN sessions IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sessions',sessions) END END,
    actor_id, actor_id
  );
  RETURN NEXT CASE WHEN operation_param = 'DELETE' THEN before_row ELSE after_row END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mutate_product_with_audit(text, jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_product_with_audit(text, jsonb, uuid, uuid) TO service_role;

ALTER TABLE public.payment_line_items ADD COLUMN tier_label text;
CREATE FUNCTION public.snapshot_event_tier_label() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.tier_id IS NOT NULL AND NEW.tier_label IS NULL THEN SELECT label INTO NEW.tier_label FROM public.product_price_tiers WHERE id=NEW.tier_id; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_event_tier_label() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER event_tier_label BEFORE INSERT OR UPDATE OF tier_id ON public.payment_line_items FOR EACH ROW EXECUTE FUNCTION public.snapshot_event_tier_label();
UPDATE public.payment_line_items li SET tier_label=t.label FROM public.product_price_tiers t WHERE t.id=li.tier_id;

CREATE FUNCTION public.my_event_sessions(p_product_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.check_rate_limit('my_event_sessions',1000,3600) THEN RETURN '[]'::jsonb; END IF;
  RETURN (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id',s.id,'starts_at',s.starts_at,'timezone',s.timezone,'title',s.title,'online_url',s.online_url)), '[]')
    FROM public.product_sessions s JOIN public.seat_reservations r ON r.session_id=s.id AND r.status='confirmed'
    JOIN public.payment_transactions t ON t.id=r.transaction_id
    WHERE s.product_id=p_product_id AND EXISTS (SELECT 1 FROM public.user_product_access a WHERE a.product_id=p_product_id AND a.user_id=auth.uid() AND (a.access_expires_at IS NULL OR a.access_expires_at>now()))
    AND (t.user_id=auth.uid() OR lower(t.customer_email)=(SELECT lower(email) FROM auth.users WHERE id=auth.uid())
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(t.order_details->'participants'->'people','[]')) p WHERE lower(p->>'email')=(SELECT lower(email) FROM auth.users WHERE id=auth.uid()))));
END $$;
REVOKE ALL ON FUNCTION public.my_event_sessions(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_event_sessions(uuid) TO authenticated;

CREATE FUNCTION public.event_session_admin(p_session_id uuid, p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
SELECT jsonb_build_object('availability', (SELECT a FROM jsonb_array_elements(public.event_availability(s.product_id)) a WHERE a->>'id'=s.id::text),
  'sold', (SELECT coalesce(sum(quantity),0) FROM public.seat_reservations WHERE session_id=s.id AND status='confirmed'),
  'held', (SELECT coalesce(sum(quantity),0) FROM public.seat_reservations WHERE session_id=s.id AND status='held' AND expires_at>now()),
  'orders', (SELECT coalesce(jsonb_agg(q),'[]') FROM (SELECT r.transaction_id,r.status,t.customer_email,t.order_details
    FROM public.seat_reservations r JOIN public.payment_transactions t ON t.id=r.transaction_id WHERE r.session_id=s.id
    ORDER BY r.created_at,r.id LIMIT 100 OFFSET greatest(0,p_offset)) q)) FROM public.product_sessions s WHERE s.id=p_session_id;
$$;
REVOKE ALL ON FUNCTION public.event_session_admin(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_session_admin(uuid,integer) TO service_role;

CREATE FUNCTION public.event_mail_access(p_email text, p_product_id uuid, p_transaction_id uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
SELECT EXISTS (SELECT 1 FROM public.user_product_access a JOIN auth.users u ON u.id=a.user_id
  WHERE lower(u.email)=lower(p_email) AND a.product_id=p_product_id AND (a.access_expires_at IS NULL OR a.access_expires_at>now()))
  OR EXISTS (SELECT 1 FROM public.guest_purchases g WHERE lower(g.customer_email)=lower(p_email)
    AND g.product_id=p_product_id AND g.transaction_id=p_transaction_id AND g.claimed_by_user_id IS NULL);
$$;
REVOKE ALL ON FUNCTION public.event_mail_access(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_mail_access(text,uuid,uuid) TO service_role;

-- Auth email templates read the account's current metadata for existing users.
CREATE FUNCTION public.prepare_event_mail(p_email text, p_data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF length(p_data->>'event_date')>500 OR length(p_data->>'event_online_url')>2048
    OR (p_data->>'event_online_url') !~ '^https://[^[:space:]]+$' THEN RAISE EXCEPTION 'Invalid event mail data' USING ERRCODE='22023'; END IF;
  UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}')-'event_date'-'event_online_url')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date','event_online_url',p_data->>'event_online_url'))
    WHERE lower(email)=lower(p_email) AND (p_data ? 'event_date' OR raw_user_meta_data ? 'event_date' OR raw_user_meta_data ? 'event_online_url');
END $$;
REVOKE ALL ON FUNCTION public.prepare_event_mail(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_mail(text,jsonb) TO service_role;
