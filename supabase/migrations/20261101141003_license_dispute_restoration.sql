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
