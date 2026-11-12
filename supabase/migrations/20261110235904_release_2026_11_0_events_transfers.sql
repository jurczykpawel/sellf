

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

-- ===== Source: 20261023090000_event_storefront.sql =====
-- Event recording claims and event catalogue projection.
DROP INDEX public.guest_purchases_transaction_idx;
CREATE UNIQUE INDEX guest_purchases_transaction_idx ON public.guest_purchases(transaction_id,customer_email,product_id) WHERE transaction_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.claim_guest_purchases_for_user(
  p_user_id UUID
) RETURNS json AS $$
DECLARE
  user_email_var TEXT;
  claimed_count INTEGER := 0;
  guest_purchase_record RECORD;
  line_item_rec RECORD;
BEGIN
  IF NOT public.check_rate_limit('claim_guest_purchases_for_user', 10, 3600) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Rate limit exceeded. Please wait before trying again.'
    );
  END IF;

  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User ID is required');
  END IF;

  SELECT email INTO user_email_var FROM auth.users WHERE id = p_user_id AND email_confirmed_at IS NOT NULL;

  IF user_email_var IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  IF NOT public.validate_email_format(user_email_var) THEN
    RETURN json_build_object('success', false, 'error', 'Invalid email format');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(user_email_var));

  FOR guest_purchase_record IN
    SELECT gp.id, gp.product_id, gp.session_id, pt.id as transaction_id
    FROM public.guest_purchases gp
    LEFT JOIN public.payment_transactions pt ON pt.id = gp.transaction_id
      OR (gp.transaction_id IS NULL AND pt.session_id = gp.session_id)
    WHERE gp.customer_email = user_email_var
      AND gp.claimed_by_user_id IS NULL
    FOR UPDATE OF gp SKIP LOCKED
  LOOP
    UPDATE public.guest_purchases
    SET claimed_by_user_id = p_user_id, claimed_at = NOW()
    WHERE id = guest_purchase_record.id;

    BEGIN
      DECLARE
        grant_result JSONB;
      BEGIN
        SELECT public.grant_product_and_bundle_components(p_user_id, guest_purchase_record.product_id) INTO grant_result;

        IF (grant_result->>'success')::boolean = true THEN
          claimed_count := claimed_count + 1;

          UPDATE public.payment_transactions
          SET user_id = p_user_id,
              updated_at = NOW()
          WHERE id = guest_purchase_record.transaction_id
            AND user_id IS NULL AND lower(customer_email)=lower(user_email_var);
        ELSE
          IF (grant_result->>'retry_exceeded')::boolean = true THEN
            PERFORM public.log_admin_action(
              'guest_claim_concurrency_failure', 'guest_purchases',
              guest_purchase_record.id::TEXT,
              jsonb_build_object(
                'severity', 'WARNING', 'error_type', 'optimistic_lock_retry_exceeded',
                'user_id', p_user_id, 'product_id', guest_purchase_record.product_id,
                'guest_purchase_id', guest_purchase_record.id, 'grant_result', grant_result,
                'function_name', 'claim_guest_purchases_for_user'
              )
            );
          ELSE
            PERFORM public.log_admin_action(
              'guest_claim_grant_failure', 'guest_purchases',
              guest_purchase_record.id::TEXT,
              jsonb_build_object(
                'severity', 'ERROR', 'error_type', 'access_grant_failure',
                'user_id', p_user_id, 'product_id', guest_purchase_record.product_id,
                'guest_purchase_id', guest_purchase_record.id, 'grant_result', grant_result,
                'function_name', 'claim_guest_purchases_for_user'
              )
            );
          END IF;

          UPDATE public.guest_purchases
          SET claimed_by_user_id = NULL, claimed_at = NULL
          WHERE id = guest_purchase_record.id;
        END IF;
      END;
    EXCEPTION
      WHEN OTHERS THEN
        PERFORM public.log_admin_action(
          'critical_guest_claim_failure', 'guest_purchases',
          guest_purchase_record.id::TEXT,
          jsonb_build_object(
            'severity', 'CRITICAL', 'error_type', 'guest_claim_exception',
            'error_code', SQLSTATE, 'error_message', SQLERRM,
            'user_id', p_user_id, 'product_id', guest_purchase_record.product_id,
            'guest_purchase_id', guest_purchase_record.id,
            'function_name', 'claim_guest_purchases_for_user'
          )
        );
        UPDATE public.guest_purchases
        SET claimed_by_user_id = NULL, claimed_at = NULL
        WHERE id = guest_purchase_record.id;
        NULL;
    END;

    IF guest_purchase_record.transaction_id IS NOT NULL THEN
      FOR line_item_rec IN
        SELECT pli.product_id, pli.access_duration_override
        FROM public.payment_line_items pli
        WHERE pli.transaction_id = guest_purchase_record.transaction_id
          AND pli.item_type = 'order_bump'
      LOOP
        BEGIN
          PERFORM public.grant_product_access_service_role(
            p_user_id,
            line_item_rec.product_id,
            override_duration_days_param => line_item_rec.access_duration_override
          );
          claimed_count := claimed_count + 1;
        EXCEPTION WHEN OTHERS THEN
          PERFORM public.log_admin_action(
            'guest_claim_bump_failure', 'payment_line_items',
            guest_purchase_record.transaction_id::TEXT,
            jsonb_build_object(
              'severity', 'ERROR', 'error_type', 'bump_access_grant_failure',
              'user_id', p_user_id, 'product_id', line_item_rec.product_id,
              'transaction_id', guest_purchase_record.transaction_id,
              'function_name', 'claim_guest_purchases_for_user'
            )
          );
          NULL;
        END;
      END LOOP;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'claimed_count', claimed_count,
    'user_email', user_email_var
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s';

