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

ALTER TABLE public.business_events DROP CONSTRAINT business_events_event_type_check;
ALTER TABLE public.business_events ADD CONSTRAINT business_events_event_type_check CHECK (event_type IN (
  'access.granted','access.updated','access.revoked','access.expired','order.abandoned',
  'seats.held','seats.confirmed','seats.released','license.issued','license.revoked',
  'license.restored','license.expired'));

-- ===== B1: ISSUANCE DURING A DISPUTE =====
-- Locks the payment row first, like apply_payment_dispute, so issuance and dispute
-- handling serialize: whichever commits second sees the other's row.
CREATE FUNCTION public.revoke_license_for_disputed_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t_id uuid; dispute_id text;
BEGIN
  SELECT t.id INTO t_id FROM public.payment_transactions t
    WHERE t.product_id=NEW.product_id AND (t.stripe_payment_intent_id=NEW.order_id OR t.session_id=NEW.order_id)
    ORDER BY t.id LIMIT 1 FOR UPDATE;
  IF t_id IS NULL THEN RETURN NEW; END IF;
  SELECT d.stripe_dispute_id INTO dispute_id FROM public.payment_disputes d
    WHERE d.transaction_id=t_id AND d.status<>'won' AND d.suspended_at IS NOT NULL
    ORDER BY d.suspended_at,d.stripe_dispute_id LIMIT 1 FOR UPDATE;
  IF dispute_id IS NULL THEN RETURN NEW; END IF;
  NEW.revoked_at:=coalesce(NEW.revoked_at,now());
  NEW.revoked_by_dispute_id:=dispute_id;
  UPDATE public.payment_disputes SET revoked_license_ids=array_append(revoked_license_ids,NEW.id)
    WHERE stripe_dispute_id=dispute_id AND NOT NEW.id=ANY(revoked_license_ids);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.revoke_license_for_disputed_order() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER revoke_license_for_disputed_order BEFORE INSERT ON public.issued_licenses
  FOR EACH ROW EXECUTE FUNCTION public.revoke_license_for_disputed_order();

-- ===== license.issued (+ license.revoked when born revoked) =====
-- The snapshot never contains the signed token; the dispatcher reads it from the ledger.
CREATE FUNCTION public.capture_license_issued_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.business_events(event_type,product_id,payload,deduplication_key)
    VALUES('license.issued',NEW.product_id,jsonb_build_object('licenseRow',public.license_event_snapshot(NEW)),
      'license.issued:'||NEW.id);
  IF NEW.revoked_at IS NOT NULL THEN
    INSERT INTO public.business_events(event_type,product_id,payload)
      VALUES('license.revoked',NEW.product_id,jsonb_build_object('licenseRow',public.license_event_snapshot(NEW),
        'disputeId',NEW.revoked_by_dispute_id));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_license_issued_event() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER capture_license_issued_event AFTER INSERT ON public.issued_licenses
  FOR EACH ROW EXECUTE FUNCTION public.capture_license_issued_event();

-- ===== license.expired =====
CREATE FUNCTION public.capture_expired_licenses() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE count integer;
BEGIN
  WITH lapsed AS (
    UPDATE public.issued_licenses l SET expiry_notified_at=now() WHERE l.id IN (
      SELECT id FROM public.issued_licenses WHERE expires_at<=now() AND revoked_at IS NULL AND expiry_notified_at IS NULL
      ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 100) RETURNING l.*
  ) INSERT INTO public.business_events(event_type,product_id,payload,deduplication_key)
    SELECT 'license.expired',lapsed.product_id,jsonb_build_object('licenseRow',public.license_event_snapshot(lapsed)),
      'license.expired:'||lapsed.id FROM lapsed;
  GET DIAGNOSTICS count=ROW_COUNT; RETURN count;
END $$;
REVOKE ALL ON FUNCTION public.capture_expired_licenses() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.capture_expired_licenses() TO service_role;

-- ===== BUYER MAIL WITH THE LICENSE KEY (manual / API issuance) =====
-- license_key lives in auth metadata only while GoTrue renders the mail; the caller
-- clears it right after delivery by preparing the next mail without it.
CREATE OR REPLACE FUNCTION public.prepare_event_mail(p_email text, p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF length(p_data->>'event_date')>500 OR length(p_data->>'event_online_url')>2048
    OR (p_data->>'event_online_url') !~ '^https://[^[:space:]]+$'
    OR length(p_data->>'transfer_text')>2000 OR length(p_data->>'purchase_product')>500
    OR length(p_data->>'purchase_amount')>100 OR (p_data->>'locale') NOT IN ('pl','en')
    OR length(p_data->>'license_key')>4096 OR (p_data->>'license_key') !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    THEN RAISE EXCEPTION 'Invalid mail data' USING ERRCODE='22023'; END IF;
  UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}')
    -'event_date'-'event_online_url'-'transfer_text'-'purchase_product'-'purchase_amount'-'locale'-'license_key')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date',
      'event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text',
      'purchase_product',p_data->>'purchase_product','purchase_amount',p_data->>'purchase_amount',
      'license_key',p_data->>'license_key','locale',coalesce(p_data->>'locale','en')))
    WHERE lower(email)=lower(p_email);
END $$;
REVOKE ALL ON FUNCTION public.prepare_event_mail(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_mail(text,jsonb) TO service_role;

-- ===== BUYER MAIL LANGUAGE =====
-- Latest order locale for the address, else the account's last mail locale; NULL when unknown
-- (the caller then falls back to the seller panel language).
CREATE FUNCTION public.buyer_mail_locale(p_email text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT t.metadata->>'locale' FROM public.payment_transactions t
      WHERE lower(t.customer_email)=lower(p_email) AND t.metadata->>'locale' IN ('pl','en')
      ORDER BY t.created_at DESC LIMIT 1),
    (SELECT u.raw_user_meta_data->>'locale' FROM auth.users u
      WHERE lower(u.email)=lower(p_email) AND u.raw_user_meta_data->>'locale' IN ('pl','en') LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.buyer_mail_locale(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.buyer_mail_locale(text) TO service_role;
