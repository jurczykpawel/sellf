-- Keep purchase contact data and final subscription state consistent across fulfillment paths.
CREATE FUNCTION public.normalize_purchase_contact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME='issued_licenses' THEN NEW.email:=lower(btrim(NEW.email));
  ELSE NEW.customer_email:=lower(btrim(NEW.customer_email)); END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.normalize_purchase_contact() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER normalize_purchase_contact BEFORE INSERT OR UPDATE OF customer_email ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.normalize_purchase_contact();
CREATE TRIGGER normalize_purchase_contact BEFORE INSERT OR UPDATE OF customer_email ON public.guest_purchases
  FOR EACH ROW EXECUTE FUNCTION public.normalize_purchase_contact();
CREATE TRIGGER normalize_purchase_contact BEFORE INSERT OR UPDATE OF email ON public.issued_licenses
  FOR EACH ROW EXECUTE FUNCTION public.normalize_purchase_contact();
UPDATE public.payment_transactions SET customer_email=lower(btrim(customer_email)) WHERE customer_email IS DISTINCT FROM lower(btrim(customer_email));
UPDATE public.guest_purchases SET customer_email=lower(btrim(customer_email)) WHERE customer_email IS DISTINCT FROM lower(btrim(customer_email));
-- Signed historical licenses retain their original claims.

CREATE FUNCTION public.keep_refunded_subscription_ended() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.payment_transactions t WHERE t.subscription_id=NEW.id AND t.status='refunded') THEN
    NEW.status:='canceled'; NEW.cancel_at_period_end:=false;
    NEW.canceled_at:=coalesce(NEW.canceled_at,now()); NEW.current_period_end:=NULL;
    NEW.paid_access_expires_at:=NULL; NEW.paid_access_invoice_id:=NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.keep_refunded_subscription_ended() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER keep_refunded_subscription_ended BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.keep_refunded_subscription_ended();

CREATE FUNCTION public.end_refunded_subscription() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.subscription_id IS NOT NULL AND NEW.status='refunded' THEN
    UPDATE public.subscriptions SET status='canceled',updated_at=now() WHERE id=NEW.subscription_id;
    DELETE FROM public.user_product_access WHERE subscription_id=NEW.subscription_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.end_refunded_subscription() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER end_refunded_subscription AFTER INSERT OR UPDATE OF status,subscription_id ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.end_refunded_subscription();
UPDATE public.subscriptions s SET status='canceled',updated_at=now()
  WHERE EXISTS(SELECT 1 FROM public.payment_transactions t WHERE t.subscription_id=s.id AND t.status='refunded');

CREATE FUNCTION public.keep_refunded_subscription_access_ended() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.subscription_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.payment_transactions t
    WHERE t.subscription_id=NEW.subscription_id AND t.status='refunded') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.keep_refunded_subscription_access_ended() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zz_keep_refunded_subscription_access_ended BEFORE INSERT OR UPDATE ON public.user_product_access
  FOR EACH ROW EXECUTE FUNCTION public.keep_refunded_subscription_access_ended();

DELETE FROM public.user_product_access a WHERE EXISTS(SELECT 1 FROM public.payment_transactions t
  WHERE t.subscription_id=a.subscription_id AND t.status='refunded');

ALTER FUNCTION public.apply_payment_dispute(uuid,text,text,boolean,text,integer,text,timestamptz)
  RENAME TO apply_payment_dispute_before_guest_claim;
REVOKE ALL ON FUNCTION public.apply_payment_dispute_before_guest_claim(uuid,text,text,boolean,text,integer,text,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.apply_payment_dispute(
  p_transaction_id uuid,p_dispute_id text,p_status text,p_closed boolean,
  p_reason text,p_amount integer,p_currency text,p_created timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; claim json; buyer uuid; guest_ids uuid[]; item jsonb; restored jsonb:='[]';
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  result:=public.apply_payment_dispute_before_guest_claim(p_transaction_id,p_dispute_id,p_status,p_closed,p_reason,p_amount,p_currency,p_created);
  IF result IS NULL OR p_status<>'won' THEN RETURN result; END IF;
  SELECT array_agg((value->>'guestPurchaseId')::uuid) INTO guest_ids
    FROM jsonb_array_elements(result->'dispute'->'restoredAccess') WHERE value->>'guestPurchaseId' IS NOT NULL;
  IF guest_ids IS NULL THEN RETURN result; END IF;
  SELECT u.id INTO buyer FROM auth.users u JOIN public.payment_transactions t ON lower(u.email)=lower(t.customer_email)
    WHERE t.id=p_transaction_id AND u.email_confirmed_at IS NOT NULL;
  IF buyer IS NULL OR NOT EXISTS(SELECT 1 FROM public.guest_purchases g WHERE g.id=ANY(guest_ids)
    AND g.claimed_by_user_id IS NULL AND g.customer_email=(SELECT email FROM auth.users WHERE id=buyer)) THEN RETURN result; END IF;
  claim:=public.claim_guest_purchases_for_user(buyer);
  IF (claim->>'success')::boolean IS DISTINCT FROM true OR EXISTS(SELECT 1 FROM public.guest_purchases g
    WHERE g.id=ANY(guest_ids) AND g.claimed_by_user_id IS NULL) THEN
    RAISE EXCEPTION 'Restored purchase claim pending' USING ERRCODE='40001';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(result->'dispute'->'restoredAccess') LOOP
    IF item->>'guestPurchaseId' IS NOT NULL AND EXISTS(SELECT 1 FROM public.guest_purchases g
      WHERE g.id=(item->>'guestPurchaseId')::uuid AND g.claimed_by_user_id=buyer) THEN
      item:=item||jsonb_build_object('userId',buyer);
    END IF;
    restored:=restored||jsonb_build_array(item);
  END LOOP;
  result:=jsonb_set(result,'{dispute,restoredAccess}',restored);
  result:=jsonb_set(result,'{customer,userId}',to_jsonb(buyer));
  UPDATE public.payment_disputes SET payload=result WHERE stripe_dispute_id=p_dispute_id;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.apply_payment_dispute(uuid,text,text,boolean,text,integer,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_payment_dispute(uuid,text,text,boolean,text,integer,text,timestamptz) TO service_role;
