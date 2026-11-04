-- Integrator contract fixes from the W147 receiver run (W152). All payload changes are additive.
--  * access.revoked / access.expired carry `revocationReason` (refund, dispute, manual,
--    subscription_cancelled, expired) next to the legacy origin `reason`.
--  * license.* snapshots carry `revocation_reason` and the Sellf order (id + number).
--  * access.granted / access.updated carry `accessEndsAt`; a subscription's renewed period
--    produces exactly one access.updated (deduplicated per access row and period end).
--  * seats.* carry the buyer's account id like order.* events (looked up by order email).
--  * subscription.renewal_upcoming outside the notice window is deferred and emitted by
--    capture_due_renewal_notices() when due.
--  * the administrator's cancellation text is stored on the order (`cancel_note`).
-- @see admin-panel/tests/unit/webhook-contract-w152.integration.test.ts

-- ===== COLUMNS =====
ALTER TABLE public.issued_licenses ADD COLUMN revocation_reason text
  CHECK (revocation_reason IN ('refund','dispute','manual','subscription_cancelled'));
ALTER TABLE public.subscriptions ADD COLUMN renewal_notice_at timestamptz,
  ADD COLUMN renewal_notice_payload jsonb;
CREATE INDEX subscriptions_renewal_notice_due_idx ON public.subscriptions(renewal_notice_at)
  WHERE renewal_notice_at IS NOT NULL;
ALTER TABLE public.payment_transactions ADD COLUMN cancel_note text
  CHECK (cancel_note IS NULL OR length(cancel_note) <= 1000);

-- Append the deferred renewal notice to whatever the constraint lists now (W136 pattern).
DO $$
DECLARE def text; added text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
    WHERE conname = 'business_events_event_type_check' AND conrelid = 'public.business_events'::regclass;
  IF def IS NULL OR def NOT LIKE '%])))' THEN RAISE EXCEPTION 'Unexpected business_events constraint: %', def; END IF;
  SELECT string_agg(format(', %L::text', t), '') INTO added
    FROM unnest(ARRAY['subscription.renewal_upcoming']) t WHERE position(quote_literal(t) IN def) = 0;
  IF added IS NULL THEN RETURN; END IF;
  ALTER TABLE public.business_events DROP CONSTRAINT business_events_event_type_check;
  EXECUTE 'ALTER TABLE public.business_events ADD CONSTRAINT business_events_event_type_check '
    || left(def, length(def) - 4) || added || '])))';
END $$;

-- ===== LICENSE SNAPSHOT: revocation reason + Sellf order =====
CREATE OR REPLACE FUNCTION public.license_event_snapshot(p_license public.issued_licenses) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE claims jsonb; encoded text; tier text; product jsonb; tx record;
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
  -- order_id is the payment intent, checkout session, renewal invoice or offline order id.
  SELECT t.id,t.order_number INTO tx FROM public.payment_transactions t
    WHERE t.stripe_payment_intent_id=p_license.order_id OR t.session_id=p_license.order_id
      OR t.stripe_invoice_id=p_license.order_id OR t.id::text=p_license.order_id
    ORDER BY (t.product_id=p_license.product_id) DESC,t.created_at LIMIT 1;
  RETURN jsonb_build_object('id',p_license.id,'product_id',p_license.product_id,'email',p_license.email,
    'order_id',p_license.order_id,'seller_id',p_license.seller_id,'original_seller_id',p_license.original_seller_id,
    'license_domain',p_license.license_domain,'issuance_source',p_license.issuance_source,
    'issued_at',p_license.issued_at,'expires_at',p_license.expires_at,'revoked_at',p_license.revoked_at,'products',product,
    'sellf_order_id',tx.id,'order_number',tx.order_number,
    'revocation_reason',CASE WHEN p_license.revoked_at IS NULL THEN NULL
      WHEN p_license.revoked_by_dispute_id IS NOT NULL THEN 'dispute'
      ELSE p_license.revocation_reason END);
END $$;
REVOKE ALL ON FUNCTION public.license_event_snapshot(public.issued_licenses) FROM PUBLIC,anon,authenticated,service_role;

