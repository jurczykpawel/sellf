

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

-- ===== Source: 20261029164003_free_grant_field_context.sql =====
-- Keep validated free-checkout answers outside authentication metadata.
ALTER TABLE public.user_product_access ADD COLUMN custom_field_values jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(custom_field_values)='object');
CREATE TABLE public.free_grant_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  custom_field_values jsonb NOT NULL CHECK (jsonb_typeof(custom_field_values)='object' AND octet_length(custom_field_values::text)<=10000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
  claimed_at timestamptz
);
ALTER TABLE public.free_grant_contexts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.free_grant_contexts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.free_grant_contexts TO service_role;
CREATE POLICY free_grant_context_service ON public.free_grant_contexts FOR ALL TO service_role
 USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');
CREATE INDEX free_grant_context_email_product_idx ON public.free_grant_contexts(email,product_id,created_at DESC) WHERE claimed_at IS NULL;
CREATE INDEX free_grant_context_product_idx ON public.free_grant_contexts(product_id);
CREATE INDEX free_grant_context_claimed_idx ON public.free_grant_contexts(claimed_at) WHERE claimed_at IS NOT NULL;
CREATE INDEX free_grant_context_expiry_idx ON public.free_grant_contexts(expires_at);
CREATE FUNCTION public.prepare_free_grant(p_email text,p_product_id uuid,p_values jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid;
BEGIN
 IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=p_product_id AND is_active) THEN RAISE EXCEPTION 'Product unavailable'; END IF;
 DELETE FROM public.free_grant_contexts WHERE email=lower(trim(p_email)) AND expires_at<now();
 IF (SELECT count(DISTINCT product_id) FROM public.free_grant_contexts WHERE email=lower(trim(p_email)) AND claimed_at IS NULL)>=20 AND NOT EXISTS(SELECT 1 FROM public.free_grant_contexts WHERE email=lower(trim(p_email)) AND product_id=p_product_id AND claimed_at IS NULL) THEN RAISE EXCEPTION 'Too many pending products'; END IF;
 INSERT INTO public.free_grant_contexts(email,product_id,custom_field_values) VALUES(lower(trim(p_email)),p_product_id,p_values) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.prepare_free_grant(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_free_grant(text,uuid,jsonb) TO service_role;
CREATE FUNCTION public.free_grant_context(p_product_id uuid,p_request_id uuid DEFAULT NULL)
RETURNS TABLE(request_id uuid,custom_field_values jsonb) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT c.id,c.custom_field_values FROM public.free_grant_contexts c JOIN auth.users u ON lower(u.email)=c.email
 WHERE u.id=(select auth.uid()) AND u.email_confirmed_at IS NOT NULL AND c.product_id=p_product_id
  AND c.claimed_at IS NULL AND c.expires_at>now() AND (p_request_id IS NULL OR c.id=p_request_id)
 ORDER BY c.created_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.free_grant_context(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.free_grant_context(uuid,uuid) TO authenticated;

ALTER FUNCTION public.pending_free_grant_products() RENAME TO legacy_pending_free_grant_products;
REVOKE ALL ON FUNCTION public.legacy_pending_free_grant_products() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.pending_free_grant_products() RETURNS TABLE(product_id uuid,slug text,request_id uuid,custom_field_values jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 WITH owner AS (SELECT lower(email) AS email FROM auth.users WHERE id=(select auth.uid()) AND email_confirmed_at IS NOT NULL),
 intents AS (SELECT l.product_id FROM public.legacy_pending_free_grant_products() l
  UNION SELECT c.product_id FROM public.free_grant_contexts c,owner u WHERE c.email=u.email AND c.claimed_at IS NULL AND c.expires_at>now())
 SELECT p.id,p.slug,c.id,c.custom_field_values FROM intents i JOIN public.products p ON p.id=i.product_id CROSS JOIN owner u
 LEFT JOIN LATERAL(SELECT * FROM public.free_grant_contexts c WHERE c.email=u.email AND c.product_id=p.id AND c.claimed_at IS NULL AND c.expires_at>now() ORDER BY created_at DESC LIMIT 1)c ON true
 WHERE public.is_free_claimable_product(p.id) AND NOT EXISTS(SELECT 1 FROM public.user_product_access a WHERE a.user_id=(select auth.uid()) AND a.product_id=p.id AND (a.access_expires_at IS NULL OR a.access_expires_at>now()));
$$;
REVOKE ALL ON FUNCTION public.pending_free_grant_products() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pending_free_grant_products() TO authenticated,service_role;

CREATE FUNCTION public.copy_free_grant_fields() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fields jsonb;
BEGIN
 IF NEW.user_id=(select auth.uid()) THEN
  SELECT c.custom_field_values INTO fields FROM public.free_grant_contexts c JOIN auth.users u ON lower(u.email)=c.email
   WHERE c.id=nullif(current_setting('sellf.free_grant_context',true),'')::uuid AND c.product_id=NEW.product_id AND u.id=NEW.user_id AND c.expires_at>now() AND c.claimed_at IS NULL;
  IF fields IS NOT NULL THEN NEW.custom_field_values=fields; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.copy_free_grant_fields() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER free_grant_fields BEFORE INSERT OR UPDATE ON public.user_product_access FOR EACH ROW EXECUTE FUNCTION public.copy_free_grant_fields();
CREATE FUNCTION public.grant_free_with_context(product_slug_param text,coupon_code_param text DEFAULT NULL,p_request_id uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid; context_id uuid; result boolean;
BEGIN
 SELECT id INTO pid FROM public.products WHERE slug=product_slug_param;
 SELECT c.request_id INTO context_id FROM public.free_grant_context(pid,p_request_id)c;
 IF p_request_id IS NOT NULL AND context_id IS NULL THEN RETURN false; END IF;
 PERFORM set_config('sellf.free_grant_context',coalesce(context_id::text,''),true);
 SELECT public.grant_free_product_access(product_slug_param,NULL,coupon_code_param) INTO result;
 IF result AND context_id IS NOT NULL THEN
  UPDATE public.free_grant_contexts SET claimed_at=now() WHERE email=(SELECT lower(email) FROM auth.users WHERE id=(select auth.uid())) AND product_id=pid AND claimed_at IS NULL;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.grant_free_with_context(text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.grant_free_with_context(text,text,uuid) TO authenticated;
SELECT cron.schedule('free-grant-context-cleanup','17 * * * *',$$DELETE FROM public.free_grant_contexts WHERE expires_at<now() OR claimed_at<now()-interval '1 day'$$);

CREATE OR REPLACE FUNCTION public.capture_business_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
      AND NEW.custom_field_values IS NOT DISTINCT FROM OLD.custom_field_values AND NEW.access_granted_at=OLD.access_granted_at AND NEW.access_duration_days IS NOT DISTINCT FROM OLD.access_duration_days
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
    payload := jsonb_build_object('customFieldValues',r->'custom_field_values','customer',jsonb_build_object('userId',uid,'email',email),
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

-- ===== Source: 20261031084600_legacy_purchase_mail_context.sql =====
-- Historical guest rows retain their original session association for access mail.
CREATE OR REPLACE FUNCTION public.event_mail_access(p_email text,p_product_id uuid,p_transaction_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
SELECT EXISTS(SELECT 1 FROM public.user_product_access a JOIN auth.users u ON u.id=a.user_id
  WHERE lower(u.email)=lower(p_email) AND a.product_id=p_product_id AND (a.access_expires_at IS NULL OR a.access_expires_at>now()))
OR EXISTS(SELECT 1 FROM public.guest_purchases g
  WHERE lower(g.customer_email)=lower(p_email) AND g.product_id=p_product_id AND g.claimed_by_user_id IS NULL
    AND (g.transaction_id=p_transaction_id OR (g.transaction_id IS NULL AND EXISTS(
      SELECT 1 FROM public.payment_transactions t WHERE t.id=p_transaction_id AND t.product_id=g.product_id
        AND lower(t.customer_email)=lower(g.customer_email) AND t.status='completed'
        AND t.session_id IS NOT NULL AND t.session_id=g.session_id))));
$$;
REVOKE ALL ON FUNCTION public.event_mail_access(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_mail_access(text,uuid,uuid) TO service_role;

-- ===== Source: 20261101035039_payment_dispute_state.sql =====
-- Persist dispute decisions and the original entitlement before suspension.
ALTER TABLE public.user_product_access DROP CONSTRAINT check_access_expiration;
ALTER TABLE public.user_product_access ADD CONSTRAINT check_access_expiration
  CHECK (access_expires_at IS NULL OR access_expires_at >= access_granted_at);
CREATE TABLE public.payment_disputes (
  stripe_dispute_id text PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  status text NOT NULL,
  previous_payment_status text NOT NULL,
  suspended_at timestamptz NOT NULL,
  account_access jsonb NOT NULL DEFAULT '[]',
  guest_access jsonb NOT NULL DEFAULT '[]',
  payload jsonb NOT NULL DEFAULT '{}',
  closed boolean NOT NULL DEFAULT false
);
CREATE INDEX payment_disputes_transaction_idx ON public.payment_disputes(transaction_id);
CREATE INDEX payment_disputes_open_idx ON public.payment_disputes(transaction_id) WHERE NOT closed AND status<>'won';
ALTER TABLE public.payment_disputes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_disputes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payment_disputes TO service_role;
CREATE POLICY payment_disputes_service ON public.payment_disputes FOR ALL TO service_role
  USING ((select auth.role())='service_role') WITH CHECK ((select auth.role())='service_role');

CREATE FUNCTION public.apply_payment_dispute(
  p_transaction_id uuid, p_dispute_id text, p_status text, p_closed boolean,
  p_reason text, p_amount integer, p_currency text, p_created timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.payment_transactions;
  d public.payment_disputes;
  original jsonb; item jsonb; result jsonb; product_ids uuid[]; buyer_ids uuid[];
  stamp timestamptz := now();
  restored_access jsonb := '[]'; term record;
  restored boolean := false; changed integer; entitled boolean; can_restore boolean;
  next_status text; stripe_subscription text;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_dispute_id IS NULL OR length(p_dispute_id)>255 OR p_status NOT IN
    ('needs_response','under_review','won','lost','warning_needs_response','warning_under_review','warning_closed')
    OR p_amount<0 OR p_currency IS NULL THEN RAISE EXCEPTION 'Invalid dispute'; END IF;
  SELECT * INTO STRICT t FROM public.payment_transactions WHERE id=p_transaction_id FOR UPDATE;
  IF t.status='pending' THEN RAISE EXCEPTION 'Payment awaiting completion' USING ERRCODE='40001'; END IF;
  SELECT * INTO d FROM public.payment_disputes WHERE stripe_dispute_id=p_dispute_id;
  IF FOUND THEN
    IF d.transaction_id<>t.id THEN RAISE EXCEPTION 'Dispute binding differs'; END IF;
    IF d.closed AND (NOT p_closed OR d.status<>p_status) THEN RETURN NULL; END IF;
    IF d.status=p_status AND d.closed=p_closed THEN RETURN d.payload; END IF;
  ELSE
    SELECT array_agg(DISTINCT id) INTO product_ids FROM (
      SELECT t.product_id id UNION SELECT product_id FROM public.payment_line_items WHERE transaction_id=t.id
      UNION SELECT component_product_id FROM public.bundle_items WHERE bundle_product_id=t.product_id
      UNION SELECT b.component_product_id FROM public.bundle_items b JOIN public.payment_line_items l
        ON l.product_id=b.bundle_product_id WHERE l.transaction_id=t.id
    ) products;
    SELECT array_agg(DISTINCT id) INTO buyer_ids FROM (
      SELECT t.user_id id UNION SELECT claimed_by_user_id FROM public.guest_purchases
        WHERE session_id=t.session_id OR transaction_id=t.id
    ) buyers WHERE id IS NOT NULL;
    entitled := t.status NOT IN ('refunded','cancelled') AND coalesce(t.refunded_amount,0)<t.amount;
    INSERT INTO public.payment_disputes(stripe_dispute_id,transaction_id,status,previous_payment_status,suspended_at)
      VALUES(p_dispute_id,t.id,p_status,CASE WHEN t.status='disputed' THEN
        CASE WHEN coalesce(t.refunded_amount,0)>0 THEN 'partially_refunded' ELSE 'completed' END ELSE t.status END,stamp)
      RETURNING * INTO d;
    IF entitled AND p_status<>'won' THEN
      PERFORM set_config('sellf.event_context','{"reason":"stripe_dispute"}',true);
      FOR original IN SELECT to_jsonb(a) FROM public.user_product_access a
        WHERE a.user_id=ANY(buyer_ids) AND a.product_id=ANY(product_ids)
        AND (a.access_expires_at IS NULL OR a.access_expires_at>stamp)
        AND (a.subscription_id IS NULL OR a.subscription_id=t.subscription_id)
        AND (a.transfer_transaction_id IS NULL OR a.transfer_transaction_id=t.id) FOR UPDATE
      LOOP
        d.account_access := d.account_access||jsonb_build_array(original);
        UPDATE public.user_product_access SET access_expires_at=stamp,expiry_notified_at=stamp WHERE id=(original->>'id')::uuid;
      END LOOP;
      WITH removed AS (
        DELETE FROM public.guest_purchases WHERE (session_id=t.session_id OR transaction_id=t.id)
          AND claimed_by_user_id IS NULL RETURNING *
      ) SELECT coalesce(jsonb_agg(jsonb_set(to_jsonb(removed),'{metadata}',coalesce(removed.metadata,'{}')||
        jsonb_build_object('_dispute_access_terms',coalesce(removed.metadata->'_dispute_access_terms',(
          SELECT jsonb_object_agg(p.id::text,jsonb_build_object('grantedAt',removed.created_at,'expiresAt',
            CASE WHEN coalesce((SELECT l.access_duration_override FROM public.payment_line_items l
              WHERE l.transaction_id=t.id AND l.product_id=p.id LIMIT 1),p.auto_grant_duration_days) IS NULL THEN NULL
            ELSE removed.created_at+make_interval(days=>coalesce((SELECT l.access_duration_override FROM public.payment_line_items l
              WHERE l.transaction_id=t.id AND l.product_id=p.id LIMIT 1),p.auto_grant_duration_days)) END))
          FROM public.products p WHERE p.id=ANY(product_ids)
        ))))),'[]') INTO d.guest_access FROM removed;
      UPDATE public.payment_disputes SET account_access=d.account_access,guest_access=d.guest_access WHERE stripe_dispute_id=p_dispute_id;
    END IF;
  END IF;

  next_status := t.status;
  IF p_status='won' THEN
    next_status := CASE WHEN t.status IN ('refunded','cancelled') THEN t.status
      WHEN coalesce(t.refunded_amount,0)>=t.amount THEN 'refunded'
      WHEN coalesce(t.refunded_amount,0)>0 THEN 'partially_refunded'
      ELSE d.previous_payment_status END;
    can_restore := next_status IN ('completed','partially_refunded') AND NOT EXISTS(
      SELECT 1 FROM public.payment_disputes other WHERE other.transaction_id=t.id AND other.stripe_dispute_id<>p_dispute_id AND other.status<>'won');
    IF t.subscription_id IS NOT NULL THEN
      can_restore := can_restore AND EXISTS(SELECT 1 FROM public.subscriptions s WHERE s.id=t.subscription_id
        AND s.status IN ('active','trialing','past_due') AND (s.current_period_end IS NULL OR s.current_period_end>stamp));
    END IF;
    IF can_restore THEN
      PERFORM set_config('sellf.event_context','{"reason":"dispute_won"}',true);
      FOR item IN SELECT value FROM jsonb_array_elements(d.account_access) LOOP
        IF item->>'access_expires_at' IS NULL OR (item->>'access_expires_at')::timestamptz>stamp THEN
          UPDATE public.user_product_access SET access_expires_at=(item->>'access_expires_at')::timestamptz,
            expiry_notified_at=(item->>'expiry_notified_at')::timestamptz
            WHERE id=(item->>'id')::uuid AND access_expires_at=d.suspended_at
              AND user_id=(item->>'user_id')::uuid AND product_id=(item->>'product_id')::uuid
              AND subscription_id IS NOT DISTINCT FROM (item->>'subscription_id')::uuid
              AND access_duration_days IS NOT DISTINCT FROM (item->>'access_duration_days')::integer;
          GET DIAGNOSTICS changed=ROW_COUNT; restored := restored OR changed>0;
          IF changed>0 THEN restored_access:=restored_access||jsonb_build_array(jsonb_build_object(
            'productId',item->'product_id','userId',item->'user_id','grantedAt',item->'access_granted_at','expiresAt',item->'access_expires_at')); END IF;
        END IF;
      END LOOP;
      FOR item IN SELECT value FROM jsonb_array_elements(d.guest_access) LOOP
        IF EXISTS(SELECT 1 FROM jsonb_each(item->'metadata'->'_dispute_access_terms') saved
          WHERE saved.value->>'expiresAt' IS NULL OR (saved.value->>'expiresAt')::timestamptz>stamp) THEN
          INSERT INTO public.guest_purchases SELECT (jsonb_populate_record(NULL::public.guest_purchases,item)).*
            ON CONFLICT DO NOTHING;
          GET DIAGNOSTICS changed=ROW_COUNT; restored := restored OR changed>0;
          IF changed>0 THEN
            FOR term IN SELECT * FROM jsonb_each(item->'metadata'->'_dispute_access_terms') LOOP
              IF term.value->>'expiresAt' IS NULL OR (term.value->>'expiresAt')::timestamptz>stamp THEN
                restored_access:=restored_access||jsonb_build_array(jsonb_build_object('productId',term.key,'userId',NULL,
                  'guestPurchaseId',item->'id','grantedAt',term.value->'grantedAt','expiresAt',term.value->'expiresAt'));
              END IF;
            END LOOP;
          END IF;
        END IF;
      END LOOP;
    END IF;
  ELSIF t.status NOT IN ('refunded','cancelled') THEN next_status := 'disputed';
  END IF;
  UPDATE public.payment_transactions SET status=next_status,updated_at=stamp,
    metadata=coalesce(metadata,'{}')||jsonb_build_object('dispute_id',p_dispute_id,'dispute_reason',p_reason,
      'dispute_status',p_status,'dispute_created',p_created)
    WHERE id=t.id;
  SELECT stripe_subscription_id INTO stripe_subscription FROM public.subscriptions WHERE id=t.subscription_id;
  result := jsonb_build_object(
    'customer',jsonb_build_object('email',t.customer_email,'userId',t.user_id),
    'product',jsonb_build_object('id',t.product_id),
    'payment',jsonb_build_object('id',t.id,'amount',t.amount,'currency',t.currency,'sessionId',t.session_id,
      'paymentIntentId',t.stripe_payment_intent_id,'stripeInvoiceId',t.stripe_invoice_id,'subscriptionId',t.subscription_id,
      'statusBefore',t.status,'statusAfter',next_status),
    'dispute',jsonb_build_object('stripeDisputeId',p_dispute_id,'status',p_status,'reason',p_reason,'amount',p_amount,
      'currency',upper(p_currency),'createdAt',p_created,'accessRevoked',p_status<>'won','accessRestored',restored,
      'licenseRestored',false,'restoredAccess',restored_access));
  IF t.subscription_id IS NOT NULL THEN result:=result||jsonb_build_object('subscription',jsonb_build_object(
    'id',t.subscription_id,'stripeSubscriptionId',stripe_subscription)); END IF;
  UPDATE public.payment_disputes SET status=p_status,closed=p_closed,payload=result WHERE stripe_dispute_id=p_dispute_id;
  PERFORM set_config('sellf.event_context','',true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.apply_payment_dispute(uuid,text,text,boolean,text,integer,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_payment_dispute(uuid,text,text,boolean,text,integer,text,timestamptz) TO service_role;


CREATE FUNCTION public.retain_disputed_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pending public.payment_disputes;
  context jsonb := coalesce(nullif(current_setting('sellf.event_context',true),'')::jsonb,'{}');
  term jsonb := context->'guest_dispute_terms'->NEW.product_id::text;
BEGIN
  IF term IS NOT NULL THEN
    NEW.access_granted_at:=least(NEW.access_granted_at,(term->>'grantedAt')::timestamptz);
    IF TG_OP='UPDATE' AND (OLD.access_expires_at IS NULL OR OLD.access_expires_at>(term->>'expiresAt')::timestamptz) THEN
      NEW.access_expires_at:=OLD.access_expires_at;
    ELSE NEW.access_expires_at:=(term->>'expiresAt')::timestamptz; END IF;
  END IF;
  IF context->'actor' IS NOT NULL OR context->>'reason'='dispute_won' THEN RETURN NEW; END IF;
  FOR pending IN SELECT d.* FROM public.payment_disputes d
    WHERE NOT d.closed AND d.status<>'won' AND EXISTS(
      SELECT 1 FROM jsonb_array_elements(d.account_access) a
        WHERE a->>'user_id'=NEW.user_id::text AND a->>'product_id'=NEW.product_id::text)
  LOOP
    IF TG_OP='INSERT' THEN RETURN NULL; END IF;
    IF OLD.access_expires_at=pending.suspended_at AND NEW.access_expires_at=OLD.access_expires_at THEN
      NEW.access_expires_at:=OLD.access_expires_at;
      NEW.access_granted_at:=OLD.access_granted_at;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.retain_disputed_access() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER retain_disputed_access BEFORE INSERT OR UPDATE ON public.user_product_access
  FOR EACH ROW EXECUTE FUNCTION public.retain_disputed_access();


ALTER FUNCTION public.claim_guest_purchases_for_user(uuid) RENAME TO _claim_guest_purchases_before_disputes;
REVOKE ALL ON FUNCTION public._claim_guest_purchases_before_disputes(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.claim_guest_purchases_for_user(p_user_id uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  buyer_email text; purchase public.guest_purchases; term record; terms jsonb := '{}';
  saved_context text := current_setting('sellf.event_context',true); result json;
BEGIN
  SELECT email INTO buyer_email FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL;
  FOR purchase IN SELECT * FROM public.guest_purchases WHERE customer_email=buyer_email AND claimed_by_user_id IS NULL
    AND metadata ? '_dispute_access_terms' FOR UPDATE
  LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_each(purchase.metadata->'_dispute_access_terms') saved
      WHERE saved.value->>'expiresAt' IS NULL OR (saved.value->>'expiresAt')::timestamptz>clock_timestamp()) THEN
      UPDATE public.guest_purchases SET claimed_by_user_id=p_user_id,claimed_at=now() WHERE id=purchase.id;
      CONTINUE;
    END IF;
    FOR term IN SELECT * FROM jsonb_each(purchase.metadata->'_dispute_access_terms') LOOP
      IF NOT terms ? term.key OR (terms->term.key->>'expiresAt' IS NOT NULL AND
        (term.value->>'expiresAt' IS NULL OR (term.value->>'expiresAt')::timestamptz>(terms->term.key->>'expiresAt')::timestamptz)) THEN
        terms:=terms||jsonb_build_object(term.key,term.value);
      END IF;
    END LOOP;
  END LOOP;
  -- A separate newly claimable order retains its own normal grant policy.
  FOR term IN SELECT DISTINCT p.id::text key FROM public.guest_purchases g JOIN public.products p ON
    p.id=g.product_id OR EXISTS(SELECT 1 FROM public.bundle_items b WHERE b.bundle_product_id=g.product_id AND b.component_product_id=p.id)
    OR EXISTS(SELECT 1 FROM public.payment_line_items l WHERE l.transaction_id=g.transaction_id AND l.product_id=p.id)
    WHERE g.customer_email=buyer_email AND g.claimed_by_user_id IS NULL AND NOT g.metadata ? '_dispute_access_terms'
  LOOP terms:=terms-term.key; END LOOP;
  PERFORM set_config('sellf.event_context',(coalesce(nullif(saved_context,'')::jsonb,'{}')||jsonb_build_object('guest_dispute_terms',terms))::text,true);
  result:=public._claim_guest_purchases_before_disputes(p_user_id);
  PERFORM set_config('sellf.event_context',coalesce(saved_context,''),true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.claim_guest_purchases_for_user(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_purchases_for_user(uuid) TO service_role;

-- ===== Source: 20261101041746_zero_subscription_invoice_amounts.sql =====
-- Stripe issues a paid zero-total invoice when a subscription trial starts.
-- Retain positive-only amounts for orders without a subscription invoice.
ALTER TABLE public.payment_transactions
  DROP CONSTRAINT payment_transactions_amount_check;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_amount_check CHECK (
    amount <= 99999999 AND (
      amount > 0 OR (
        amount = 0 AND subscription_id IS NOT NULL AND stripe_invoice_id IS NOT NULL
      )
    )
  );

-- ===== Source: 20261101141003_license_dispute_restoration.sql =====
-- Record license revocation ownership and commit status notifications with each change.
ALTER TABLE public.payment_disputes ADD COLUMN revoked_license_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.issued_licenses ADD COLUMN revoked_by_dispute_id text DEFAULT NULL
  REFERENCES public.payment_disputes(stripe_dispute_id) ON DELETE SET NULL;
ALTER TABLE public.issued_licenses ADD CONSTRAINT issued_license_dispute_requires_revocation
  CHECK (revoked_by_dispute_id IS NULL OR revoked_at IS NOT NULL);
CREATE INDEX issued_licenses_dispute_idx ON public.issued_licenses(revoked_by_dispute_id) WHERE revoked_by_dispute_id IS NOT NULL;
ALTER TABLE public.business_events DROP CONSTRAINT business_events_event_type_check;
ALTER TABLE public.business_events ADD CONSTRAINT business_events_event_type_check CHECK (event_type IN (
  'access.granted','access.updated','access.revoked','access.expired','order.abandoned',
  'seats.held','seats.confirmed','seats.released','license.revoked','license.restored'));

CREATE FUNCTION public.license_event_snapshot(p_license public.issued_licenses) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE claims jsonb; encoded text; tier text; product jsonb;
BEGIN
  BEGIN
    encoded:=translate(split_part(p_license.license_key,'.',1),'-_','+/');
    encoded:=encoded||repeat('=',(4-length(encoded)%4)%4);
    claims:=convert_from(decode(encoded,'base64'),'UTF8')::jsonb;
    tier:=CASE WHEN jsonb_typeof(claims->'tier')='string' THEN claims->>'tier' ELSE NULL END;
  EXCEPTION WHEN OTHERS THEN tier:=NULL;
  END;
  SELECT jsonb_build_object('name',p.name,'slug',p.slug,'license_tier',tier) INTO product
    FROM public.products p WHERE p.id=p_license.product_id;
  RETURN jsonb_build_object('id',p_license.id,'product_id',p_license.product_id,'email',p_license.email,
    'order_id',p_license.order_id,'seller_id',p_license.seller_id,'original_seller_id',p_license.original_seller_id,
    'license_domain',p_license.license_domain,'issuance_source',p_license.issuance_source,
    'issued_at',p_license.issued_at,'expires_at',p_license.expires_at,'revoked_at',p_license.revoked_at,'products',product);
END $$;
REVOKE ALL ON FUNCTION public.license_event_snapshot(public.issued_licenses) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.clear_license_dispute_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.revoked_by_dispute_id IS NOT DISTINCT FROM OLD.revoked_by_dispute_id THEN
    NEW.revoked_by_dispute_id:=NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clear_license_dispute_owner() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER clear_license_dispute_owner BEFORE UPDATE OF revoked_at ON public.issued_licenses
  FOR EACH ROW EXECUTE FUNCTION public.clear_license_dispute_owner();

CREATE FUNCTION public.capture_license_status_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.revoked_at IS NULL)=(OLD.revoked_at IS NULL) THEN RETURN NEW; END IF;
  INSERT INTO public.business_events(event_type,product_id,payload)
    VALUES(CASE WHEN NEW.revoked_at IS NULL THEN 'license.restored' ELSE 'license.revoked' END,
      NEW.product_id,jsonb_build_object('licenseRow',public.license_event_snapshot(NEW),
      'disputeId',coalesce(NEW.revoked_by_dispute_id,OLD.revoked_by_dispute_id)));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_license_status_event() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER capture_license_status_event AFTER UPDATE OF revoked_at ON public.issued_licenses
  FOR EACH ROW EXECUTE FUNCTION public.capture_license_status_event();

CREATE FUNCTION public.revoke_issued_licenses(p_license_ids uuid[],p_actor uuid DEFAULT NULL)
RETURNS TABLE(id uuid,changed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item record;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF cardinality(p_license_ids)>100 THEN RAISE EXCEPTION 'Too many license identifiers'; END IF;
  FOR item IN SELECT l.id,l.product_id,l.email,l.order_id,l.revoked_at FROM public.issued_licenses l
    WHERE l.id=ANY(p_license_ids) ORDER BY l.id FOR UPDATE
  LOOP
    UPDATE public.issued_licenses l SET revoked_at=coalesce(item.revoked_at,now()),revoked_by_dispute_id=NULL WHERE l.id=item.id;
    IF p_actor IS NOT NULL THEN
      INSERT INTO public.audit_log(table_name,operation,performed_by,old_values,new_values)
        VALUES('issued_licenses','UPDATE',p_actor,
          jsonb_build_object('license_id',item.id,'product_id',item.product_id,'email',item.email,'order_id',item.order_id,'revoked_at',item.revoked_at),
          jsonb_build_object('action','license_revoked','license_id',item.id,'permanent',true));
    END IF;
    id:=item.id;changed:=item.revoked_at IS NULL;RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.revoke_issued_licenses(uuid[],uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_issued_licenses(uuid[],uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_payment_dispute(
  p_transaction_id uuid, p_dispute_id text, p_status text, p_closed boolean,
  p_reason text, p_amount integer, p_currency text, p_created timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.payment_transactions;
  d public.payment_disputes;
  original jsonb; item jsonb; result jsonb; product_ids uuid[]; buyer_ids uuid[];
  stamp timestamptz := now();
  restored_access jsonb := '[]'; term record;
  restored boolean := false; changed integer; entitled boolean; can_restore boolean;
  next_status text; stripe_subscription text;
  license record; restored_license public.issued_licenses; restored_licenses jsonb:='[]'; can_restore_license boolean;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_dispute_id IS NULL OR length(p_dispute_id)>255 OR p_status NOT IN
    ('needs_response','under_review','won','lost','warning_needs_response','warning_under_review','warning_closed')
    OR p_amount<0 OR p_currency IS NULL THEN RAISE EXCEPTION 'Invalid dispute'; END IF;
  SELECT * INTO STRICT t FROM public.payment_transactions WHERE id=p_transaction_id FOR UPDATE;
  IF t.status='pending' THEN RAISE EXCEPTION 'Payment awaiting completion' USING ERRCODE='40001'; END IF;
  SELECT * INTO d FROM public.payment_disputes WHERE stripe_dispute_id=p_dispute_id;
  IF FOUND THEN
    IF d.transaction_id<>t.id THEN RAISE EXCEPTION 'Dispute binding differs'; END IF;
    IF d.closed AND (NOT p_closed OR d.status<>p_status) THEN RETURN NULL; END IF;
    IF d.status=p_status AND d.closed=p_closed THEN RETURN d.payload; END IF;
  ELSE
    SELECT array_agg(DISTINCT id) INTO product_ids FROM (
      SELECT t.product_id id UNION SELECT product_id FROM public.payment_line_items WHERE transaction_id=t.id
      UNION SELECT component_product_id FROM public.bundle_items WHERE bundle_product_id=t.product_id
      UNION SELECT b.component_product_id FROM public.bundle_items b JOIN public.payment_line_items l
        ON l.product_id=b.bundle_product_id WHERE l.transaction_id=t.id
    ) products;
    SELECT array_agg(DISTINCT id) INTO buyer_ids FROM (
      SELECT t.user_id id UNION SELECT claimed_by_user_id FROM public.guest_purchases
        WHERE session_id=t.session_id OR transaction_id=t.id
    ) buyers WHERE id IS NOT NULL;
    entitled := t.status NOT IN ('refunded','cancelled') AND coalesce(t.refunded_amount,0)<t.amount;
    INSERT INTO public.payment_disputes(stripe_dispute_id,transaction_id,status,previous_payment_status,suspended_at)
      VALUES(p_dispute_id,t.id,p_status,CASE WHEN t.status='disputed' THEN
        CASE WHEN coalesce(t.refunded_amount,0)>0 THEN 'partially_refunded' ELSE 'completed' END ELSE t.status END,stamp)
      RETURNING * INTO d;
    IF entitled AND p_status<>'won' THEN
      FOR license IN SELECT l.id FROM public.issued_licenses l WHERE l.product_id=t.product_id
        AND l.order_id IN (t.stripe_payment_intent_id,t.session_id) AND l.revoked_at IS NULL ORDER BY l.id FOR UPDATE
      LOOP
        UPDATE public.issued_licenses l SET revoked_at=stamp,revoked_by_dispute_id=p_dispute_id WHERE l.id=license.id;
        d.revoked_license_ids:=array_append(d.revoked_license_ids,license.id);
      END LOOP;
      UPDATE public.payment_disputes SET revoked_license_ids=d.revoked_license_ids WHERE stripe_dispute_id=p_dispute_id;
      PERFORM set_config('sellf.event_context','{"reason":"stripe_dispute"}',true);
      FOR original IN SELECT to_jsonb(a) FROM public.user_product_access a
        WHERE a.user_id=ANY(buyer_ids) AND a.product_id=ANY(product_ids)
        AND (a.access_expires_at IS NULL OR a.access_expires_at>stamp)
        AND (a.subscription_id IS NULL OR a.subscription_id=t.subscription_id)
        AND (a.transfer_transaction_id IS NULL OR a.transfer_transaction_id=t.id) FOR UPDATE
      LOOP
        d.account_access := d.account_access||jsonb_build_array(original);
        UPDATE public.user_product_access SET access_expires_at=stamp,expiry_notified_at=stamp WHERE id=(original->>'id')::uuid;
      END LOOP;
      WITH removed AS (
        DELETE FROM public.guest_purchases WHERE (session_id=t.session_id OR transaction_id=t.id)
          AND claimed_by_user_id IS NULL RETURNING *
      ) SELECT coalesce(jsonb_agg(jsonb_set(to_jsonb(removed),'{metadata}',coalesce(removed.metadata,'{}')||
        jsonb_build_object('_dispute_access_terms',coalesce(removed.metadata->'_dispute_access_terms',(
          SELECT jsonb_object_agg(p.id::text,jsonb_build_object('grantedAt',removed.created_at,'expiresAt',
            CASE WHEN coalesce((SELECT l.access_duration_override FROM public.payment_line_items l
              WHERE l.transaction_id=t.id AND l.product_id=p.id LIMIT 1),p.auto_grant_duration_days) IS NULL THEN NULL
            ELSE removed.created_at+make_interval(days=>coalesce((SELECT l.access_duration_override FROM public.payment_line_items l
              WHERE l.transaction_id=t.id AND l.product_id=p.id LIMIT 1),p.auto_grant_duration_days)) END))
          FROM public.products p WHERE p.id=ANY(product_ids)
        ))))),'[]') INTO d.guest_access FROM removed;
      UPDATE public.payment_disputes SET account_access=d.account_access,guest_access=d.guest_access WHERE stripe_dispute_id=p_dispute_id;
    END IF;
  END IF;

  next_status := t.status;
  IF p_status='won' THEN
    next_status := CASE WHEN t.status IN ('refunded','cancelled') THEN t.status
      WHEN coalesce(t.refunded_amount,0)>=t.amount THEN 'refunded'
      WHEN coalesce(t.refunded_amount,0)>0 THEN 'partially_refunded'
      ELSE d.previous_payment_status END;
    can_restore := next_status IN ('completed','partially_refunded') AND NOT EXISTS(
      SELECT 1 FROM public.payment_disputes other WHERE other.transaction_id=t.id AND other.stripe_dispute_id<>p_dispute_id AND other.status<>'won');
    can_restore_license:=can_restore;
    IF can_restore_license THEN
      PERFORM l.id FROM public.issued_licenses l WHERE l.order_id IN (t.stripe_payment_intent_id,t.session_id) ORDER BY l.id FOR UPDATE;
      FOR license IN SELECT l.id FROM public.issued_licenses l WHERE l.id=ANY(d.revoked_license_ids)
        AND l.revoked_by_dispute_id=p_dispute_id AND l.revoked_at IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM public.issued_licenses other WHERE other.original_seller_id=l.original_seller_id
          AND other.order_id=l.order_id AND other.revoked_at IS NOT NULL AND other.revoked_by_dispute_id IS DISTINCT FROM p_dispute_id)
        ORDER BY l.id FOR UPDATE
      LOOP
        UPDATE public.issued_licenses l SET revoked_at=NULL,revoked_by_dispute_id=NULL WHERE l.id=license.id RETURNING l.* INTO restored_license;
        restored_licenses:=restored_licenses||jsonb_build_array(public.license_event_snapshot(restored_license));
      END LOOP;
    END IF;
    IF t.subscription_id IS NOT NULL THEN
      can_restore := can_restore AND EXISTS(SELECT 1 FROM public.subscriptions s WHERE s.id=t.subscription_id
        AND s.status IN ('active','trialing','past_due') AND (s.current_period_end IS NULL OR s.current_period_end>stamp));
    END IF;
    IF can_restore THEN
      PERFORM set_config('sellf.event_context','{"reason":"dispute_won"}',true);
      FOR item IN SELECT value FROM jsonb_array_elements(d.account_access) LOOP
        IF item->>'access_expires_at' IS NULL OR (item->>'access_expires_at')::timestamptz>stamp THEN
          UPDATE public.user_product_access SET access_expires_at=(item->>'access_expires_at')::timestamptz,
            expiry_notified_at=(item->>'expiry_notified_at')::timestamptz
            WHERE id=(item->>'id')::uuid AND access_expires_at=d.suspended_at
              AND user_id=(item->>'user_id')::uuid AND product_id=(item->>'product_id')::uuid
              AND subscription_id IS NOT DISTINCT FROM (item->>'subscription_id')::uuid
              AND access_duration_days IS NOT DISTINCT FROM (item->>'access_duration_days')::integer;
          GET DIAGNOSTICS changed=ROW_COUNT; restored := restored OR changed>0;
          IF changed>0 THEN restored_access:=restored_access||jsonb_build_array(jsonb_build_object(
            'productId',item->'product_id','userId',item->'user_id','grantedAt',item->'access_granted_at','expiresAt',item->'access_expires_at')); END IF;
        END IF;
      END LOOP;
      FOR item IN SELECT value FROM jsonb_array_elements(d.guest_access) LOOP
        IF EXISTS(SELECT 1 FROM jsonb_each(item->'metadata'->'_dispute_access_terms') saved
          WHERE saved.value->>'expiresAt' IS NULL OR (saved.value->>'expiresAt')::timestamptz>stamp) THEN
          INSERT INTO public.guest_purchases SELECT (jsonb_populate_record(NULL::public.guest_purchases,item)).*
            ON CONFLICT DO NOTHING;
          GET DIAGNOSTICS changed=ROW_COUNT; restored := restored OR changed>0;
          IF changed>0 THEN
            FOR term IN SELECT * FROM jsonb_each(item->'metadata'->'_dispute_access_terms') LOOP
              IF term.value->>'expiresAt' IS NULL OR (term.value->>'expiresAt')::timestamptz>stamp THEN
                restored_access:=restored_access||jsonb_build_array(jsonb_build_object('productId',term.key,'userId',NULL,
                  'guestPurchaseId',item->'id','grantedAt',term.value->'grantedAt','expiresAt',term.value->'expiresAt'));
              END IF;
            END LOOP;
          END IF;
        END IF;
      END LOOP;
    END IF;
  ELSIF t.status NOT IN ('refunded','cancelled') THEN next_status := 'disputed';
  END IF;
  UPDATE public.payment_transactions SET status=next_status,updated_at=stamp,
    metadata=coalesce(metadata,'{}')||jsonb_build_object('dispute_id',p_dispute_id,'dispute_reason',p_reason,
      'dispute_status',p_status,'dispute_created',p_created)
    WHERE id=t.id;
  SELECT stripe_subscription_id INTO stripe_subscription FROM public.subscriptions WHERE id=t.subscription_id;
  result := jsonb_build_object(
    'customer',jsonb_build_object('email',t.customer_email,'userId',t.user_id),
    'product',jsonb_build_object('id',t.product_id),
    'payment',jsonb_build_object('id',t.id,'amount',t.amount,'currency',t.currency,'sessionId',t.session_id,
      'paymentIntentId',t.stripe_payment_intent_id,'stripeInvoiceId',t.stripe_invoice_id,'subscriptionId',t.subscription_id,
      'statusBefore',t.status,'statusAfter',next_status),
    'dispute',jsonb_build_object('stripeDisputeId',p_dispute_id,'status',p_status,'reason',p_reason,'amount',p_amount,
      'currency',upper(p_currency),'createdAt',p_created,'accessRevoked',p_status<>'won','accessRestored',restored,
      'licenseRestored',jsonb_array_length(restored_licenses)>0,'restoredLicenses',restored_licenses,'restoredAccess',restored_access));
  IF t.subscription_id IS NOT NULL THEN result:=result||jsonb_build_object('subscription',jsonb_build_object(
    'id',t.subscription_id,'stripeSubscriptionId',stripe_subscription)); END IF;
  UPDATE public.payment_disputes SET status=p_status,closed=p_closed,payload=result WHERE stripe_dispute_id=p_dispute_id;
  PERFORM set_config('sellf.event_context','',true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.apply_payment_dispute(uuid,text,text,boolean,text,integer,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_payment_dispute(uuid,text,text,boolean,text,integer,text,timestamptz) TO service_role;

-- ===== Source: 20261103130000_webhook_event_families.sql =====
-- Sales invoice, partner commission/payout, refund request and catalogue availability transitions
-- captured transactionally into business_events for signed webhook delivery (W107-10/11/12/14).
-- @see supabase/migrations/20261028184757_business_event_delivery.sql
-- @see admin-panel/src/lib/services/business-events.ts

-- Partner payouts are account-level: they have no product context.
ALTER TABLE public.business_events ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.business_events DROP CONSTRAINT business_events_event_type_check;
ALTER TABLE public.business_events ADD CONSTRAINT business_events_event_type_check CHECK (event_type IN (
  'access.granted','access.updated','access.revoked','access.expired','order.abandoned',
  'seats.held','seats.confirmed','seats.released','license.revoked','license.restored',
  'invoicing.issued','invoicing.failed','invoicing.corrected',
  'commission.accrued','commission.reversed','payout.reserved','payout.paid','payout.cancelled',
  'refund.requested','refund.request_approved','refund.request_rejected','refund.request_cancelled',
  'product.published','product.unpublished','product.price_changed','product.sold_out'));

-- ===== SHARED HELPERS =====

CREATE FUNCTION public.business_event_actor() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(nullif(current_setting('sellf.event_context',true),'')::jsonb->'actor',
    jsonb_build_object('type',CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,'id',auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.business_event_actor() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.record_business_event(p_event text, p_product uuid, p_payload jsonb, p_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE product jsonb;
BEGIN
  SELECT jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug) INTO product FROM public.products p WHERE p.id=p_product;
  INSERT INTO public.business_events(event_type,product_id,payload,deduplication_key)
  VALUES(p_event,p_product,p_payload||jsonb_build_object(
    'product',CASE WHEN p_product IS NULL THEN NULL ELSE coalesce(product,jsonb_build_object('id',p_product)) END,
    'actor',public.business_event_actor(),'occurredAt',clock_timestamp()),p_key)
  ON CONFLICT(deduplication_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.record_business_event(text,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.business_event_order(p_transaction uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('orderId',t.id,'orderNumber',t.order_number,'amount',t.amount,'currency',t.currency,
    'paymentProvider',t.payment_provider,'status',t.status) FROM public.payment_transactions t WHERE t.id=p_transaction;
$$;
REVOKE ALL ON FUNCTION public.business_event_order(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.business_event_partner(p_member uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('memberId',m.id,'code',m.code,'displayName',m.display_name,'status',m.status,'userId',m.user_id)
  FROM public.affiliate_memberships m WHERE m.id=p_member;
$$;
REVOKE ALL ON FUNCTION public.business_event_partner(uuid) FROM PUBLIC,anon,authenticated;

-- ===== SALES INVOICES =====

CREATE FUNCTION public.capture_sales_invoice_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('issued','failed','corrected') THEN RETURN NEW; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=NEW.transaction_id;
  PERFORM public.record_business_event('invoicing.'||NEW.status,tx.product_id,jsonb_build_object(
    'amountUnit','minor',
    'invoice',jsonb_build_object('id',NEW.id,'provider',NEW.provider,'providerInvoiceId',NEW.provider_invoice_id,
      'number',NEW.number,'viewUrl',NEW.view_url,'statusBefore',OLD.status,'statusAfter',NEW.status,'attempt',NEW.attempts,
      'error',CASE WHEN NEW.status='failed' THEN NEW.error ELSE NULL END,
      'willRetry',NEW.status='failed' AND NEW.attempts<5,'paymentSynced',NEW.payment_synced),
    'order',public.business_event_order(NEW.transaction_id),
    'customer',jsonb_build_object('userId',tx.user_id,'email',tx.customer_email)),
    'invoicing.'||NEW.status||':'||NEW.id||':'||NEW.attempts||CASE WHEN NEW.status='corrected' THEN ':'||clock_timestamp() ELSE '' END);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_sales_invoice_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sales_invoice_business_event AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.capture_sales_invoice_event();

-- ===== REFUND REQUESTS =====

CREATE FUNCTION public.capture_refund_request_event() RETURNS trigger
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
    event||':'||NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_refund_request_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER refund_request_business_event AFTER INSERT OR UPDATE OF status ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.capture_refund_request_event();

-- ===== PARTNER COMMISSIONS AND PAYOUTS =====

CREATE FUNCTION public.capture_commission_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.affiliate_commissions; pid uuid; event text := CASE NEW.kind WHEN 'accrual' THEN 'accrued' ELSE 'reversed' END;
BEGIN
  IF NEW.kind NOT IN ('accrual','reversal') THEN RETURN NEW; END IF;
  SELECT * INTO c FROM public.affiliate_commissions WHERE id=NEW.commission_id;
  SELECT coalesce(l.product_id,t.product_id) INTO pid FROM public.payment_transactions t
    LEFT JOIN public.payment_line_items l ON l.id=c.line_item_id WHERE t.id=c.payment_id;
  PERFORM public.record_business_event('commission.'||event,pid,jsonb_build_object(
    'amountUnit','minor',
    'commission',jsonb_build_object('id',c.id,'ledgerEntryId',NEW.id,'amount',NEW.amount_minor,'currency',NEW.currency,
      'baseAmount',c.base_minor,'accruedAmount',c.accrued_minor,'paidAt',c.paid_at,'eligibleAt',c.eligible_at,
      'selfReferral',c.self_referral,'livemode',c.livemode),
    'partner',public.business_event_partner(NEW.member_id),
    'order',public.business_event_order(c.payment_id)),
    'commission.'||event||':'||NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_commission_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER commission_business_event AFTER INSERT ON public.affiliate_ledger
  FOR EACH ROW EXECUTE FUNCTION public.capture_commission_event();

-- Deferred so the reservation's allocations exist when the payload is built.
CREATE FUNCTION public.capture_payout_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE before text := CASE WHEN TG_OP='INSERT' THEN 'none' ELSE OLD.status END; current public.affiliate_payouts;
BEGIN
  IF before=NEW.status OR (TG_OP='INSERT' AND NEW.status<>'reserved') THEN RETURN NULL; END IF;
  SELECT * INTO current FROM public.affiliate_payouts WHERE id=NEW.id;
  PERFORM public.record_business_event('payout.'||NEW.status,NULL,jsonb_build_object(
    'amountUnit','minor',
    'payout',jsonb_build_object('id',NEW.id,'statusBefore',before,'statusAfter',NEW.status,'amount',NEW.earnings_minor,
      'currency',NEW.currency,'cutoff',NEW.cutoff,'payeeReference',NEW.payee_reference,'bankReference',NEW.bank_reference,
      'invoiceReference',NEW.invoice_reference,'bankAmount',NEW.bank_amount_minor,'paidAt',NEW.paid_at,'livemode',NEW.livemode,
      'needsReview',current.needs_review,
      'commissionIds',(SELECT coalesce(jsonb_agg(DISTINCT l.commission_id),'[]') FROM public.affiliate_payout_allocations a
        JOIN public.affiliate_ledger l ON l.id=a.entry_id WHERE a.payout_id=NEW.id AND l.commission_id IS NOT NULL)),
    'partner',public.business_event_partner(NEW.member_id)),
    'payout.'||NEW.status||':'||NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.capture_payout_event() FROM PUBLIC,anon,authenticated;
CREATE CONSTRAINT TRIGGER payout_business_event AFTER INSERT OR UPDATE ON public.affiliate_payouts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.capture_payout_event();

-- ===== CATALOGUE AVAILABILITY AND PRICE =====

CREATE FUNCTION public.product_price_snapshot(p public.products) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('price',round(p.price*public.currency_minor_factor(p.currency))::bigint,
    'salePrice',round(p.sale_price*public.currency_minor_factor(p.currency))::bigint,'salePriceUntil',p.sale_price_until,
    'recurringPrice',round(p.recurring_price*public.currency_minor_factor(p.currency))::bigint,'currency',p.currency);
$$;
REVOKE ALL ON FUNCTION public.product_price_snapshot(public.products) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.capture_product_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.products := CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  was boolean := TG_OP<>'INSERT' AND OLD.is_active; now_active boolean := TG_OP<>'DELETE' AND NEW.is_active;
  info jsonb; event text; prices_before jsonb; prices_after jsonb;
BEGIN
  info := jsonb_build_object('product',jsonb_build_object('id',r.id,'name',r.name,'slug',r.slug,'isActive',now_active,
    'availableFrom',r.available_from,'availableUntil',r.available_until,'productType',r.product_type));
  IF was IS DISTINCT FROM now_active AND (was OR now_active) THEN
    event := CASE WHEN now_active THEN 'product.published' ELSE 'product.unpublished' END;
    INSERT INTO public.business_events(event_type,product_id,payload,deduplication_key)
    VALUES(event,r.id,info||jsonb_build_object('availability',jsonb_build_object(
      'before',CASE WHEN was THEN 'published' ELSE 'unpublished' END,'after',CASE WHEN now_active THEN 'published' ELSE 'unpublished' END),
      'deleted',TG_OP='DELETE','actor',public.business_event_actor(),'occurredAt',clock_timestamp()),
      event||':'||r.id||':'||clock_timestamp())
    ON CONFLICT(deduplication_key) DO NOTHING;
  END IF;
  IF TG_OP='UPDATE' THEN
    prices_before := public.product_price_snapshot(OLD); prices_after := public.product_price_snapshot(NEW);
    IF prices_before IS DISTINCT FROM prices_after THEN
      INSERT INTO public.business_events(event_type,product_id,payload,deduplication_key)
      VALUES('product.price_changed',r.id,info||jsonb_build_object('amountUnit','minor',
        'price',jsonb_build_object('before',prices_before,'after',prices_after),
        'actor',public.business_event_actor(),'occurredAt',clock_timestamp()),
        'product.price_changed:'||r.id||':'||clock_timestamp())
      ON CONFLICT(deduplication_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.capture_product_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER product_business_event AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.capture_product_event();

-- A session sells out when held (unexpired) plus confirmed seats reach its capacity.
CREATE FUNCTION public.capture_sold_out_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.product_sessions; taken integer;
BEGIN
  IF NEW.status NOT IN ('held','confirmed') OR (TG_OP='UPDATE' AND OLD.status IN ('held','confirmed')) THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.product_sessions WHERE id=NEW.session_id;
  IF s.capacity IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(sum(quantity),0) INTO taken FROM public.seat_reservations
    WHERE session_id=NEW.session_id AND (status='confirmed' OR (status='held' AND (expires_at IS NULL OR expires_at>now())));
  IF taken<s.capacity THEN RETURN NEW; END IF;
  PERFORM public.record_business_event('product.sold_out',s.product_id,jsonb_build_object(
    'session',jsonb_build_object('id',s.id,'label',s.title,'startsAt',s.starts_at,'capacity',s.capacity,'taken',taken,'remaining',0,
      'salesOpen',s.sales_open),
    'reservation',jsonb_build_object('id',NEW.id,'status',NEW.status,'quantity',NEW.quantity)),
    'product.sold_out:'||s.id||':'||NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_sold_out_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sold_out_business_event AFTER INSERT OR UPDATE OF status ON public.seat_reservations
  FOR EACH ROW EXECUTE FUNCTION public.capture_sold_out_event();

-- ===== Source: 20261103140000_business_event_actor_rpcs.sql =====
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

-- ===== Source: 20261103150000_unpaid_order_reservations.sql =====
-- Unpaid transfer orders: seller-configured timed reservation (reminder + release) for event seats,
-- buyer "I have sent the transfer" declaration, hold without expiry once an invoice is issued,
-- and explicit administrator acceptance of a transfer that arrives after cancellation.
-- Owner decisions 2026-11-03: issued invoice = no expiry, only cancellation (with correction) releases;
-- a late transfer after cancellation is decided by the administrator, over the limit if needed.
-- @see priv/plans/2026-10-28-unpaid-orders-plan.md, admin-panel/src/lib/orders/bank-transfer-service.ts

-- ===== SCHEMA =====
ALTER TABLE public.bank_transfer_config
  ADD COLUMN reservation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN reservation_reminder_hours integer NOT NULL DEFAULT 24 CHECK (reservation_reminder_hours BETWEEN 1 AND 168),
  ADD COLUMN reservation_release_hours integer NOT NULL DEFAULT 48 CHECK (reservation_release_hours BETWEEN 2 AND 336),
  ADD COLUMN declared_hold_hours integer NOT NULL DEFAULT 72 CHECK (declared_hold_hours BETWEEN 0 AND 336),
  ADD CONSTRAINT bank_transfer_reservation_order CHECK (reservation_release_hours > reservation_reminder_hours);

ALTER TABLE public.payment_transactions
  ADD COLUMN reminder_at timestamptz,
  ADD COLUMN release_at timestamptz,
  ADD COLUMN cancel_reason text CHECK (cancel_reason IN ('admin','payment_window_expired')),
  ADD COLUMN transfer_declared_at timestamptz,
  ADD COLUMN transfer_declared_note text CHECK (length(transfer_declared_note) <= 200),
  ADD COLUMN invoice_hold_at timestamptz,
  ADD COLUMN reopened_at timestamptz,
  ADD COLUMN order_reminder_notified_at timestamptz,
  ADD COLUMN order_transfer_declared_notified_at timestamptz,
  ADD COLUMN order_invoice_issued_notified_at timestamptz,
  ADD COLUMN order_reopened_notified_at timestamptz,
  ADD COLUMN reminder_mail_sent_at timestamptz,
  ADD COLUMN cancelled_mail_sent_at timestamptz;
CREATE INDEX transfer_reminder_due_idx ON public.payment_transactions(reminder_at)
  WHERE status = 'awaiting_payment' AND reminder_at IS NOT NULL AND order_reminder_notified_at IS NULL;
CREATE INDEX transfer_release_due_idx ON public.payment_transactions(release_at)
  WHERE status = 'awaiting_payment' AND release_at IS NOT NULL;

-- Online payment of an unpaid transfer order from the pay link (Stripe Checkout). The order keeps
-- payment_provider='bank_transfer'; settled_via records how it was paid.
ALTER TABLE public.payment_transactions ADD COLUMN settled_via text CHECK (settled_via IN ('bank_transfer','stripe'));
-- A transfer order paid online keeps its Stripe PaymentIntent so refunds and disputes reconcile as for card orders.
ALTER TABLE public.payment_transactions DROP CONSTRAINT payment_transactions_provider_ref_chk,
  ADD CONSTRAINT payment_transactions_provider_ref_chk CHECK (
    (payment_provider = 'stripe' AND session_id IS NOT NULL
      AND length(session_id) BETWEEN 1 AND 255 AND session_id ~* '^(cs_|pi_|in_)[a-zA-Z0-9_]+$')
    OR (payment_provider = 'bank_transfer' AND session_id IS NULL AND pricing_snapshot_version IS NOT NULL
      AND (stripe_payment_intent_id IS NULL OR (settled_via IS NOT DISTINCT FROM 'stripe' AND stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$')))
  );
CREATE TABLE public.order_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('settle','reopen')),
  stripe_session_id text UNIQUE,
  checkout_url text CHECK (length(checkout_url) <= 2048),
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'opening' CHECK (status IN ('opening','open','completed','expired','superseded','duplicate')),
  stripe_payment_intent_id text,
  refund_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX order_payment_attempt_open_idx ON public.order_payment_attempts(transaction_id) WHERE status IN ('opening','open');
ALTER TABLE public.order_payment_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.order_payment_attempts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admin read" ON public.order_payment_attempts FOR SELECT TO authenticated USING ((select public.is_admin()));
REVOKE ALL ON public.order_payment_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_payment_attempts TO authenticated;
GRANT ALL ON public.order_payment_attempts TO service_role;

-- ===== SETTINGS =====
CREATE OR REPLACE FUNCTION public.save_bank_transfer_config(p_config jsonb,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.bank_transfer_config%ROWTYPE; cur public.bank_transfer_config%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=p_actor) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT cur FROM public.bank_transfer_config WHERE id;
  cfg:=jsonb_populate_record(cur,p_config);
  UPDATE public.bank_transfer_config SET bank_transfer_enabled=cfg.bank_transfer_enabled,bank_account_holder=cfg.bank_account_holder,
    bank_account_number=cfg.bank_account_number,bank_name=cfg.bank_name,bank_transfer_title_template=cfg.bank_transfer_title_template,
    bank_transfer_due_days=cfg.bank_transfer_due_days,bank_transfer_grant_access_on_placement=cfg.bank_transfer_grant_access_on_placement,
    bank_transfer_max_unpaid_per_email=cfg.bank_transfer_max_unpaid_per_email,reservation_enabled=cfg.reservation_enabled,
    reservation_reminder_hours=cfg.reservation_reminder_hours,reservation_release_hours=cfg.reservation_release_hours,
    declared_hold_hours=cfg.declared_hold_hours WHERE id;
  INSERT INTO public.audit_log(table_name,operation,performed_by,user_id,new_values) VALUES('bank_transfer_config','UPDATE',p_actor,p_actor,
    jsonb_build_object('action','bank_transfer.settings','enabled',cfg.bank_transfer_enabled,'reservation_enabled',cfg.reservation_enabled,
      'reminder_hours',cfg.reservation_reminder_hours,'release_hours',cfg.reservation_release_hours,'declared_hold_hours',cfg.declared_hold_hours));
END $$;
REVOKE ALL ON FUNCTION public.save_bank_transfer_config(jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_bank_transfer_config(jsonb,uuid) TO service_role;

-- ===== PLACEMENT: timed reservation for event seats =====
CREATE OR REPLACE FUNCTION public.bank_transfer_order(p_order jsonb,p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg public.bank_transfer_config%ROWTYPE; result jsonb; txid uuid; buyer_type text;
  email text:=lower(btrim(p_order->>'customer_email')); profile jsonb; transfer jsonb; person record;
  is_event boolean; starts timestamptz; remind timestamptz; release timestamptz; due timestamptz;
BEGIN
  SELECT * INTO STRICT cfg FROM public.bank_transfer_config WHERE id;
  SELECT checkout_profile,event_mode INTO profile,is_event FROM public.products WHERE id=(p_order->>'product_id')::uuid AND is_active
    AND product_type='one_time' AND NOT is_bundle AND NOT allow_custom_price FOR SHARE;
  buyer_type:=p_order->'order_details'->'buyer'->>'type';
  IF NOT cfg.bank_transfer_enabled OR profile IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(profile->'modules') m
    WHERE m->>'id'='buyer' AND m->'bank_transfer_for' ? buyer_type AND m->'types' ? buyer_type)
    OR NOT public.validate_email_format(email) OR (p_order->'terms_required' IS DISTINCT FROM 'false'::jsonb
      AND (p_order->'order_details'->'buyer'->>'terms_accepted') IS DISTINCT FROM 'true') THEN
    RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='22023';
  END IF;
  IF coalesce(is_event,false) AND cfg.reservation_enabled THEN
    remind:=now()+make_interval(hours=>cfg.reservation_reminder_hours);
    release:=now()+make_interval(hours=>cfg.reservation_release_hours);
    SELECT s.starts_at INTO starts FROM jsonb_array_elements(p_lines) l
      JOIN public.product_sessions s ON s.id=(l->>'session_id')::uuid WHERE l->>'item_type'='main_product';
    -- A transfer cannot hold a seat past the start of the session; the buyer pays online instead.
    IF starts IS NOT NULL AND starts<=release THEN RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='22023'; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(email,1));
  IF (SELECT count(*) FROM public.payment_transactions WHERE payment_provider='bank_transfer' AND status='awaiting_payment'
    AND lower(customer_email)=email)>=cfg.bank_transfer_max_unpaid_per_email THEN RAISE EXCEPTION 'unpaid_limit' USING ERRCODE='P0429'; END IF;
  p_order:=p_order||jsonb_build_object('payment_provider','bank_transfer','customer_email',email,'session_id',NULL,'stripe_payment_intent_id',NULL,
    'metadata',coalesce(p_order->'metadata','{}')||jsonb_build_object('access_on_placement',cfg.bank_transfer_grant_access_on_placement));
  result:=public.place_order(p_order,p_lines); txid:=(result->>'transaction_id')::uuid;
  transfer:=jsonb_build_object('holder',cfg.bank_account_holder,'account',cfg.bank_account_number,'bank',cfg.bank_name,
    'title',replace(cfg.bank_transfer_title_template,'{order_number}',result->>'order_number'));
  -- The payment term (invoice deadline) stays the seller's due days; the timed reservation is separate.
  due:=now()+make_interval(days=>cfg.bank_transfer_due_days);
  UPDATE public.payment_transactions SET payment_due_at=due,reminder_at=remind,release_at=release,transfer_details=transfer WHERE id=txid;
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
  RETURN result||jsonb_build_object('currency',p_order->>'currency','dueAt',due,'reminderAt',remind,'releaseAt',release,'transfer',transfer);
END $$;
REVOKE ALL ON FUNCTION public.bank_transfer_order(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bank_transfer_order(jsonb,jsonb) TO service_role;

-- ===== INVOICE HOLD: an issued invoice stops the timer for good =====
CREATE FUNCTION public.hold_transfer_for_invoice(p_id uuid,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed integer;
BEGIN
  IF p_now IS NULL THEN RAISE EXCEPTION 'Time required' USING ERRCODE='22023'; END IF;
  UPDATE public.payment_transactions SET invoice_hold_at=p_now,release_at=NULL,reminder_at=NULL,updated_at=now()
    WHERE id=p_id AND payment_provider='bank_transfer' AND status='awaiting_payment' AND invoice_hold_at IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN jsonb_build_object('success',EXISTS(SELECT 1 FROM public.payment_transactions WHERE id=p_id AND payment_provider='bank_transfer'
    AND status='awaiting_payment'),'held',changed=1);
END $$;
REVOKE ALL ON FUNCTION public.hold_transfer_for_invoice(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hold_transfer_for_invoice(uuid,timestamptz) TO service_role;

CREATE FUNCTION public.invoice_holds_transfer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.hold_transfer_for_invoice(NEW.transaction_id,now());
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.invoice_holds_transfer() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER invoice_holds_transfer AFTER INSERT OR UPDATE OF status ON public.invoices
FOR EACH ROW WHEN (NEW.status='issued') EXECUTE FUNCTION public.invoice_holds_transfer();

-- ===== RELEASE: unpaid order past its window is cancelled; seat, coupon and access return =====
CREATE FUNCTION public.release_unpaid_transfer(p_id uuid,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; redeemed uuid;
BEGIN
  IF p_now IS NULL THEN RAISE EXCEPTION 'Time required' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' OR tx.status<>'awaiting_payment' OR tx.release_at IS NULL
    OR tx.release_at>p_now OR tx.invoice_hold_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.order_payment_attempts a WHERE a.transaction_id=tx.id AND a.status IN ('opening','open') AND a.expires_at>p_now)
    OR EXISTS(SELECT 1 FROM public.invoices i WHERE i.transaction_id=tx.id AND i.status IN ('issuing','issued','corrected')) THEN
    RETURN jsonb_build_object('success',true,'released',false);
  END IF;
  FOR redeemed IN DELETE FROM public.coupon_redemptions WHERE transaction_id=tx.id RETURNING coupon_id LOOP
    UPDATE public.coupons SET current_usage_count=greatest(0,current_usage_count-1) WHERE id=redeemed;
  END LOOP;
  PERFORM set_config('sellf.event_context',jsonb_build_object('actor',jsonb_build_object('type','system','id',NULL),'reason','payment_window_expired')::text,true);
  UPDATE public.payment_transactions SET status='cancelled',cancel_reason='payment_window_expired',updated_at=now() WHERE id=tx.id;
  PERFORM set_config('sellf.event_context','',true);
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('payment_transactions','UPDATE',
    jsonb_build_object('action','order.released','transaction_id',tx.id,'release_at',tx.release_at,'coupon_id',tx.coupon_id));
  RETURN jsonb_build_object('success',true,'released',true,'transaction_id',tx.id);
END $$;
REVOKE ALL ON FUNCTION public.release_unpaid_transfer(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_unpaid_transfer(uuid,timestamptz) TO service_role;

-- ===== DECLARATION: buyer says the transfer is on its way =====
CREATE FUNCTION public.declare_transfer(p_id uuid,p_note text,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; hold integer; note text:=nullif(btrim(p_note),'');
BEGIN
  IF p_now IS NULL OR length(note)>200 OR note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid declaration' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' OR tx.status<>'awaiting_payment' THEN
    RETURN jsonb_build_object('success',false,'error','not_awaiting_payment');
  END IF;
  IF tx.transfer_declared_at IS NOT NULL THEN
    RETURN jsonb_build_object('success',true,'already_declared',true,'releaseAt',tx.release_at,'declaredAt',tx.transfer_declared_at);
  END IF;
  SELECT declared_hold_hours INTO STRICT hold FROM public.bank_transfer_config WHERE id;
  UPDATE public.payment_transactions SET transfer_declared_at=p_now,transfer_declared_note=note,
    release_at=CASE WHEN release_at IS NULL THEN NULL ELSE greatest(release_at,p_now+make_interval(hours=>hold)) END,
    updated_at=now() WHERE id=tx.id RETURNING * INTO tx;
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('payment_transactions','UPDATE',
    jsonb_build_object('action','order.transfer_declared','transaction_id',tx.id,'release_at',tx.release_at));
  RETURN jsonb_build_object('success',true,'already_declared',false,'releaseAt',tx.release_at,'declaredAt',tx.transfer_declared_at);
END $$;
REVOKE ALL ON FUNCTION public.declare_transfer(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.declare_transfer(uuid,text,timestamptz) TO service_role;

-- Back to awaiting payment so the normal completion runs: coupon use re-taken (even past its limit, the order
-- price is honoured) and placement access re-granted by completion. Caller holds the row lock.
CREATE FUNCTION public._reopen_cancelled_transfer(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE;
BEGIN
  SELECT * INTO STRICT tx FROM public.payment_transactions WHERE id=p_id;
  IF tx.coupon_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.coupon_redemptions WHERE transaction_id=tx.id) THEN
    INSERT INTO public.coupon_redemptions(coupon_id,user_id,customer_email,transaction_id,discount_amount)
      VALUES(tx.coupon_id,tx.user_id,tx.customer_email,tx.id,0);
    UPDATE public.coupons SET current_usage_count=coalesce(current_usage_count,0)+1 WHERE id=tx.coupon_id;
  END IF;
  UPDATE public.payment_transactions SET status='awaiting_payment',cancel_reason=NULL,
    metadata=coalesce(metadata,'{}')||'{"access_on_placement":false}'::jsonb WHERE id=tx.id;
END $$;
REVOKE ALL ON FUNCTION public._reopen_cancelled_transfer(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._reopen_cancelled_transfer(uuid) TO service_role;

-- ===== ADMIN: late acceptance of a cancelled order, external invoice mark, cancel reason =====
DROP FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid);
CREATE FUNCTION public.admin_bank_transfer_order(p_id uuid,p_action text,p_amount numeric DEFAULT NULL,p_paid_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL,p_actor uuid DEFAULT NULL,p_accept_cancelled boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; tx public.payment_transactions%ROWTYPE; invoice_status text; reopen boolean:=false;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=p_actor) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  SELECT status INTO invoice_status FROM public.invoices WHERE transaction_id=p_id;
  IF p_action='mark-paid' THEN
    IF p_paid_at IS NULL OR p_paid_at>now() THEN RAISE EXCEPTION 'Invalid payment date' USING ERRCODE='22023'; END IF;
    IF tx.status='cancelled' THEN
      IF NOT coalesce(p_accept_cancelled,false) THEN RETURN jsonb_build_object('success',false,'error','order_cancelled'); END IF;
      IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Acceptance reason required' USING ERRCODE='22023'; END IF;
      IF invoice_status='corrected' THEN RETURN jsonb_build_object('success',false,'error','invoice_corrected'); END IF;
      IF p_amount IS DISTINCT FROM tx.amount THEN RETURN jsonb_build_object('success',false,'error','amount_mismatch'); END IF;
      PERFORM public._reopen_cancelled_transfer(tx.id);
      reopen:=true;
    END IF;
    result:=public.complete_offline_order(p_id,p_amount);
    IF (result->>'success')::boolean THEN
      UPDATE public.order_payment_attempts SET status='superseded' WHERE transaction_id=p_id AND status IN ('opening','open');
    END IF;
    IF (result->>'success')::boolean AND tx.status<>'completed' THEN
      UPDATE public.payment_transactions SET paid_at=p_paid_at,reopened_at=CASE WHEN reopen THEN now() ELSE reopened_at END WHERE id=p_id;
    END IF;
    IF reopen AND (result->>'success')::boolean THEN
      INSERT INTO public.audit_log(table_name,operation,performed_by,user_id,new_values) VALUES('payment_transactions','UPDATE',p_actor,p_actor,
        jsonb_build_object('action','order.reopened','transaction_id',p_id,'previous_status','cancelled','amount',tx.amount,'reason',p_reason,
          'oversold',coalesce((SELECT (metadata->>'oversold')::boolean FROM public.payment_transactions WHERE id=p_id),false)));
      result:=result||jsonb_build_object('reopened',true,'previous_status','cancelled');
    ELSIF reopen THEN RAISE EXCEPTION 'Late acceptance failed' USING ERRCODE='P0001';
    END IF;
  ELSIF p_action='cancel' THEN
    result:=public.cancel_unpaid_order(p_id,p_reason);
    IF (result->>'success')::boolean AND tx.status='awaiting_payment' THEN
      UPDATE public.payment_transactions SET cancel_reason='admin' WHERE id=p_id;
    END IF;
    result:=result||jsonb_build_object('invoice_correction_required',invoice_status IN ('issued','issuing'));
  ELSIF p_action='invoice-issued' THEN
    result:=public.hold_transfer_for_invoice(p_id,now());
  ELSE RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
  IF (result->>'success')::boolean AND tx.status='awaiting_payment' THEN
    INSERT INTO public.audit_log(table_name,operation,performed_by,user_id,new_values)
      VALUES('payment_transactions','UPDATE',p_actor,p_actor,jsonb_build_object('action',p_action,'transaction_id',p_id));
  END IF;
  RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean) TO service_role;

-- ===== BUYER MAIL: notice kind, signed order link and reservation text on the Auth channel =====
CREATE OR REPLACE FUNCTION public.prepare_event_mail(p_email text, p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF length(p_data->>'event_date')>500 OR length(p_data->>'event_online_url')>2048
    OR (p_data->>'event_online_url') !~ '^https://[^[:space:]]+$'
    OR length(p_data->>'transfer_text')>2000 OR length(p_data->>'purchase_product')>500
    OR length(p_data->>'purchase_amount')>100 OR (p_data->>'locale') NOT IN ('pl','en')
    OR (p_data->>'mail_kind') NOT IN ('transfer_placed','payment_reminder','order_cancelled')
    OR length(p_data->>'pay_url')>2048
    OR (p_data->>'pay_url') !~ '^https?://[^/[:space:]]+/(pl|en)/order/[0-9a-f-]{36}/transfer\?token=[0-9]{1,12}\.[A-Za-z0-9_-]{43}$'
    OR length(p_data->>'release_text')>500
    THEN RAISE EXCEPTION 'Invalid mail data' USING ERRCODE='22023'; END IF;
  UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}')
    -'event_date'-'event_online_url'-'transfer_text'-'purchase_product'-'purchase_amount'-'locale'-'mail_kind'-'pay_url'-'release_text')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date',
      'event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text',
      'purchase_product',p_data->>'purchase_product','purchase_amount',p_data->>'purchase_amount',
      'mail_kind',p_data->>'mail_kind','pay_url',p_data->>'pay_url','release_text',p_data->>'release_text',
      'locale',coalesce(p_data->>'locale','en')))
    WHERE lower(email)=lower(p_email);
END $$;
REVOKE ALL ON FUNCTION public.prepare_event_mail(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_mail(text,jsonb) TO service_role;

-- ===== ONLINE PAYMENT OF AN UNPAID ORDER =====
-- One open attempt per order; a stale or expired one is replaced. Amount is the quoted amount (minor units).
CREATE FUNCTION public.open_order_payment_attempt(p_id uuid,p_kind text,p_amount numeric,p_currency text,p_expires_at timestamptz,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; a public.order_payment_attempts%ROWTYPE;
BEGIN
  IF p_now IS NULL OR p_expires_at IS NULL OR p_expires_at<=p_now OR p_kind NOT IN ('settle','reopen') THEN
    RAISE EXCEPTION 'Invalid attempt' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' OR p_amount IS DISTINCT FROM tx.amount OR upper(p_currency)<>upper(tx.currency)
    OR (p_kind='settle' AND tx.status<>'awaiting_payment') OR (p_kind='reopen' AND (tx.status<>'cancelled'
      OR EXISTS(SELECT 1 FROM public.invoices i WHERE i.transaction_id=tx.id AND i.status='corrected'))) THEN
    RAISE EXCEPTION 'Order not payable' USING ERRCODE='22023'; END IF;
  UPDATE public.order_payment_attempts SET status='expired' WHERE transaction_id=p_id AND status IN ('opening','open') AND expires_at<=p_now;
  SELECT * INTO a FROM public.order_payment_attempts WHERE transaction_id=p_id AND status IN ('opening','open');
  IF FOUND THEN RETURN to_jsonb(a)||'{"reused":true}'; END IF;
  INSERT INTO public.order_payment_attempts(transaction_id,kind,amount,currency,expires_at) VALUES(p_id,p_kind,p_amount,upper(p_currency),p_expires_at) RETURNING * INTO a;
  RETURN to_jsonb(a)||'{"reused":false}';
END $$;
REVOKE ALL ON FUNCTION public.open_order_payment_attempt(uuid,text,numeric,text,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.open_order_payment_attempt(uuid,text,numeric,text,timestamptz,timestamptz) TO service_role;

CREATE FUNCTION public.attach_order_payment_session(p_attempt uuid,p_session_id text,p_url text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.order_payment_attempts SET stripe_session_id=p_session_id,checkout_url=p_url,status='open'
    WHERE id=p_attempt AND status='opening';
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not opening' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.attach_order_payment_session(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attach_order_payment_session(uuid,text,text) TO service_role;

-- Paid online. Completes the same order once; if it was already paid (admin) or is no longer payable the payment
-- is a duplicate the caller refunds. result: completed | already | duplicate.
CREATE FUNCTION public.complete_order_payment_attempt(p_attempt uuid,p_session_id text,p_payment_intent text,p_amount numeric,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.order_payment_attempts%ROWTYPE; tx public.payment_transactions%ROWTYPE; result jsonb; reopen boolean:=false;
BEGIN
  SELECT * INTO a FROM public.order_payment_attempts WHERE id=p_attempt;
  IF NOT FOUND OR a.stripe_session_id IS DISTINCT FROM p_session_id OR p_amount IS DISTINCT FROM a.amount THEN
    RAISE EXCEPTION 'Attempt mismatch' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=a.transaction_id FOR UPDATE;
  SELECT * INTO a FROM public.order_payment_attempts WHERE id=p_attempt FOR UPDATE;
  IF a.status IN ('completed','duplicate') THEN
    RETURN jsonb_build_object('result',CASE a.status WHEN 'completed' THEN 'already' ELSE 'duplicate' END,'transaction_id',tx.id,'attempt_status',a.status,'refund_id',a.refund_id);
  END IF;
  IF a.status='superseded' OR NOT ((a.kind='settle' AND tx.status='awaiting_payment') OR (a.kind='reopen' AND tx.status='cancelled'
    AND NOT EXISTS(SELECT 1 FROM public.invoices i WHERE i.transaction_id=tx.id AND i.status='corrected'))) THEN
    UPDATE public.order_payment_attempts SET status='duplicate',stripe_payment_intent_id=p_payment_intent,completed_at=p_now WHERE id=a.id;
    INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('order_payment_attempts','UPDATE',
      jsonb_build_object('action','order.payment_duplicate','transaction_id',tx.id,'attempt_id',a.id,'payment_intent',p_payment_intent));
    RETURN jsonb_build_object('result','duplicate','transaction_id',tx.id);
  END IF;
  IF a.kind='reopen' THEN PERFORM public._reopen_cancelled_transfer(tx.id); reopen:=true; END IF;
  UPDATE public.payment_transactions SET stripe_payment_intent_id=p_payment_intent,settled_via='stripe' WHERE id=tx.id;
  result:=public.complete_offline_order(tx.id,a.amount);
  IF NOT coalesce((result->>'success')::boolean,false) THEN RAISE EXCEPTION 'Online completion failed' USING ERRCODE='P0001'; END IF;
  UPDATE public.payment_transactions SET paid_at=p_now,reopened_at=CASE WHEN reopen THEN p_now ELSE reopened_at END WHERE id=tx.id;
  UPDATE public.order_payment_attempts SET status='completed',stripe_payment_intent_id=p_payment_intent,completed_at=p_now WHERE id=a.id;
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('payment_transactions','UPDATE',
    jsonb_build_object('action',CASE WHEN reopen THEN 'order.reopened' ELSE 'order.paid_online' END,'transaction_id',tx.id,'attempt_id',a.id,
      'previous_status',tx.status,'amount',a.amount,'oversold',coalesce((SELECT (metadata->>'oversold')::boolean FROM public.payment_transactions WHERE id=tx.id),false)));
  RETURN jsonb_build_object('result','completed','transaction_id',tx.id,'reopened',reopen);
END $$;
REVOKE ALL ON FUNCTION public.complete_order_payment_attempt(uuid,text,text,numeric,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order_payment_attempt(uuid,text,text,numeric,timestamptz) TO service_role;

CREATE FUNCTION public.expire_order_payment_attempt(p_session_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.order_payment_attempts SET status='expired' WHERE stripe_session_id=p_session_id AND status IN ('opening','open');
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.expire_order_payment_attempt(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_order_payment_attempt(text) TO service_role;

CREATE FUNCTION public.record_order_payment_refund(p_attempt uuid,p_refund_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.order_payment_attempts SET refund_id=p_refund_id WHERE id=p_attempt AND status='duplicate';
  IF NOT FOUND THEN RAISE EXCEPTION 'Duplicate attempt required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('order_payment_attempts','UPDATE',
    jsonb_build_object('action','order.payment_duplicate_refunded','attempt_id',p_attempt,'refund_id',p_refund_id));
END $$;
REVOKE ALL ON FUNCTION public.record_order_payment_refund(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_order_payment_refund(uuid,text) TO service_role;

-- ===== Source: 20261103160000_license_events.sql =====
-- License lifecycle events (license.issued, license.expired), API issuance source and scopes,
-- and licenses issued for an order that already has an unresolved or lost dispute (B1).
-- license.updated is reserved: no operation changes a license today
-- (guarded by tests/unit/license-updated-guard.test.ts).

-- ===== API KEY SCOPES =====
ALTER TABLE public.api_keys
  ALTER COLUMN scopes SET DEFAULT jsonb_build_array(
    'products:read','products:write','users:read','users:write','coupons:read','coupons:write',
    'analytics:read','payments:read','payments:write','payments:refund','webhooks:read','webhooks:write',
    'integrations:write','refund-requests:read','refund-requests:write','templates:read','templates:write',
    'templates:activate','system:read','system:write','licenses:read','licenses:write'
  );

-- ===== LEDGER =====
ALTER TABLE public.issued_licenses DROP CONSTRAINT IF EXISTS issued_licenses_issuance_source_check;
ALTER TABLE public.issued_licenses ADD CONSTRAINT issued_licenses_issuance_source_check
  CHECK (issuance_source IN ('purchase','manual','api'));
ALTER TABLE public.issued_licenses ADD COLUMN expiry_notified_at timestamptz;
CREATE INDEX issued_licenses_expiry_pending_idx ON public.issued_licenses(expires_at)
  WHERE expires_at IS NOT NULL AND revoked_at IS NULL AND expiry_notified_at IS NULL;