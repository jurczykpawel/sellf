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
