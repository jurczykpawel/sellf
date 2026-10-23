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
