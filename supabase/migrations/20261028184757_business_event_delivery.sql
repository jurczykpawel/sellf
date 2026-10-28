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

CREATE FUNCTION public.capture_business_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  previous jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  context jsonb := coalesce(nullif(current_setting('sellf.event_context',true),'')::jsonb,'{}');
  actor jsonb; payload jsonb; product jsonb; orders jsonb; tx public.payment_transactions;
  pid uuid; uid uuid; email text; event text; reason text; before_status text; after_status text; key text; session public.product_sessions;
BEGIN
  actor := coalesce(context->'actor',jsonb_build_object('type',CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,'id',auth.uid()));
  IF TG_TABLE_NAME='user_product_access' THEN
    IF TG_OP='UPDATE' AND NEW.access_expires_at IS NOT DISTINCT FROM OLD.access_expires_at
      AND NEW.access_granted_at=OLD.access_granted_at AND NEW.access_duration_days IS NOT DISTINCT FROM OLD.access_duration_days
      AND NEW.subscription_id IS NOT DISTINCT FROM OLD.subscription_id AND NEW.transfer_transaction_id IS NOT DISTINCT FROM OLD.transfer_transaction_id THEN
      IF NEW.expiry_notified_at IS NOT DISTINCT FROM OLD.expiry_notified_at OR NEW.access_expires_at IS NULL OR NEW.access_expires_at>now() THEN RETURN NEW; END IF;
      event := 'access.expired'; reason := 'expired'; key := event||':'||NEW.id||':'||NEW.access_expires_at;
    ELSE
      event := CASE TG_OP WHEN 'INSERT' THEN 'access.granted' WHEN 'DELETE' THEN 'access.revoked' ELSE 'access.updated' END;
    END IF;
    pid := (r->>'product_id')::uuid; uid := (r->>'user_id')::uuid;
    SELECT u.email INTO email FROM auth.users u WHERE u.id=uid;
    SELECT jsonb_agg(jsonb_build_object('id',t.id,'orderNumber',t.order_number)) INTO orders FROM public.payment_transactions t
      WHERE t.id=(r->>'transfer_transaction_id')::uuid OR (
        (t.product_id=pid OR EXISTS(SELECT 1 FROM public.bundle_items b WHERE b.bundle_product_id=t.product_id AND b.component_product_id=pid)
          OR EXISTS(SELECT 1 FROM public.payment_line_items l WHERE l.transaction_id=t.id AND (l.product_id=pid OR EXISTS(SELECT 1 FROM public.bundle_items b WHERE b.bundle_product_id=l.product_id AND b.component_product_id=pid))))
        AND (t.user_id=uid OR EXISTS(SELECT 1 FROM public.guest_purchases g WHERE (g.transaction_id=t.id OR (g.transaction_id IS NULL AND g.session_id=t.session_id)) AND g.claimed_by_user_id=uid AND g.claimed_at=transaction_timestamp())));
    reason := coalesce(reason,context->>'reason',CASE
      WHEN EXISTS(SELECT 1 FROM public.guest_purchases g WHERE g.claimed_by_user_id=uid AND g.claimed_at=transaction_timestamp() AND (g.product_id=pid OR EXISTS(SELECT 1 FROM public.bundle_items b WHERE b.bundle_product_id=g.product_id AND b.component_product_id=pid) OR EXISTS(SELECT 1 FROM public.payment_line_items l WHERE l.transaction_id=g.transaction_id AND l.product_id=pid))) THEN 'guest_purchase_claimed'
      WHEN r->>'transfer_transaction_id' IS NOT NULL THEN 'bank_transfer'
      WHEN r->>'subscription_id' IS NOT NULL THEN 'subscription'
      WHEN orders IS NOT NULL THEN 'purchase'
      WHEN EXISTS(SELECT 1 FROM public.products p WHERE p.id=pid AND (p.price=0 OR (p.allow_custom_price AND p.custom_price_min=0))) THEN 'free_product' ELSE 'access_change' END);
    before_status := CASE WHEN TG_OP='INSERT' THEN 'none' WHEN event='access.expired' THEN 'active'
      WHEN previous->>'access_expires_at' IS NULL OR (previous->>'access_expires_at')::timestamptz>now() THEN 'active' ELSE 'expired' END;
    after_status := CASE WHEN TG_OP='DELETE' THEN 'revoked' WHEN event='access.expired' THEN 'expired'
      WHEN r->>'access_expires_at' IS NULL OR (r->>'access_expires_at')::timestamptz>now() THEN 'active' ELSE 'expired' END;
    payload := jsonb_build_object('customer',jsonb_build_object('userId',uid,'email',email),
      'sourceOrder',CASE WHEN jsonb_array_length(orders)=1 THEN orders->0 ELSE NULL END,'sourceOrders',coalesce(orders,'[]'),
      'accessGrantedAt',r->'access_granted_at','accessExpiresAt',r->'access_expires_at',
      'access',jsonb_build_object('id',r->'id','grantedAt',r->'access_granted_at','expiresAt',r->'access_expires_at',
        'expiredAt',CASE WHEN event='access.expired' THEN r->'access_expires_at' ELSE NULL END,'durationDays',r->'access_duration_days','subscriptionId',r->'subscription_id','statusBefore',before_status,'statusAfter',after_status,
        'revokedAt',CASE WHEN TG_OP='DELETE' THEN to_jsonb(clock_timestamp()) ELSE NULL END));
  ELSIF TG_TABLE_NAME='seat_reservations' THEN
    IF TG_OP='UPDATE' AND NEW.status=OLD.status THEN RETURN NEW; END IF;
    SELECT * INTO session FROM public.product_sessions WHERE id=(r->>'session_id')::uuid;
    pid := session.product_id;
    SELECT * INTO tx FROM public.payment_transactions WHERE id=(r->>'transaction_id')::uuid;
    event := 'seats.'||(r->>'status');
    reason := CASE r->>'status' WHEN 'confirmed' THEN 'payment_confirmed' WHEN 'held' THEN 'checkout_started'
      ELSE CASE tx.status WHEN 'abandoned' THEN 'order_abandoned' WHEN 'refunded' THEN 'payment_refunded' WHEN 'cancelled' THEN 'order_cancelled' ELSE CASE WHEN (r->>'expires_at')::timestamptz<=now() THEN 'hold_expired' ELSE 'reservation_released' END END END;
    payload := jsonb_build_object('customer',jsonb_build_object('userId',tx.user_id,'email',tx.customer_email),
      'order',jsonb_build_object('orderId',tx.id,'orderNumber',tx.order_number),
      'reservation',jsonb_build_object('id',r->'id','sessionId',r->'session_id','tierId',r->'tier_id','quantity',r->'quantity',
        'sessionStartsAt',session.starts_at,'sessionLabel',session.title,'statusBefore',previous->'status','statusAfter',r->'status',
        'expiresAt',r->'expires_at','confirmedAt',r->'confirmed_at','releasedAt',r->'released_at'));
  ELSE
    IF TG_OP<>'UPDATE' OR OLD.status=NEW.status OR NEW.status<>'abandoned' THEN RETURN NEW; END IF;
    pid := NEW.product_id; event := 'order.abandoned'; reason := 'checkout_expired';
    payload := jsonb_build_object('amountUnit','minor','customer',jsonb_build_object('userId',NEW.user_id,'email',NEW.customer_email),
      'order',jsonb_build_object('orderId',NEW.id,'orderNumber',NEW.order_number,'paymentProvider',NEW.payment_provider,
        'sessionId',NEW.session_id,'paymentIntentId',NEW.stripe_payment_intent_id,'amount',NEW.amount,'grossTotal',NEW.amount,
        'currency',NEW.currency,'netTotal',NEW.net_total,'taxTotal',NEW.tax_total,'taxSnapshotStatus',NEW.tax_snapshot_status,
        'statusBefore',OLD.status,'statusAfter',NEW.status),
      'lines',(SELECT coalesce(jsonb_agg(to_jsonb(l)-'metadata'),'[]') FROM public.payment_line_items l WHERE l.transaction_id=NEW.id));
  END IF;
  SELECT jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug) INTO product FROM public.products p WHERE p.id=pid;
  payload := payload||jsonb_build_object('product',coalesce(product,jsonb_build_object('id',pid)),'reason',reason,'actor',actor,'occurredAt',clock_timestamp());
  INSERT INTO public.business_events(event_type,product_id,payload,deduplication_key) VALUES(event,pid,payload,key) ON CONFLICT(deduplication_key) DO NOTHING;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.capture_business_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER access_business_event AFTER INSERT OR UPDATE OR DELETE ON public.user_product_access FOR EACH ROW EXECUTE FUNCTION public.capture_business_event();
