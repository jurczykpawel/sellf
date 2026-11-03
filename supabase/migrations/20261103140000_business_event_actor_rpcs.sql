-- Carry the authenticated actor (admin session or API key) into catalogue and refund-request
-- business events, like mutate_access does for access events.
-- @see supabase/migrations/20261103130000_webhook_event_families.sql

-- Validates and installs the transaction-local event context. Service role only.
CREATE FUNCTION public.set_business_event_actor(p_actor jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_actor IS NULL OR jsonb_typeof(p_actor) <> 'object' OR coalesce(p_actor->>'type','') NOT IN ('user','api_key') OR p_actor->>'id' IS NULL THEN
    RAISE EXCEPTION 'Actor required' USING ERRCODE='22023';
  END IF;
  PERFORM (p_actor->>'id')::uuid;
  PERFORM set_config('sellf.event_context',jsonb_build_object('actor',jsonb_build_object('type',p_actor->>'type','id',p_actor->>'id'))::text,true);
END $$;
REVOKE ALL ON FUNCTION public.set_business_event_actor(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_business_event_actor(jsonb) TO service_role;

CREATE FUNCTION public.mutate_product_as(event_actor jsonb, operation_param text, product_data jsonb, product_id uuid, actor_id uuid)
RETURNS SETOF public.products LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM public.set_business_event_actor(event_actor);
  RETURN QUERY SELECT * FROM public.mutate_product_with_audit(operation_param,product_data,product_id,actor_id);
END $$;
REVOKE ALL ON FUNCTION public.mutate_product_as(jsonb,text,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_product_as(jsonb,text,jsonb,uuid,uuid) TO service_role;

-- Decision or Stripe-failure revert of a refund request; only status/admin fields can change.
CREATE FUNCTION public.decide_refund_request(p_request_id uuid, p_status text, p_admin_id uuid, p_admin_response text, p_actor jsonb)
RETURNS SETOF public.refund_requests LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM public.set_business_event_actor(p_actor);
  IF p_status NOT IN ('pending','approved','rejected') THEN RAISE EXCEPTION 'Invalid refund request status' USING ERRCODE='22023'; END IF;
  RETURN QUERY UPDATE public.refund_requests SET status=p_status,
    admin_id=CASE WHEN p_status='pending' THEN NULL ELSE p_admin_id END,
    admin_response=CASE WHEN p_status='pending' THEN NULL ELSE p_admin_response END,
    processed_at=CASE WHEN p_status='pending' THEN NULL ELSE now() END, updated_at=now()
    WHERE id=p_request_id RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.decide_refund_request(uuid,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.decide_refund_request(uuid,text,uuid,text,jsonb) TO service_role;

-- A request returned to pending (approval reverted after a failed Stripe refund) is announced again.
CREATE OR REPLACE FUNCTION public.capture_refund_request_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event text := CASE NEW.status WHEN 'pending' THEN 'refund.requested' ELSE 'refund.request_'||NEW.status END;
BEGIN
  IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  PERFORM public.record_business_event(event,NEW.product_id,jsonb_build_object(
    'amountUnit','minor',
    'refundRequest',jsonb_build_object('id',NEW.id,'statusBefore',CASE WHEN TG_OP='INSERT' THEN 'none' ELSE OLD.status END,
      'statusAfter',NEW.status,'requestedAmount',NEW.requested_amount,'currency',NEW.currency,'reason',NEW.reason,
      'adminResponse',NEW.admin_response,'createdAt',NEW.created_at,'processedAt',NEW.processed_at),
    'order',public.business_event_order(NEW.transaction_id),
    'customer',jsonb_build_object('userId',NEW.user_id,'email',NEW.customer_email)),
    event||':'||NEW.id||CASE WHEN TG_OP='UPDATE' AND NEW.status='pending' THEN ':'||clock_timestamp() ELSE '' END);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_refund_request_event() FROM PUBLIC,anon,authenticated;
