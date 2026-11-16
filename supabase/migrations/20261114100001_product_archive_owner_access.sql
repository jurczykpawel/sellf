-- Product archive:
-- * an archived product is hidden from the public (waitlist included) but its buyers keep the content;
-- * a permanent delete is blocked only by active subscriptions and future event reservations;
--   ended subscriptions and past reservations stay as history, affiliate rules and bundle links go.
-- @see supabase/migrations/20261114100000_product_archive.sql

-- ===== VISIBILITY =====
GRANT SELECT (archived_at) ON public.products TO anon, authenticated;

-- Buyer check for the policy below; anon has no access to user_product_access itself.
CREATE FUNCTION public.owns_product_access(p_product_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_product_access
    WHERE product_id = p_product_id AND user_id = (SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.owns_product_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owns_product_access(uuid) TO anon, authenticated, service_role;

DROP POLICY "SELECT policy for products" ON public.products;
CREATE POLICY "SELECT policy for products" ON public.products FOR SELECT USING (
  (SELECT public.is_admin())
  OR (archived_at IS NULL AND is_active = true
      AND (available_from IS NULL OR available_from <= now())
      AND (available_until IS NULL OR available_until >= now()))
  OR (archived_at IS NULL AND is_active = false AND enable_waitlist = true)
  OR (archived_at IS NOT NULL AND public.owns_product_access(id))
);

-- ===== HISTORY KEPT ON PERMANENT DELETE =====
ALTER TABLE public.subscriptions ADD COLUMN product_name text;
CREATE TRIGGER purchase_product_name BEFORE INSERT ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_purchase_product_name();
UPDATE public.subscriptions s SET product_name = p.name FROM public.products p
  WHERE p.id = s.product_id AND s.product_name IS NULL;
ALTER TABLE public.subscriptions ALTER COLUMN product_id DROP NOT NULL,
  DROP CONSTRAINT subscriptions_product_id_fkey,
  ADD CONSTRAINT subscriptions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

-- Past reservations are detached from the deleted sessions by remove_product_as; the session
-- foreign keys keep blocking the removal of a reserved session through a product edit.
ALTER TABLE public.seat_reservations ALTER COLUMN session_id DROP NOT NULL, ALTER COLUMN tier_id DROP NOT NULL;

-- Removed together with the product. Affiliate rules stay append-only except for the rules of the
-- product remove_product_as is deleting (commissions still reference their rule and block it).
CREATE FUNCTION public.affiliate_rule_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.product_id::text = current_setting('sellf.deleting_product', true) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Append only record' USING ERRCODE = '23514';
END $$;
REVOKE ALL ON FUNCTION public.affiliate_rule_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER affiliate_rules_guard ON public.affiliate_rules;
CREATE TRIGGER affiliate_rules_guard BEFORE UPDATE OR DELETE ON public.affiliate_rules
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_rule_guard();
ALTER TABLE public.affiliate_rules DROP CONSTRAINT affiliate_rules_product_id_fkey,
  ADD CONSTRAINT affiliate_rules_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
ALTER TABLE public.bundle_items DROP CONSTRAINT bundle_items_component_product_id_fkey,
  ADD CONSTRAINT bundle_items_component_product_id_fkey FOREIGN KEY (component_product_id) REFERENCES public.products(id) ON DELETE CASCADE;

-- ===== DELETION IMPACT =====
-- activeSubscriptions: statuses in which Stripe is charging or about to charge (as for account deletion).
-- futureReservations: confirmed or still-held seats of a session that has not ended yet.
-- affiliateCommissions: partner commissions recorded under the product's rules (partner payout history).
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
      (SELECT count(*) FROM public.affiliate_rules WHERE product_id = p_product_id) AS affiliate_rules,
      (SELECT count(*) FROM public.affiliate_commissions c JOIN public.affiliate_rules ar ON ar.id = c.rule_id
        WHERE ar.product_id = p_product_id) AS affiliate_commissions,
      (SELECT count(*) FROM public.bundle_items WHERE component_product_id = p_product_id) AS bundles
  )
  SELECT jsonb_build_object('orders', orders, 'invoices', invoices, 'licenses', licenses, 'accesses', accesses,
    'subscriptions', subscriptions, 'activeSubscriptions', active_subscriptions, 'futureReservations', future_reservations,
    'affiliateRules', affiliate_rules, 'affiliateCommissions', affiliate_commissions, 'bundles', bundles,
    'hasHistory', orders > 0 OR licenses > 0 OR accesses > 0 OR subscriptions > 0 OR affiliate_rules > 0)
  FROM counts;
$$;

-- p_permanent: 55000 = archive first; 55006 = still in use (active subscription, future reservation,
-- partner commissions).
CREATE OR REPLACE FUNCTION public.remove_product_as(event_actor jsonb, p_product_id uuid, actor_id uuid, p_permanent boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  current_row public.products;
  impact jsonb;
BEGIN
  SELECT * INTO current_row FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  impact := public.product_deletion_impact(p_product_id);
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