REVOKE ALL ON FUNCTION public.claim_guest_purchases_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_purchases_for_user(uuid) TO service_role;
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
  IF jsonb_typeof(tx.order_details->'participants'->'people')='array' THEN
    INSERT INTO public.guest_purchases(customer_email,product_id,transaction_amount,session_id,transaction_id)
    SELECT DISTINCT lower(btrim(person->>'email')), li.product_id, 0, NULL, tx.id
    FROM jsonb_array_elements(tx.order_details->'participants'->'people') person
    CROSS JOIN public.payment_line_items li
    WHERE li.transaction_id=tx.id AND li.item_type='order_bump'
      AND public.validate_email_format(lower(btrim(person->>'email')))
      AND lower(btrim(person->>'email'))<>lower(tx.customer_email)
    ON CONFLICT DO NOTHING;
    PERFORM public.claim_guest_purchases_for_user(u.id) FROM auth.users u
    WHERE u.email_confirmed_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.guest_purchases gp WHERE gp.transaction_id=tx.id
        AND gp.customer_email=u.email AND gp.claimed_by_user_id IS NULL
    );
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
        RETURN jsonb_build_object('success', true, 'scenario', 'guest_purchase_user_exists_with_bump', 'access_granted', true, 'is_guest_purchase', false, 'send_magic_link', true, 'requires_login', true, 'bump_access_granted', bump_count > 0, 'bump_count', bump_count, 'customer_email', customer_email_param);
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
CREATE OR REPLACE FUNCTION public.storefront_catalogue_page(
  filters jsonb DEFAULT '{}', after_created timestamptz DEFAULT NULL,
  after_id uuid DEFAULT NULL, product_ids uuid[] DEFAULT NULL
) RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE
  page_size integer := coalesce((filters->>'pageSize')::integer, 9);
  search_text text := normalize(btrim(coalesce(filters->>'search','')), NFC);
  categories uuid[];
  price_kind text := filters->>'priceKind';
  product_format text := filters->>'format';
  group_name text := coalesce(filters->>'group','all');