CREATE TRIGGER seats_business_event AFTER INSERT OR UPDATE ON public.seat_reservations FOR EACH ROW EXECUTE FUNCTION public.capture_business_event();
CREATE TRIGGER order_business_event AFTER UPDATE OF status ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.capture_business_event();

CREATE FUNCTION public.claim_business_events(p_limit integer DEFAULT 100) RETURNS SETOF public.business_events
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH picked AS (SELECT id FROM public.business_events WHERE dispatched_at IS NULL AND (leased_until IS NULL OR leased_until<now())
    ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(p_limit,100))),
  leased AS (UPDATE public.business_events b SET leased_until=now()+interval '1 minute' FROM picked WHERE b.id=picked.id RETURNING b.*)
  SELECT * FROM leased ORDER BY created_at,id;
$$;
REVOKE ALL ON FUNCTION public.claim_business_events(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_business_events(integer) TO service_role;
CREATE FUNCTION public.capture_expired_access() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE count integer;
BEGIN
  UPDATE public.user_product_access SET expiry_notified_at=now() WHERE id IN (
    SELECT id FROM public.user_product_access WHERE access_expires_at<=now() AND (expiry_notified_at IS NULL OR expiry_notified_at<access_expires_at)
    ORDER BY access_expires_at FOR UPDATE SKIP LOCKED LIMIT 100);
  GET DIAGNOSTICS count=ROW_COUNT; RETURN count;
END $$;
REVOKE ALL ON FUNCTION public.capture_expired_access() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.capture_expired_access() TO service_role;

CREATE FUNCTION public.mutate_access(p_action text,p_user_id uuid,p_product_id uuid DEFAULT NULL,p_access_id uuid DEFAULT NULL,p_values jsonb DEFAULT '{}',p_actor jsonb DEFAULT '{}')
RETURNS SETOF public.user_product_access LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF coalesce(p_actor->>'type','') NOT IN ('user','api_key') OR p_actor->>'id' IS NULL THEN RAISE EXCEPTION 'Actor required'; END IF;
  PERFORM (p_actor->>'id')::uuid;
  IF (p_values->>'access_duration_days')::integer NOT BETWEEN 1 AND 3650 THEN RAISE EXCEPTION 'Invalid access duration'; END IF;
  PERFORM set_config('sellf.event_context',jsonb_build_object('actor',p_actor,'reason','admin_'||p_action)::text,true);
  IF p_action='grant' THEN
    RETURN QUERY INSERT INTO public.user_product_access(user_id,product_id,access_duration_days,access_expires_at)
      VALUES(p_user_id,p_product_id,(p_values->>'access_duration_days')::integer,(p_values->>'access_expires_at')::timestamptz) RETURNING *;
  ELSIF p_action='update' THEN
    RETURN QUERY UPDATE public.user_product_access a SET
      access_expires_at=CASE WHEN p_values ? 'access_expires_at' THEN (p_values->>'access_expires_at')::timestamptz ELSE a.access_expires_at END,
      access_duration_days=CASE WHEN p_values ? 'access_duration_days' THEN (p_values->>'access_duration_days')::integer ELSE a.access_duration_days END
      WHERE a.user_id=p_user_id AND a.id=p_access_id RETURNING *;
  ELSIF p_action='revoke' THEN
    RETURN QUERY DELETE FROM public.user_product_access a WHERE a.user_id=p_user_id AND (a.id=p_access_id OR (p_access_id IS NULL AND a.product_id=p_product_id)) RETURNING *;
  ELSE RAISE EXCEPTION 'Invalid access action'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.mutate_access(text,uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_access(text,uuid,uuid,uuid,jsonb,jsonb) TO service_role;
