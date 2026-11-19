-- Bundle composition stays unchanged when a component is removed or archived.
ALTER TABLE public.bundle_items DROP CONSTRAINT bundle_items_component_product_id_fkey,
  ADD CONSTRAINT bundle_items_component_product_id_fkey FOREIGN KEY (component_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.product_deletion_impact(p_product_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH orders AS (
    SELECT id FROM public.payment_transactions WHERE product_id = p_product_id
    UNION SELECT transaction_id FROM public.payment_line_items WHERE product_id = p_product_id
  ), counts AS (
    SELECT (SELECT count(*) FROM orders) AS orders,
      (SELECT count(*) FROM public.invoices WHERE transaction_id IN (SELECT id FROM orders)) AS invoices,
      (SELECT count(*) FROM public.issued_licenses WHERE product_id = p_product_id) AS licenses,
      (SELECT count(*) FROM public.user_product_access WHERE product_id = p_product_id)
        + (SELECT count(*) FROM public.guest_purchases WHERE product_id = p_product_id AND claimed_by_user_id IS NULL) AS accesses,
      (SELECT count(*) FROM public.subscriptions WHERE product_id = p_product_id) AS subscriptions,
      (SELECT count(*) FROM public.subscriptions WHERE product_id = p_product_id
        AND status IN ('trialing', 'active', 'past_due', 'incomplete')) AS active_subscriptions,
      (SELECT count(*) FROM public.seat_reservations r JOIN public.product_sessions s ON s.id = r.session_id
        WHERE s.product_id = p_product_id AND coalesce(s.ends_at, s.starts_at) > now()
          AND (r.status = 'confirmed' OR (r.status = 'held' AND (r.expires_at IS NULL OR r.expires_at > now())))) AS future_reservations,
      (SELECT count(*) FROM public.affiliate_rules WHERE product_id = p_product_id)
        + (SELECT count(*) FROM public.affiliate_cocreator_rules WHERE product_id = p_product_id) AS affiliate_rules,
      (SELECT count(*) FROM public.affiliate_commissions c JOIN public.payment_line_items li ON li.id = c.line_item_id
        WHERE li.product_id = p_product_id) AS affiliate_commissions,
      (SELECT count(*) FROM public.bundle_items WHERE component_product_id = p_product_id) AS bundles
  )
  SELECT jsonb_build_object('orders', orders, 'invoices', invoices, 'licenses', licenses, 'accesses', accesses,
    'subscriptions', subscriptions, 'activeSubscriptions', active_subscriptions, 'futureReservations', future_reservations,
    'affiliateRules', affiliate_rules, 'affiliateCommissions', affiliate_commissions, 'bundles', bundles,
    'bundleReferences', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) ORDER BY p.name,p.id),'[]'::jsonb)
      FROM public.bundle_items bi JOIN public.products p ON p.id=bi.bundle_product_id WHERE bi.component_product_id=p_product_id),
    'hasHistory', orders > 0 OR licenses > 0 OR accesses > 0 OR subscriptions > 0 OR affiliate_rules > 0)
  FROM counts;
$$;
REVOKE EXECUTE ON FUNCTION public.product_deletion_impact(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.product_deletion_impact(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.remove_product_as(event_actor jsonb, p_product_id uuid, actor_id uuid, p_permanent boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  current_row public.products;
  impact jsonb;
BEGIN
  SELECT * INTO current_row FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  impact := public.product_deletion_impact(p_product_id);
  IF (impact->>'bundles')::int > 0 THEN
    RAISE EXCEPTION 'Product belongs to bundles' USING ERRCODE = '2BP01',
      DETAIL = (SELECT string_agg(r->>'name', ', ' ORDER BY r->>'name')
        FROM jsonb_array_elements(impact->'bundleReferences') r);
  END IF;
  IF (impact->>'hasHistory')::boolean AND NOT p_permanent THEN
    IF current_row.archived_at IS NULL THEN
      PERFORM public.mutate_product_as(event_actor, 'UPDATE',
        jsonb_build_object('archived_at', now(), 'is_active', false), p_product_id, actor_id);
    END IF;
    RETURN jsonb_build_object('result', 'archived', 'impact', impact);
  END IF;
  IF (impact->>'hasHistory')::boolean AND current_row.archived_at IS NULL THEN
    RAISE EXCEPTION 'Archive the product before deleting it permanently' USING ERRCODE = '55000';
  END IF;
  IF (impact->>'activeSubscriptions')::int > 0 OR (impact->>'futureReservations')::int > 0
     OR (impact->>'affiliateCommissions')::int > 0 THEN
    RAISE EXCEPTION 'Product is still in use' USING ERRCODE = '55006';
  END IF;
  PERFORM set_config('sellf.deleting_product', p_product_id::text, true);
  UPDATE public.seat_reservations SET session_id = NULL, tier_id = NULL
    WHERE session_id IN (SELECT id FROM public.product_sessions WHERE product_id = p_product_id);
  PERFORM public.mutate_product_as(event_actor, 'DELETE', '{}'::jsonb, p_product_id, actor_id);
  PERFORM set_config('sellf.deleting_product', '', true);
  RETURN jsonb_build_object('result', 'deleted', 'impact', impact);
END $$;