BEGIN
  IF jsonb_typeof(filters) IS DISTINCT FROM 'object' OR page_size NOT IN (9,12,24)
    OR char_length(search_text)>100 OR group_name NOT IN ('all','featured','free','paid')
    OR (price_kind IS NOT NULL AND price_kind NOT IN ('free','one-time','subscription','pwyw'))
    OR (product_format IS NOT NULL AND product_format NOT IN ('course','workshop','ebook','template','tool','service','bundle','other'))
    OR (after_created IS NULL) <> (after_id IS NULL)
    OR cardinality(product_ids)>5 THEN RAISE EXCEPTION 'INVALID' USING ERRCODE='22023'; END IF;
  SELECT coalesce(array_agg(value::uuid),'{}'::uuid[]) INTO categories
    FROM jsonb_array_elements_text(coalesce(filters->'categoryIds','[]')) value;
  IF cardinality(categories)>12 OR cardinality(categories)<>(SELECT count(DISTINCT c) FROM unnest(categories) c)
    THEN RAISE EXCEPTION 'INVALID' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  WITH eligible AS NOT MATERIALIZED (
    SELECT p.id,p.name,p.slug,left(p.description,280) description,p.created_at,p.price,p.currency,p.product_type,p.recurring_price,
      p.billing_interval,p.billing_interval_count,p.allow_custom_price,p.custom_price_min,
      p.sale_price,p.sale_price_until,p.sale_quantity_limit,p.sale_quantity_sold,
      p.marketing_fields,left(p.image_url,2049) image_url,p.vat_rate,p.vat_exempt,
      left(p.vat_exempt_note,501) vat_exempt_note,p.price_includes_vat,p.omnibus_exempt,
      p.auto_grant_duration_days,p.available_until,p.event_mode
    FROM public.products p
    -- The unique junction key makes the per-candidate count an intersection.
    CROSS JOIN LATERAL (
      SELECT count(*) FROM public.product_categories pc
      WHERE pc.product_id=p.id AND pc.category_id=ANY(categories)
      HAVING count(*)=cardinality(categories)
    ) membership
    WHERE p.is_active AND p.is_listed
      AND (p.available_from IS NULL OR p.available_from<=statement_timestamp())
      AND (p.available_until IS NULL OR p.available_until>statement_timestamp())
      AND (product_ids IS NULL OR p.id=ANY(product_ids))
      AND (search_text='' OR normalize(p.name,NFC) ILIKE '%' || replace(replace(replace(search_text, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%')
      AND (product_format IS NULL OR p.marketing_fields->>'format'=product_format)
      AND (group_name<>'featured' OR p.is_featured)
      AND (price_kind IS NULL OR price_kind=CASE WHEN p.product_type='subscription' THEN 'subscription'
        WHEN p.allow_custom_price THEN 'pwyw' WHEN p.price=0 THEN 'free' ELSE 'one-time' END)
      AND (group_name<>'free' OR (p.product_type<>'subscription' AND NOT p.allow_custom_price AND p.price=0))
      AND (group_name<>'paid' OR NOT (p.product_type<>'subscription' AND NOT p.allow_custom_price AND p.price=0))
  ), page AS MATERIALIZED (
    SELECT * FROM (
      (SELECT * FROM eligible WHERE after_created IS NULL OR created_at<after_created ORDER BY created_at DESC,id ASC LIMIT page_size+1)
      UNION ALL
      (SELECT * FROM eligible WHERE created_at=after_created AND id>after_id ORDER BY created_at DESC,id ASC LIMIT page_size+1)
    ) candidates ORDER BY created_at DESC,id ASC LIMIT page_size+1
  ), shop AS MATERIALIZED (
    SELECT tax_mode,omnibus_enabled FROM public.shop_config LIMIT 1
  ), history AS (
    SELECT h.product_id,h.price,h.sale_price,h.effective_from,
      max(h.effective_from) OVER (PARTITION BY h.product_id) latest
    FROM public.omnibus_price_history h JOIN page p ON p.id=h.product_id
    WHERE h.effective_from>=statement_timestamp()-interval '30 days'
  ), prior AS (
    SELECT product_id,min(CASE WHEN effective_from=latest THEN price ELSE least(price,coalesce(sale_price,price)) END) lowest
    FROM history GROUP BY product_id
  )
  SELECT (to_jsonb(p)-'omnibus_exempt') || jsonb_build_object(
    'tax_mode',coalesce(shop.tax_mode,'local'),
    'lowest_prior_price',CASE WHEN NOT p.omnibus_exempt AND coalesce(shop.omnibus_enabled,false) THEN prior.lowest ELSE NULL END)
  FROM page p LEFT JOIN prior ON prior.product_id=p.id LEFT JOIN shop ON true ORDER BY p.created_at DESC,p.id ASC;
END;
$$;
REVOKE ALL ON FUNCTION public.storefront_catalogue_page(jsonb,timestamptz,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_catalogue_page(jsonb,timestamptz,uuid,uuid[]) TO service_role;

-- Participant recording grants follow the order's terminal status.
CREATE FUNCTION public.release_participant_recordings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE claim record;
BEGIN
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
CREATE TRIGGER participant_recordings_release AFTER UPDATE OF status ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.release_participant_recordings();

-- ===== Source: 20261023091000_event_admin.sql =====
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

-- ===== Source: 20261023140000_event_availability_unlisted.sql =====
-- Direct event links follow the product sale window independently of catalogue listing.
CREATE OR REPLACE FUNCTION public.public_event_availability(p_product_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.products WHERE id=p_product_id AND event_mode AND is_active
  AND (available_from IS NULL OR available_from<=statement_timestamp())
  AND (available_until IS NULL OR available_until>statement_timestamp()))
  THEN public.event_availability(p_product_id) ELSE '[]'::jsonb END;
$$;
REVOKE ALL ON FUNCTION public.public_event_availability(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_event_availability(uuid) TO service_role;

-- Sellf 2026.11.0: transfers coupons.
-- Source sections retain their SQL and relative order within this area.

-- ===== Source: 20261023100000_invoicing_provider.sql =====
-- Provider settings stay server-side; invoice history is readable by administrators.
CREATE TABLE public.invoicing_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  instance_id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'none' CHECK (provider IN ('none','fakturownia')),
  domain text NOT NULL DEFAULT '',
  token jsonb,
  mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('auto','manual')),
  auto_since timestamptz,
  exemption text NOT NULL DEFAULT '' CHECK (length(exemption) <= 1000),
  template text NOT NULL DEFAULT '{product} {date} {session} {tier}' CHECK (length(template) <= 300)
);
ALTER TABLE public.invoicing_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service settings" ON public.invoicing_config FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.invoicing_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.invoicing_config TO service_role;
CREATE FUNCTION public.set_invoicing_auto_since() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.mode <> 'auto' THEN NEW.auto_since := NULL;
  ELSIF TG_OP = 'INSERT' THEN NEW.auto_since := now();
  ELSIF OLD.mode IS DISTINCT FROM NEW.mode OR OLD.provider IS DISTINCT FROM NEW.provider
    OR OLD.domain IS DISTINCT FROM NEW.domain THEN NEW.auto_since := now();
  ELSE NEW.auto_since := OLD.auto_since;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.set_invoicing_auto_since() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_invoicing_auto_since() TO service_role;
CREATE TRIGGER invoicing_auto_since BEFORE INSERT OR UPDATE ON public.invoicing_config
FOR EACH ROW EXECUTE FUNCTION public.set_invoicing_auto_since();
INSERT INTO public.invoicing_config(id) VALUES (true);

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL UNIQUE REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider = 'fakturownia'),
  status text NOT NULL DEFAULT 'issuing' CHECK (status IN ('issuing','issued','failed','corrected')),
  external_key text NOT NULL UNIQUE,
  provider_domain text NOT NULL,
  provider_invoice_id text,
  number text,
  view_url text,
  error text,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 5),
  payment_synced boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_retry_idx ON public.invoices(updated_at) WHERE status IN ('failed','issuing');
CREATE INDEX invoices_payment_sync_idx ON public.invoices(updated_at) WHERE status = 'issued' AND NOT payment_synced;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin invoice read" ON public.invoices FOR SELECT TO authenticated USING ((select public.is_admin()));
CREATE POLICY "Service invoices" ON public.invoices FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.invoices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;

-- ===== Source: 20261023110000_bank_transfer.sql =====
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

-- ===== Source: 20261023120000_transfer_instructions_mail.sql =====
-- Transfer instructions share the Auth email channel.
ALTER TABLE public.payment_transactions ADD COLUMN transfer_mail_sent_at timestamptz;
CREATE INDEX payment_transfer_mail_pending ON public.payment_transactions(created_at)
  WHERE payment_provider='bank_transfer' AND transfer_mail_sent_at IS NULL AND status IN ('awaiting_payment','completed');
CREATE OR REPLACE FUNCTION public.prepare_event_mail(p_email text, p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF length(p_data->>'event_date')>500 OR length(p_data->>'event_online_url')>2048
    OR (p_data->>'event_online_url') !~ '^https://[^[:space:]]+$'
    OR length(p_data->>'transfer_text')>2000 THEN RAISE EXCEPTION 'Invalid mail data' USING ERRCODE='22023'; END IF;
  UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}')-'event_date'-'event_online_url'-'transfer_text')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date','event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text'))
    WHERE lower(email)=lower(p_email);