-- ===== PERMANENT REVOCATION WITH A REASON =====
DROP FUNCTION public.revoke_issued_licenses(uuid[],uuid);
CREATE FUNCTION public.revoke_issued_licenses(p_license_ids uuid[],p_actor uuid DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS TABLE(id uuid,changed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item record; why text;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF cardinality(p_license_ids)>100 THEN RAISE EXCEPTION 'Too many license identifiers'; END IF;
  why:=coalesce(p_reason,CASE WHEN p_actor IS NOT NULL THEN 'manual' ELSE NULL END);
  IF why IS NOT NULL AND why NOT IN ('refund','manual','subscription_cancelled') THEN
    RAISE EXCEPTION 'Invalid revocation reason' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT l.id,l.product_id,l.email,l.order_id,l.revoked_at,l.revoked_by_dispute_id,l.revocation_reason
    FROM public.issued_licenses l WHERE l.id=ANY(p_license_ids) ORDER BY l.id FOR UPDATE
  LOOP
    -- A permanent decision takes over a dispute-owned revocation; an earlier permanent reason stays.
    UPDATE public.issued_licenses l SET revoked_at=coalesce(item.revoked_at,now()),revoked_by_dispute_id=NULL,
      revocation_reason=CASE WHEN item.revoked_at IS NULL OR item.revoked_by_dispute_id IS NOT NULL THEN why
        ELSE coalesce(item.revocation_reason,why) END
      WHERE l.id=item.id;
    IF p_actor IS NOT NULL THEN
      INSERT INTO public.audit_log(table_name,operation,performed_by,old_values,new_values)
        VALUES('issued_licenses','UPDATE',p_actor,
          jsonb_build_object('license_id',item.id,'product_id',item.product_id,'email',item.email,'order_id',item.order_id,'revoked_at',item.revoked_at),
          jsonb_build_object('action','license_revoked','license_id',item.id,'permanent',true,'reason',why));
    END IF;
    id:=item.id;changed:=item.revoked_at IS NULL;RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.revoke_issued_licenses(uuid[],uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_issued_licenses(uuid[],uuid,text) TO service_role;

-- Restoration clears the permanent reason with the revocation.
CREATE FUNCTION public.clear_license_revocation_reason() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.revoked_at IS NULL THEN NEW.revocation_reason:=NULL; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clear_license_revocation_reason() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER clear_license_revocation_reason BEFORE UPDATE OF revoked_at ON public.issued_licenses
  FOR EACH ROW EXECUTE FUNCTION public.clear_license_revocation_reason();

-- ===== ACCESS / SEAT PAYLOAD ENRICHMENT (before the event row is stored) =====
-- The access row is already gone for access.revoked, so the reason is derived from the
-- recorded context and the source facts the payload names.
CREATE FUNCTION public.add_event_contract_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE why text; sub public.subscriptions; ends timestamptz; uid uuid;
BEGIN
  IF NEW.event_type IN ('access.granted','access.updated','access.revoked','access.expired') THEN
    SELECT * INTO sub FROM public.subscriptions s WHERE s.id::text=NEW.payload->'access'->>'subscriptionId';
    IF NEW.event_type='access.expired' THEN why:='expired';
    ELSIF NEW.event_type='access.revoked' THEN
      why:=CASE
        WHEN NEW.payload->>'reason'='admin_revoke' THEN 'manual'
        WHEN NEW.payload->>'reason'='stripe_dispute' THEN 'dispute'
        WHEN sub.id IS NOT NULL THEN CASE WHEN sub.status='canceled' THEN 'subscription_cancelled' ELSE 'expired' END
        ELSE (SELECT CASE t.status WHEN 'refunded' THEN 'refund' ELSE 'dispute' END FROM public.payment_transactions t
          WHERE t.id IN (SELECT (o->>'id')::uuid FROM jsonb_array_elements(coalesce(NEW.payload->'sourceOrders','[]')) o)
            AND t.status IN ('refunded','disputed') ORDER BY t.updated_at DESC LIMIT 1)
      END;
      why:=coalesce(why,'manual');
    END IF;
    IF why IS NOT NULL THEN NEW.payload:=NEW.payload||jsonb_build_object('revocationReason',why); END IF;
    IF NEW.event_type IN ('access.granted','access.updated') THEN
      ends:=coalesce((NEW.payload->>'accessExpiresAt')::timestamptz,
        CASE WHEN sub.status IN ('active','trialing','past_due') THEN sub.current_period_end END);
      NEW.payload:=NEW.payload||jsonb_build_object('accessEndsAt',ends);
    END IF;
  ELSIF NEW.event_type LIKE 'seats.%' AND NEW.payload->'customer'->>'userId' IS NULL
    AND NEW.payload->'customer'->>'email' IS NOT NULL THEN
    SELECT u.id INTO uid FROM auth.users u WHERE lower(u.email)=lower(NEW.payload->'customer'->>'email') LIMIT 1;
    IF uid IS NOT NULL THEN NEW.payload:=jsonb_set(NEW.payload,'{customer,userId}',to_jsonb(uid)); END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.add_event_contract_fields() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER add_event_contract_fields BEFORE INSERT ON public.business_events
  FOR EACH ROW EXECUTE FUNCTION public.add_event_contract_fields();

-- ===== ONE access.updated PER SUBSCRIPTION PERIOD =====
CREATE FUNCTION public.capture_subscription_period_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.user_product_access; email text; product jsonb;
BEGIN
  IF NEW.current_period_end IS NOT DISTINCT FROM OLD.current_period_end OR NEW.current_period_end IS NULL
    OR NEW.status NOT IN ('active','trialing') THEN RETURN NEW; END IF;
  SELECT * INTO a FROM public.user_product_access x WHERE x.subscription_id=NEW.id LIMIT 1;
  IF a.id IS NULL THEN RETURN NEW; END IF;
  SELECT u.email INTO email FROM auth.users u WHERE u.id=a.user_id;
  SELECT jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug) INTO product FROM public.products p WHERE p.id=a.product_id;
  INSERT INTO public.business_events(event_type,product_id,payload,deduplication_key) VALUES('access.updated',a.product_id,
    jsonb_build_object('customFieldValues',a.custom_field_values,'customer',jsonb_build_object('userId',a.user_id,'email',email),
      'sourceOrder',NULL,'sourceOrders','[]'::jsonb,'accessGrantedAt',a.access_granted_at,'accessExpiresAt',a.access_expires_at,
      'access',jsonb_build_object('id',a.id,'grantedAt',a.access_granted_at,'expiresAt',a.access_expires_at,'expiredAt',NULL,
        'durationDays',a.access_duration_days,'subscriptionId',a.subscription_id,'statusBefore','active','statusAfter','active','revokedAt',NULL),
      'product',coalesce(product,jsonb_build_object('id',a.product_id)),'reason','subscription_renewed',
      'actor',jsonb_build_object('type','system','id',NULL),'occurredAt',clock_timestamp()),
    'access.updated:'||a.id||':period:'||NEW.current_period_end)
    ON CONFLICT(deduplication_key) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_subscription_period_access() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER capture_subscription_period_access AFTER UPDATE OF current_period_end ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.capture_subscription_period_access();

-- ===== DEFERRED RENEWAL NOTICE =====
CREATE FUNCTION public.capture_due_renewal_notices() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE count integer;
BEGIN
  WITH due AS (
    SELECT s.id,s.renewal_notice_payload AS payload FROM public.subscriptions s WHERE s.renewal_notice_at<=now()
      ORDER BY s.renewal_notice_at FOR UPDATE SKIP LOCKED LIMIT 100
  ), cleared AS (
    UPDATE public.subscriptions s SET renewal_notice_at=NULL,renewal_notice_payload=NULL FROM due
      WHERE s.id=due.id RETURNING s.id,s.product_id,s.status,s.cancel_at_period_end,s.current_period_end,due.payload
  ) INSERT INTO public.business_events(event_type,product_id,payload,deduplication_key)
    SELECT 'subscription.renewal_upcoming',c.product_id,c.payload,
      'subscription.renewal_upcoming:'||c.id||':'||coalesce(c.current_period_end::text,'')
    FROM cleared c WHERE c.status IN ('active','trialing') AND NOT c.cancel_at_period_end AND c.payload IS NOT NULL
    ON CONFLICT(deduplication_key) DO NOTHING;
  GET DIAGNOSTICS count=ROW_COUNT; RETURN count;
END $$;
REVOKE ALL ON FUNCTION public.capture_due_renewal_notices() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.capture_due_renewal_notices() TO service_role;

-- ===== ADMIN CANCELLATION TEXT =====
CREATE OR REPLACE FUNCTION public.cancel_unpaid_order(p_transaction_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  redeemed uuid;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Cancellation reason required'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider <> 'bank_transfer' THEN RAISE EXCEPTION 'Unpaid transfer required'; END IF;
  IF tx.status = 'cancelled' THEN RETURN jsonb_build_object('success', true, 'already_cancelled', true); END IF;
  IF tx.status <> 'awaiting_payment' THEN RAISE EXCEPTION 'Unpaid transfer required'; END IF;
  FOR redeemed IN DELETE FROM public.coupon_redemptions WHERE transaction_id = tx.id RETURNING coupon_id LOOP
    UPDATE public.coupons SET current_usage_count = greatest(0, current_usage_count - 1) WHERE id = redeemed;
  END LOOP;
  UPDATE public.payment_transactions SET status = 'cancelled', cancel_note = btrim(p_reason), updated_at = now() WHERE id = tx.id;
  PERFORM public.log_admin_action('cancel_unpaid_order', 'payment_transaction', tx.id::text,
    jsonb_build_object('reason', p_reason, 'coupon_id', tx.coupon_id, 'transaction_id', tx.id));
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_unpaid_order(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_order(uuid,text) TO service_role;
