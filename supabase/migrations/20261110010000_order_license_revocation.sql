-- Resolve an order without rewriting historical signed order claims.
CREATE FUNCTION public.license_order_references(p_order public.payment_transactions) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT array_remove(ARRAY[p_order.id::text,p_order.session_id,p_order.stripe_payment_intent_id,p_order.stripe_invoice_id],NULL)
$$;
REVOKE ALL ON FUNCTION public.license_order_references(public.payment_transactions) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.revoke_order_licenses(p_product_id uuid,p_order_ids text[],p_reason text)
RETURNS TABLE(id uuid,changed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE refs text[]; item record;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  PERFORM t.id FROM public.payment_transactions t
    WHERE t.product_id=p_product_id AND public.license_order_references(t) && p_order_ids ORDER BY t.id FOR UPDATE;
  SELECT array_agg(DISTINCT ref) INTO refs FROM public.payment_transactions t
    CROSS JOIN LATERAL unnest(public.license_order_references(t)) ref
    WHERE t.product_id=p_product_id AND public.license_order_references(t) && p_order_ids;
  FOR item IN SELECT l.id FROM public.issued_licenses l
    WHERE (refs IS NOT NULL AND l.order_id=ANY(refs))
      OR (l.product_id=p_product_id AND l.order_id=ANY(p_order_ids))
    ORDER BY l.id FOR UPDATE
  LOOP
    RETURN QUERY SELECT * FROM public.revoke_issued_licenses(ARRAY[item.id],NULL,p_reason);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.revoke_order_licenses(uuid,text[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_order_licenses(uuid,text[],text) TO service_role;

-- All refund entry points persist the same transaction state; capture the decision there.
CREATE FUNCTION public.revoke_terminal_order_licenses() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE refs text[];
BEGIN
  IF NEW.status IN ('refunded','cancelled') OR (NEW.amount>0 AND NEW.refunded_amount>=NEW.amount) THEN
    refs:=public.license_order_references(NEW);
    PERFORM l.id FROM public.issued_licenses l WHERE l.order_id=ANY(refs) ORDER BY l.id FOR UPDATE;
    UPDATE public.issued_licenses l SET revoked_at=coalesce(l.revoked_at,now()),revoked_by_dispute_id=NULL,
      revocation_reason=CASE WHEN l.revoked_at IS NULL OR l.revoked_by_dispute_id IS NOT NULL
        THEN CASE WHEN NEW.status='cancelled' THEN 'manual' ELSE 'refund' END
        ELSE coalesce(l.revocation_reason,CASE WHEN NEW.status='cancelled' THEN 'manual' ELSE 'refund' END) END
      WHERE l.order_id=ANY(refs);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.revoke_terminal_order_licenses() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER revoke_terminal_order_licenses AFTER INSERT OR UPDATE OF status,refunded_amount ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.revoke_terminal_order_licenses();

-- Serialize issuance with refund/dispute decisions. A delayed fulfillment cannot resurrect an order.
CREATE OR REPLACE FUNCTION public.revoke_license_for_disputed_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions; dispute_id text;
BEGIN
  SELECT t.* INTO tx FROM public.payment_transactions t
    WHERE t.id=CASE WHEN NEW.order_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NEW.order_id::uuid END
      OR t.session_id=NEW.order_id OR t.stripe_payment_intent_id=NEW.order_id OR t.stripe_invoice_id=NEW.order_id
    ORDER BY (t.product_id=NEW.product_id) DESC,t.created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF tx.status IN ('refunded','cancelled') OR (tx.amount>0 AND tx.refunded_amount>=tx.amount) THEN
    NEW.revoked_at:=coalesce(NEW.revoked_at,now());
    NEW.revoked_by_dispute_id:=NULL;
    NEW.revocation_reason:=CASE WHEN tx.status='cancelled' THEN 'manual' ELSE 'refund' END;
  ELSIF tx.status='disputed' THEN
    SELECT d.stripe_dispute_id INTO dispute_id FROM public.payment_disputes d
      WHERE d.transaction_id=tx.id AND d.status<>'won' AND d.suspended_at IS NOT NULL ORDER BY d.suspended_at,d.stripe_dispute_id LIMIT 1 FOR UPDATE;
    IF dispute_id IS NOT NULL THEN
      NEW.revoked_at:=coalesce(NEW.revoked_at,now());
      NEW.revoked_by_dispute_id:=dispute_id;
      UPDATE public.payment_disputes SET revoked_license_ids=array_append(revoked_license_ids,NEW.id)
        WHERE stripe_dispute_id=dispute_id AND NOT NEW.id=ANY(revoked_license_ids);
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.revoke_license_for_disputed_order() FROM PUBLIC,anon,authenticated,service_role;

-- Keep dispute ownership/restoration unchanged; extend only the order membership predicate.
DO $$ DECLARE definition text; original text; BEGIN
  SELECT pg_get_functiondef('public.apply_payment_dispute_before_guest_claim(uuid,text,text,boolean,text,integer,text,timestamptz)'::regprocedure) INTO definition;
  original:=definition;
  definition:=replace(definition,'l.product_id=t.product_id' || chr(10) || '        AND l.order_id IN (t.stripe_payment_intent_id,t.session_id)',
    'l.order_id=ANY(public.license_order_references(t))');
  definition:=replace(definition,'l.order_id IN (t.stripe_payment_intent_id,t.session_id)',
    'l.order_id=ANY(public.license_order_references(t))');
  IF definition=original OR definition LIKE '%l.product_id=t.product_id%' THEN RAISE EXCEPTION 'Order license predicate not updated'; END IF;
  EXECUTE definition;
END $$;

-- Repair existing full refunds and cancellations, preserving tokens and their CRL hashes.
UPDATE public.issued_licenses l SET revoked_at=coalesce(l.revoked_at,now()),revoked_by_dispute_id=NULL,
  revocation_reason=CASE WHEN l.revoked_at IS NULL OR l.revoked_by_dispute_id IS NOT NULL
    THEN CASE WHEN t.status='cancelled' THEN 'manual' ELSE 'refund' END
    ELSE coalesce(l.revocation_reason,CASE WHEN t.status='cancelled' THEN 'manual' ELSE 'refund' END) END
FROM public.payment_transactions t
WHERE (t.status IN ('refunded','cancelled') OR (t.amount>0 AND t.refunded_amount>=t.amount))
  AND l.order_id=ANY(public.license_order_references(t));
