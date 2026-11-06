DO $$
DECLARE def text; added text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
    WHERE conname = 'business_events_event_type_check' AND conrelid = 'public.business_events'::regclass;
  IF def IS NULL OR def NOT LIKE '%])))' THEN RAISE EXCEPTION 'Unexpected business_events constraint: %', def; END IF;
  SELECT string_agg(format(', %L::text', t), '') INTO added
    FROM unnest(ARRAY['license.updated']) t WHERE position(quote_literal(t) IN def) = 0;
  IF added IS NULL THEN RETURN; END IF;
  ALTER TABLE public.business_events DROP CONSTRAINT business_events_event_type_check;
  EXECUTE 'ALTER TABLE public.business_events ADD CONSTRAINT business_events_event_type_check '
    || left(def, length(def) - 4) || added || '])))';
END $$;

CREATE OR REPLACE FUNCTION public.add_event_contract_fields() RETURNS trigger
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
        WHEN sub.id IS NOT NULL THEN CASE WHEN sub.status='canceled' AND EXISTS(SELECT 1 FROM public.payment_transactions t WHERE t.subscription_id=sub.id AND t.refunded_amount>0) THEN 'refund' WHEN sub.status='canceled' THEN 'subscription_cancelled' ELSE 'expired' END
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

-- An expiry adjustment is observable before the normal expiry worker runs.
CREATE OR REPLACE FUNCTION public.capture_license_expiry_updated() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    INSERT INTO public.business_events(event_type,product_id,payload)
      VALUES('license.updated',NEW.product_id,jsonb_build_object('licenseRow',public.license_event_snapshot(NEW)));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_license_expiry_updated() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER capture_license_expiry_updated AFTER UPDATE OF expires_at ON public.issued_licenses
  FOR EACH ROW EXECUTE FUNCTION public.capture_license_expiry_updated();

-- All refund entry points converge on the transaction ledger, including late refunds.
CREATE OR REPLACE FUNCTION public.end_refunded_subscription_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE sub public.subscriptions; ids uuid[];
BEGIN
  IF NEW.subscription_id IS NULL OR coalesce(NEW.refunded_amount,0)<=0 THEN RETURN NEW; END IF;
  SELECT * INTO sub FROM public.subscriptions WHERE id=NEW.subscription_id;
  IF sub.status<>'canceled' OR EXISTS(SELECT 1 FROM public.payment_transactions t
    WHERE t.subscription_id=sub.id AND t.created_at>NEW.created_at AND t.status='completed') THEN RETURN NEW; END IF;
  DELETE FROM public.user_product_access WHERE subscription_id=sub.id;
  SELECT array_agg(l.id) INTO ids FROM public.issued_licenses l
    JOIN public.payment_transactions t ON t.stripe_invoice_id=l.order_id AND t.product_id=l.product_id
    WHERE t.subscription_id=sub.id;
  IF ids IS NOT NULL THEN PERFORM public.revoke_issued_licenses(ids,p_reason=>'refund'); END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.end_refunded_subscription_access() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER end_refunded_subscription_access AFTER UPDATE OF refunded_amount ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.end_refunded_subscription_access();

-- Include elapsed ledger deadlines so previously issued offline tokens stop at that deadline.
CREATE OR REPLACE FUNCTION public.seller_revoked_orders(seller uuid, hash_prefix text)
RETURNS TABLE(order_hash text) LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT h.order_hash FROM public.issued_licenses l
  CROSS JOIN LATERAL (
    SELECT encode(extensions.digest(convert_to(l.order_id,'UTF8'),'sha256'),'hex') AS order_hash
  ) h WHERE l.original_seller_id=seller
    AND (l.revoked_at IS NOT NULL OR (l.expires_at<=now() AND EXISTS(
      SELECT 1 FROM public.payment_transactions t JOIN public.subscriptions s ON s.id=t.subscription_id
      WHERE t.product_id=l.product_id AND t.stripe_invoice_id=l.order_id AND s.status='canceled')))
    AND hash_prefix ~ '^[0-9a-f]{1,64}$' AND h.order_hash LIKE hash_prefix||'%';
$$;
REVOKE ALL ON FUNCTION public.seller_revoked_orders(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.seller_revoked_orders(uuid,text) TO service_role;
