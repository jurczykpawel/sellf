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
