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