END $$;
REVOKE ALL ON FUNCTION public.prepare_event_mail(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_mail(text,jsonb) TO service_role;

-- ===== Source: 20261023130000_set_price_coupons.sql =====
-- Set-price coupons keep the product's list-price history unchanged.
ALTER TABLE public.coupons DROP CONSTRAINT coupons_discount_type_check,
  DROP CONSTRAINT coupons_discount_value_check, DROP CONSTRAINT coupons_check;
ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_discount_type_check CHECK (discount_type IN ('percentage','fixed','set_price')),
  ADD CONSTRAINT coupons_discount_value_check CHECK ((discount_value > 0 OR (discount_type = 'set_price' AND discount_value = 0)) AND (discount_type <> 'set_price' OR discount_value < 'Infinity'::numeric)),
  ADD CONSTRAINT coupons_check CHECK (
    (discount_type = 'fixed' AND (currency IS NULL OR length(currency) = 3)) OR
    (discount_type = 'percentage' AND currency IS NULL) OR
    (discount_type = 'set_price' AND currency IS NOT NULL AND currency ~ '^[A-Z]{3}$')),
  ADD CONSTRAINT coupons_set_price_whole CHECK (discount_type <> 'set_price'
    OR public.currency_minor_factor(currency) <> 1 OR discount_value = trunc(discount_value));
CREATE OR REPLACE FUNCTION public.verify_coupon(
  code_param TEXT, product_id_param UUID,
  customer_email_param TEXT DEFAULT NULL, currency_param TEXT DEFAULT 'USD'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  DELETE FROM public.coupon_reservations WHERE expires_at < NOW();
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
  IF clean_email IS NOT NULL THEN
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
    'allowed_product_ids', coupon_record.allowed_product_ids, 'reserved', true,
    'expires_in_minutes', 15
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.grant_free_product_access(product_slug_param text, access_duration_days_param integer DEFAULT NULL::integer, coupon_code_param text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
 SET statement_timeout TO '2s'
AS $$
DECLARE
    product_record RECORD;
    current_user_id UUID;
    v_access_expires_at TIMESTAMPTZ;
    v_capped_duration INTEGER;
    clean_slug TEXT; clean_coupon TEXT;
    coupon_result JSONB; v_coupon_id UUID;
    v_discount_type TEXT; v_discount_value NUMERIC; v_user_email TEXT;
    eligible BOOLEAN := FALSE;
    v_component_id UUID;
BEGIN
    IF product_slug_param IS NULL OR length(product_slug_param) = 0 OR length(product_slug_param) > 100 THEN
        RETURN FALSE;
    END IF;
    IF access_duration_days_param IS NOT NULL AND (access_duration_days_param < 0 OR access_duration_days_param > 3650) THEN
        RETURN FALSE;
    END IF;
    clean_slug := regexp_replace(product_slug_param, '[^a-zA-Z0-9_-]', '', 'g');
    IF clean_slug IS NULL OR length(clean_slug) = 0 THEN
        RETURN FALSE;
    END IF;
    current_user_id := auth.uid();
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;
    SELECT email INTO v_user_email FROM auth.users WHERE id = current_user_id;
    SELECT id, price, currency, allow_custom_price, custom_price_min, auto_grant_duration_days, is_active,
           product_type, available_from, available_until, is_bundle
      INTO product_record
      FROM public.products
      WHERE slug = clean_slug;
    IF NOT FOUND OR NOT product_record.is_active THEN
        RETURN FALSE;
    END IF;
    IF NOT public.is_free_grantable_now(product_record.product_type, product_record.available_from, product_record.available_until)
       AND NOT EXISTS (
         SELECT 1 FROM public.user_product_access upa
         WHERE upa.user_id = current_user_id
           AND upa.product_id = product_record.id
           AND (upa.access_expires_at IS NULL OR upa.access_expires_at > NOW())
       ) THEN
        RETURN FALSE;
    END IF;
    IF coupon_code_param IS NOT NULL THEN
        clean_coupon := regexp_replace(upper(coupon_code_param), '[^A-Z0-9_-]', '', 'g');
        IF length(clean_coupon) = 0 THEN
            RETURN FALSE;
        END IF;
        coupon_result := public.verify_coupon(
            code_param := clean_coupon,
            product_id_param := product_record.id,
            customer_email_param := v_user_email,
            currency_param := product_record.currency
        );
        IF (coupon_result ->> 'valid')::BOOLEAN IS DISTINCT FROM TRUE THEN
            RETURN FALSE;
        END IF;
        v_coupon_id := (coupon_result ->> 'id')::UUID;
        v_discount_type := coupon_result ->> 'discount_type';
        v_discount_value := (coupon_result ->> 'discount_value')::NUMERIC;
        IF v_discount_type = 'set_price' AND v_discount_value = 0 THEN
            eligible := TRUE;
        ELSIF v_discount_type = 'percentage' AND v_discount_value >= 100 THEN
            eligible := TRUE;
        ELSIF v_discount_type = 'fixed' AND v_discount_value >= product_record.price THEN
            eligible := TRUE;
        ELSE
            RETURN FALSE;
        END IF;
    ELSIF product_record.price = 0 THEN
        eligible := TRUE;
    ELSIF product_record.allow_custom_price AND product_record.custom_price_min = 0 THEN
        eligible := TRUE;
    END IF;
    IF NOT eligible THEN
        RETURN FALSE;
    END IF;
    PERFORM 1 FROM public.user_product_access upa
    WHERE upa.user_id = current_user_id
      AND upa.product_id = product_record.id
      AND (upa.access_expires_at IS NULL OR upa.access_expires_at > NOW());
    IF FOUND THEN
        RETURN TRUE;
    END IF;
    IF NOT public.check_rate_limit('grant_free_product_access'::TEXT, 20, 3600) THEN
        RETURN FALSE;
    END IF;
    v_capped_duration := access_duration_days_param;
    IF v_capped_duration IS NOT NULL AND product_record.auto_grant_duration_days IS NOT NULL THEN
        v_capped_duration := LEAST(v_capped_duration, product_record.auto_grant_duration_days);
    END IF;
    IF v_capped_duration IS NOT NULL THEN
        v_access_expires_at := NOW() + INTERVAL '1 day' * v_capped_duration;
    ELSIF product_record.auto_grant_duration_days IS NOT NULL THEN
        v_access_expires_at := NOW() + INTERVAL '1 day' * product_record.auto_grant_duration_days;
    ELSE
        v_access_expires_at := NULL;
    END IF;
    INSERT INTO public.user_product_access (user_id, product_id, access_expires_at, access_duration_days)
    VALUES (
        current_user_id,
        product_record.id,
        v_access_expires_at,
        COALESCE(v_capped_duration, product_record.auto_grant_duration_days)
    )
    ON CONFLICT (user_id, product_id)
    DO UPDATE SET
        access_expires_at = EXCLUDED.access_expires_at,
        access_duration_days = EXCLUDED.access_duration_days,
        access_granted_at = NOW();
    IF product_record.is_bundle THEN
        FOR v_component_id IN
            SELECT bi.component_product_id FROM public.bundle_items bi
            WHERE bi.bundle_product_id = product_record.id
            ORDER BY bi.display_order
        LOOP
            PERFORM public.grant_bundle_component_access(current_user_id, v_component_id);
        END LOOP;
    END IF;
    IF coupon_code_param IS NOT NULL AND v_coupon_id IS NOT NULL THEN
        INSERT INTO public.coupon_redemptions (
            coupon_id, customer_email, user_id, discount_amount, transaction_id
        )
        VALUES (
            v_coupon_id,
            v_user_email,
            current_user_id,
            product_record.price,  -- full-discount path: discount equals list price
            NULL
        );
        UPDATE public.coupons
           SET current_usage_count = current_usage_count + 1
         WHERE id = v_coupon_id;
        DELETE FROM public.coupon_reservations
         WHERE coupon_id = v_coupon_id
           AND customer_email = v_user_email;
    END IF;
    RETURN TRUE;
END;
$$;

-- ===== Source: 20261024091717_embedded_coupon_completion.sql =====
-- Complete coupon eligibility and reservation in the same order transaction.
CREATE OR REPLACE FUNCTION public._redeem_coupon_for_order(
  coupon_id_param uuid, current_user_id uuid, existing_user_id uuid,
  customer_email_param text, transaction_id_var uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  coupon_code text;
  tx public.payment_transactions%ROWTYPE;
  reservation jsonb;
BEGIN
    IF coupon_id_param IS NOT NULL THEN
      SELECT * INTO STRICT tx FROM public.payment_transactions WHERE id = transaction_id_var;
      IF tx.payment_provider = 'stripe' THEN
        SELECT code INTO STRICT coupon_code FROM public.coupons WHERE id = coupon_id_param;
        reservation := public.verify_coupon(coupon_code, tx.product_id, customer_email_param, tx.currency);
        IF NOT coalesce((reservation->>'valid')::boolean, false)
          OR (reservation->>'id')::uuid IS DISTINCT FROM coupon_id_param THEN
          RAISE EXCEPTION 'Coupon is not available for this order';
        END IF;
      END IF;

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

-- ===== Source: 20261024101152_coupon_payment_reservations.sql =====
-- Shared coupon limits and reservation for selection and paid order completion.
CREATE FUNCTION public._reserve_coupon(
  coupon_id_param uuid, product_id_param uuid, customer_email_param text, currency_param text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  IF clean_email IS NOT NULL THEN
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
    'allowed_product_ids', coupon_record.allowed_product_ids, 'reserved', true,
    'expires_in_minutes', 15
  );
END;
$$;

REVOKE ALL ON FUNCTION public._reserve_coupon(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reserve_coupon(uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_coupon(
  code_param TEXT, product_id_param UUID,
  customer_email_param TEXT DEFAULT NULL, currency_param TEXT DEFAULT 'USD'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  RETURN public._reserve_coupon(coupon_record.id, product_id_param, customer_email_param, currency_param);
END;
$$;
REVOKE ALL ON FUNCTION public.verify_coupon(text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_coupon(text,uuid,text,text) TO anon, authenticated, service_role;

-- Keep existing reservations and complete paid Stripe orders independently of selection availability.
CREATE OR REPLACE FUNCTION public._redeem_coupon_for_order(
  coupon_id_param uuid, current_user_id uuid, existing_user_id uuid,
  customer_email_param text, transaction_id_var uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  reservation jsonb;
BEGIN
    IF coupon_id_param IS NOT NULL THEN
      SELECT * INTO STRICT tx FROM public.payment_transactions WHERE id = transaction_id_var;
      PERFORM 1 FROM public.coupons WHERE id = coupon_id_param FOR UPDATE;
      IF tx.payment_provider = 'stripe' AND NOT EXISTS (
        SELECT 1 FROM public.coupon_reservations
        WHERE coupon_id = coupon_id_param AND customer_email = customer_email_param AND expires_at > now()
      ) THEN
        reservation := public._reserve_coupon(coupon_id_param, tx.product_id, customer_email_param, tx.currency);
        IF NOT coalesce((reservation->>'valid')::boolean, false)
          OR (reservation->>'id')::uuid IS DISTINCT FROM coupon_id_param THEN
          RAISE EXCEPTION 'Coupon is not available for this order';
        END IF;
      END IF;

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
        AND (tx.payment_provider = 'stripe' OR is_active = true)
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

-- ===== Source: 20261030152222_bank_transfer_consent_policy.sql =====
-- Service-only placement receives the resolved consent policy; omitted policy stays strict.
CREATE OR REPLACE FUNCTION public.bank_transfer_order(p_order jsonb,p_lines jsonb) RETURNS jsonb
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
    OR NOT public.validate_email_format(email) OR (p_order->'terms_required' IS DISTINCT FROM 'false'::jsonb
      AND (p_order->'order_details'->'buyer'->>'terms_accepted') IS DISTINCT FROM 'true') THEN
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

-- Sellf 2026.11.0: fulfillment.
-- Source sections retain their SQL and relative order within this area.

-- ===== Source: 20261026135522_refund_request_buyer_reads.sql =====
-- Read refund requests using the current session's identity.

DROP POLICY "Users can view own refund requests" ON public.refund_requests;
CREATE POLICY "Users can view own refund requests" ON public.refund_requests
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR customer_email = (SELECT auth.jwt() ->> 'email')
    OR (SELECT public.is_admin())
  );

-- ===== Source: 20261027143930_auth_mail_context.sql =====
-- Keep auth email context current for existing accounts as well as signups.
CREATE OR REPLACE FUNCTION public.prepare_event_mail(p_email text, p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF length(p_data->>'event_date')>500 OR length(p_data->>'event_online_url')>2048
    OR (p_data->>'event_online_url') !~ '^https://[^[:space:]]+$'
    OR length(p_data->>'transfer_text')>2000 OR length(p_data->>'purchase_product')>500
    OR length(p_data->>'purchase_amount')>100 OR (p_data->>'locale') NOT IN ('pl','en')
    THEN RAISE EXCEPTION 'Invalid mail data' USING ERRCODE='22023'; END IF;
  UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}')
    -'event_date'-'event_online_url'-'transfer_text'-'purchase_product'-'purchase_amount'-'locale')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date',
      'event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text',
      'purchase_product',p_data->>'purchase_product','purchase_amount',p_data->>'purchase_amount',
      'locale',coalesce(p_data->>'locale','en')))
    WHERE lower(email)=lower(p_email);
END $$;
REVOKE ALL ON FUNCTION public.prepare_event_mail(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_mail(text,jsonb) TO service_role;

-- ===== Source: 20261028173057_payment_refund_processor_status.sql =====
-- Keep the processor refund status separate from the payment transaction status.
ALTER TABLE public.payment_transactions
  ADD COLUMN refund_status text
  CHECK (refund_status IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled'));

COMMENT ON COLUMN public.payment_transactions.refund_status IS
  'Status returned by Stripe for refund_id; NULL when not observed. Never inferred from payment status.';

-- ===== Source: 20261028180459_refund_event_state.sql =====
-- Refund identity and notification progress are independent of payment totals.
CREATE TABLE public.payment_refunds (
  stripe_refund_id text PRIMARY KEY CHECK (stripe_refund_id ~ '^re_[A-Za-z0-9_]+$'),
  transaction_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text CHECK (status IN ('pending','requires_action','succeeded','failed','canceled')),
  previous_status text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  notified_version integer NOT NULL DEFAULT 0 CHECK (notified_version >= 0 AND notified_version <= version),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_refunds_transaction_id_idx ON public.payment_refunds(transaction_id);
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_refunds_service ON public.payment_refunds FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.payment_refunds FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.payment_refunds TO service_role;

CREATE TABLE public.payment_refund_events (
  stripe_refund_id text NOT NULL REFERENCES public.payment_refunds(stripe_refund_id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text CHECK (status IN ('pending','requires_action','succeeded','failed','canceled')),
  previous_status text,
  notified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(stripe_refund_id,version)
);
ALTER TABLE public.payment_refund_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_refund_events_service ON public.payment_refund_events FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.payment_refund_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.payment_refund_events TO service_role;

CREATE FUNCTION public.observe_payment_refund(
  p_transaction_id uuid, p_refund_id text, p_amount integer, p_currency text, p_status text,
  p_initial_status text DEFAULT NULL
) RETURNS TABLE(refund_version integer, previous_status text, notified_version integer, refund_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_refund public.payment_refunds%ROWTYPE;
BEGIN
  INSERT INTO public.payment_refunds(stripe_refund_id,transaction_id,amount,currency,status)
  VALUES(p_refund_id,p_transaction_id,p_amount,upper(p_currency),coalesce(p_initial_status,p_status))
  ON CONFLICT (stripe_refund_id) DO NOTHING;
  SELECT * INTO STRICT v_refund FROM public.payment_refunds WHERE stripe_refund_id=p_refund_id FOR UPDATE;
  IF v_refund.transaction_id<>p_transaction_id OR v_refund.amount<>p_amount OR v_refund.currency<>upper(p_currency) THEN
    RAISE EXCEPTION 'Refund binding does not match';
  END IF;
  INSERT INTO public.payment_refund_events(stripe_refund_id,version,status,previous_status)
  VALUES(p_refund_id,v_refund.version,v_refund.status,v_refund.previous_status) ON CONFLICT DO NOTHING;
  IF v_refund.status IS DISTINCT FROM p_status THEN
    UPDATE public.payment_refunds SET previous_status=v_refund.status,status=p_status,
      version=version+1,updated_at=now() WHERE stripe_refund_id=p_refund_id RETURNING * INTO v_refund;
    INSERT INTO public.payment_refund_events(stripe_refund_id,version,status,previous_status)
    VALUES(p_refund_id,v_refund.version,v_refund.status,v_refund.previous_status);
  END IF;
  RETURN QUERY SELECT e.version,e.previous_status,0,e.status FROM public.payment_refund_events e
    WHERE e.stripe_refund_id=p_refund_id AND NOT e.notified ORDER BY e.version;
  IF NOT FOUND THEN
    RETURN QUERY SELECT v_refund.version,v_refund.previous_status,v_refund.notified_version,v_refund.status;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.observe_payment_refund(uuid,text,integer,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.observe_payment_refund(uuid,text,integer,text,text,text) TO service_role;

CREATE FUNCTION public.confirm_refund_notification(p_refund_id text,p_version integer) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.payment_refund_events SET notified=true WHERE stripe_refund_id=p_refund_id AND version=p_version;
  UPDATE public.payment_refunds SET notified_version=greatest(notified_version,p_version)
  WHERE stripe_refund_id=p_refund_id AND p_version BETWEEN 1 AND version;
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_refund_notification(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_refund_notification(text,integer) TO service_role;

UPDATE public.payment_transactions SET status='partially_refunded'
WHERE status='completed' AND refunded_amount>0 AND refunded_amount<amount;

-- ===== Source: 20261028184757_business_event_delivery.sql =====
-- Committed order, reservation and access transitions for signed webhook delivery.
CREATE TABLE public.business_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('access.granted','access.updated','access.revoked','access.expired','order.abandoned','seats.held','seats.confirmed','seats.released')),
  product_id uuid NOT NULL,
  payload jsonb NOT NULL,
  deduplication_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  leased_until timestamptz,
  dispatched_at timestamptz
);
ALTER TABLE public.business_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.business_events TO service_role;
CREATE POLICY business_events_service ON public.business_events FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
CREATE INDEX business_events_pending_idx ON public.business_events(created_at,id) WHERE dispatched_at IS NULL;
CREATE INDEX business_events_product_idx ON public.business_events(product_id);