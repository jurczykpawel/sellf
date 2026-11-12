

-- Append license types to whatever the constraint lists now (same pattern as W136), so
-- migrations that add event families do not overwrite each other.
DO $$
DECLARE def text; added text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
    WHERE conname = 'business_events_event_type_check' AND conrelid = 'public.business_events'::regclass;
  IF def IS NULL OR def NOT LIKE '%])))' THEN RAISE EXCEPTION 'Unexpected business_events constraint: %', def; END IF;
  SELECT string_agg(format(', %L::text', t), '') INTO added
    FROM unnest(ARRAY['license.issued','license.expired']) t WHERE position(quote_literal(t) IN def) = 0;
  IF added IS NULL THEN RETURN; END IF;
  ALTER TABLE public.business_events DROP CONSTRAINT business_events_event_type_check;
  EXECUTE 'ALTER TABLE public.business_events ADD CONSTRAINT business_events_event_type_check '
    || left(def, length(def) - 4) || added || '])))';
END $$;

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
  -- Superset of 20261103150000_unpaid_order_reservations.sql plus license_key.
  IF length(p_data->>'event_date')>500 OR length(p_data->>'event_online_url')>2048
    OR (p_data->>'event_online_url') !~ '^https://[^[:space:]]+$'
    OR length(p_data->>'transfer_text')>2000 OR length(p_data->>'purchase_product')>500
    OR length(p_data->>'purchase_amount')>100 OR (p_data->>'locale') NOT IN ('pl','en')
    OR (p_data->>'mail_kind') NOT IN ('transfer_placed','payment_reminder','order_cancelled')
    OR length(p_data->>'pay_url')>2048
    OR (p_data->>'pay_url') !~ '^https?://[^/[:space:]]+/(pl|en)/order/[0-9a-f-]{36}/transfer\?token=[0-9]{1,12}\.[A-Za-z0-9_-]{43}$'
    OR length(p_data->>'release_text')>500
    OR length(p_data->>'license_key')>4096 OR (p_data->>'license_key') !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    THEN RAISE EXCEPTION 'Invalid mail data' USING ERRCODE='22023'; END IF;
  UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}')
    -'event_date'-'event_online_url'-'transfer_text'-'purchase_product'-'purchase_amount'-'locale'-'mail_kind'-'pay_url'-'release_text'-'license_key')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date',
      'event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text',
      'purchase_product',p_data->>'purchase_product','purchase_amount',p_data->>'purchase_amount',
      'mail_kind',p_data->>'mail_kind','pay_url',p_data->>'pay_url','release_text',p_data->>'release_text',
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

-- ===== Source: 20261103180000_access_grant_source.sql =====
-- Where each access grant came from (admin Orders list, demo feedback 2026-10-29 #12).
-- Recorded once at insert; never guessed from the product price.
--
-- Sources: purchase (card or completed order, incl. claimed guest purchases), bundle (component
-- of a purchased bundle), bank_transfer (access on transfer order placement), subscription,
-- free (self-service free claim, incl. 100% coupons), manual (administrator / API grant),
-- unknown (rows created before this column, or a path that does not declare its source).
--
-- How it is set: each granting function declares its source with a function-level setting
-- `sellf.grant_source` (restored on exit, so a nested call such as the bundle component grant
-- wins only for its own rows); the BEFORE INSERT trigger copies it. Row facts that are
-- unambiguous (transfer order / subscription link) take precedence. An explicit value wins.

ALTER TABLE public.user_product_access ADD COLUMN grant_source text;

-- ===== Backfill (described per rule; first matching rule wins) =====
-- 1. Row links: transfer order → bank_transfer, subscription → subscription.
UPDATE public.user_product_access SET grant_source = 'bank_transfer' WHERE transfer_transaction_id IS NOT NULL;
UPDATE public.user_product_access SET grant_source = 'subscription' WHERE grant_source IS NULL AND subscription_id IS NOT NULL;
-- 2. Administrator grants recorded by the admin route audit trail or the access mutation event.
UPDATE public.user_product_access a SET grant_source = 'manual' WHERE a.grant_source IS NULL AND (
  EXISTS (SELECT 1 FROM public.audit_log l WHERE l.table_name = 'user_product_access' AND l.user_id = a.user_id
    AND l.new_values->>'action' = 'admin_grant_access' AND l.new_values->>'product_id' = a.product_id::text)
  OR EXISTS (SELECT 1 FROM public.business_events e WHERE e.event_type = 'access.granted'
    AND e.payload->'access'->>'id' = a.id::text AND e.payload->>'reason' = 'admin_grant'));
-- 3. A payment by this user (directly or via a claimed guest purchase) for the product → purchase;
--    for a bundle containing the product → bundle.
UPDATE public.user_product_access a SET grant_source = 'purchase' WHERE a.grant_source IS NULL AND EXISTS (
  SELECT 1 FROM public.payment_transactions t
  LEFT JOIN public.payment_line_items li ON li.transaction_id = t.id
  WHERE (t.product_id = a.product_id OR li.product_id = a.product_id)
    AND t.status IN ('completed', 'refunded', 'partially_refunded', 'disputed')
    AND (t.user_id = a.user_id OR EXISTS (SELECT 1 FROM public.guest_purchases g
      WHERE g.claimed_by_user_id = a.user_id AND (g.transaction_id = t.id OR g.session_id = t.session_id))));
UPDATE public.user_product_access a SET grant_source = 'bundle' WHERE a.grant_source IS NULL AND EXISTS (
  SELECT 1 FROM public.bundle_items b JOIN public.user_product_access parent
    ON parent.user_id = a.user_id AND parent.product_id = b.bundle_product_id AND parent.grant_source = 'purchase'
  WHERE b.component_product_id = a.product_id);
-- 4. Free claims recorded with their checkout answers.
UPDATE public.user_product_access a SET grant_source = 'free' WHERE a.grant_source IS NULL AND EXISTS (
  SELECT 1 FROM public.free_grant_contexts c JOIN auth.users u ON lower(u.email) = lower(c.email)
  WHERE u.id = a.user_id AND c.product_id = a.product_id AND c.claimed_at IS NOT NULL);
-- 5. Anything else predates source tracking and stays honestly unknown.
UPDATE public.user_product_access SET grant_source = 'unknown' WHERE grant_source IS NULL;

ALTER TABLE public.user_product_access
  ALTER COLUMN grant_source SET NOT NULL,
  ADD CONSTRAINT user_product_access_grant_source_chk
    CHECK (grant_source IN ('purchase', 'bundle', 'bank_transfer', 'subscription', 'free', 'manual', 'unknown'));
CREATE INDEX user_product_access_grant_source_idx ON public.user_product_access (grant_source, access_granted_at DESC);

-- ===== Trigger: fill the source on insert =====
CREATE OR REPLACE FUNCTION public.set_access_grant_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.grant_source := coalesce(
    NEW.grant_source,
    CASE WHEN NEW.transfer_transaction_id IS NOT NULL THEN 'bank_transfer'
         WHEN NEW.subscription_id IS NOT NULL THEN 'subscription' END,
    nullif(current_setting('sellf.grant_source', true), ''),
    'unknown');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_access_grant_source() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER set_access_grant_source
  BEFORE INSERT ON public.user_product_access
  FOR EACH ROW EXECUTE FUNCTION public.set_access_grant_source();

-- ===== Declare the source on every granting path =====
-- A function-level SET of a custom parameter needs superuser on hosted Postgres, so each granting
-- function is renamed to *_impl (grants kept) and a same-signature wrapper sets the source for the
-- duration of the call and restores the caller's value afterwards. Callers (SQL and RPC) are unchanged;
-- a nested call (bundle component inside a bundle purchase) declares its own source only while it runs.

ALTER FUNCTION public.grant_product_access_service_role(uuid, uuid, integer, integer) RENAME TO grant_product_access_service_role_impl;
CREATE FUNCTION public.grant_product_access_service_role(user_id_param uuid, product_id_param uuid, max_retries integer DEFAULT 3, override_duration_days_param integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE previous text := current_setting('sellf.grant_source', true); result jsonb;
BEGIN
  PERFORM set_config('sellf.grant_source', 'purchase', true);
  result := public.grant_product_access_service_role_impl(user_id_param, product_id_param, max_retries, override_duration_days_param);
  PERFORM set_config('sellf.grant_source', coalesce(previous, ''), true);
  RETURN result;
END;
$$;

ALTER FUNCTION public.grant_bundle_component_access(uuid, uuid, integer) RENAME TO grant_bundle_component_access_impl;
CREATE FUNCTION public.grant_bundle_component_access(user_id_param uuid, product_id_param uuid, max_retries integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE previous text := current_setting('sellf.grant_source', true); result jsonb;
BEGIN
  PERFORM set_config('sellf.grant_source', 'bundle', true);
  result := public.grant_bundle_component_access_impl(user_id_param, product_id_param, max_retries);
  PERFORM set_config('sellf.grant_source', coalesce(previous, ''), true);
  RETURN result;
END;
$$;

ALTER FUNCTION public.grant_free_product_access(text, integer, text) RENAME TO grant_free_product_access_impl;
CREATE FUNCTION public.grant_free_product_access(product_slug_param text, access_duration_days_param integer DEFAULT NULL, coupon_code_param text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE previous text := current_setting('sellf.grant_source', true); result boolean;
BEGIN
  PERFORM set_config('sellf.grant_source', 'free', true);
  result := public.grant_free_product_access_impl(product_slug_param, access_duration_days_param, coupon_code_param);
  PERFORM set_config('sellf.grant_source', coalesce(previous, ''), true);
  RETURN result;
END;
$$;

ALTER FUNCTION public.mutate_access(text, uuid, uuid, uuid, jsonb, jsonb) RENAME TO mutate_access_impl;
CREATE FUNCTION public.mutate_access(p_action text, p_user_id uuid, p_product_id uuid DEFAULT NULL, p_access_id uuid DEFAULT NULL, p_values jsonb DEFAULT '{}', p_actor jsonb DEFAULT '{}')
RETURNS SETOF public.user_product_access LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE previous text := current_setting('sellf.grant_source', true);
BEGIN
  PERFORM set_config('sellf.grant_source', 'manual', true);
  RETURN QUERY SELECT * FROM public.mutate_access_impl(p_action, p_user_id, p_product_id, p_access_id, p_values, p_actor);
  PERFORM set_config('sellf.grant_source', coalesce(previous, ''), true);
END;
$$;

-- Wrappers are SECURITY INVOKER: the caller needs the same EXECUTE rights it had on the original.
REVOKE ALL ON FUNCTION public.grant_product_access_service_role(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_product_access_service_role(uuid, uuid, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.grant_bundle_component_access(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_bundle_component_access(uuid, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.grant_free_product_access(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_free_product_access(text, integer, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mutate_access(text, uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_access(text, uuid, uuid, uuid, jsonb, jsonb) TO service_role;
-- The renamed implementations keep their original grants; restate them explicitly on the new names.
REVOKE EXECUTE ON FUNCTION public.grant_product_access_service_role_impl(uuid, uuid, integer, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_bundle_component_access_impl(uuid, uuid, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mutate_access_impl(text, uuid, uuid, uuid, jsonb, jsonb) FROM anon, authenticated, PUBLIC;
-- Free claims run as the signed-in buyer through the invoker wrapper, so authenticated keeps EXECUTE.
REVOKE EXECUTE ON FUNCTION public.grant_free_product_access_impl(text, integer, text) FROM anon, PUBLIC;

-- ===== Webhook payload: access.granted / access.updated carry grantSource =====
-- Additive field next to the legacy `reason` (kept unchanged for existing integrations);
-- grantSource is the recorded source, `reason` may still be inferred for older rules.
CREATE OR REPLACE FUNCTION public.add_access_grant_source_to_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE source text;
BEGIN
  IF NEW.event_type IN ('access.granted', 'access.updated') AND NEW.payload->'access' ? 'id' THEN
    SELECT a.grant_source INTO source FROM public.user_product_access a WHERE a.id::text = NEW.payload->'access'->>'id';
    IF source IS NOT NULL THEN NEW.payload := NEW.payload || jsonb_build_object('grantSource', source); END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_access_grant_source_to_event() FROM anon, authenticated, PUBLIC;

CREATE TRIGGER add_access_grant_source
  BEFORE INSERT ON public.business_events
  FOR EACH ROW EXECUTE FUNCTION public.add_access_grant_source_to_event();

-- ===== Source: 20261103191000_participants_later.sql =====
-- Participants added after payment ("add later"): storage, outbox event, reminder queue, buyer mail data.
-- Related: admin-panel/src/lib/orders/participants-service.ts, supabase/tests/participants-later.sql
ALTER TABLE public.payment_transactions
  ADD COLUMN participants_mail_sent_at timestamptz,
  ADD COLUMN participants_completed_at timestamptz;

-- Extend the allowed event types in place, so event types added by other migrations stay valid.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
    WHERE conname = 'business_events_event_type_check' AND conrelid = 'public.business_events'::regclass;
  IF def IS NULL OR def NOT LIKE '%])))' THEN RAISE EXCEPTION 'Unexpected business_events constraint: %', def; END IF;
  ALTER TABLE public.business_events DROP CONSTRAINT business_events_event_type_check;
  EXECUTE 'ALTER TABLE public.business_events ADD CONSTRAINT business_events_event_type_check '
    || left(def, length(def) - 4) || ', ''order.participants_updated''::text])))';
END $$;

-- A paid order whose product lets the buyer add participants later and which has none yet.
CREATE FUNCTION public.order_awaits_participants(p_order_details jsonb, p_profile jsonb, p_status text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_status = 'completed'
    AND jsonb_typeof(p_profile->'modules') = 'array'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_profile->'modules') m
      WHERE m->>'id' = 'participants' AND m->'required' = 'true'::jsonb AND m->'allow_later' = 'true'::jsonb)
    AND coalesce(jsonb_array_length(p_order_details->'participants'->'people'), 0) = 0
    AND coalesce((p_order_details->'quantity'->>'value')::integer, 1) >= 1;
$$;
REVOKE ALL ON FUNCTION public.order_awaits_participants(jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_awaits_participants(jsonb,jsonb,text) TO service_role;

CREATE FUNCTION public.list_orders_missing_participants(p_unsent_only boolean DEFAULT false, p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, order_number bigint, customer_email text, product_id uuid, product_name text, quantity integer,
  created_at timestamptz, mail_sent_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT t.id, t.order_number, t.customer_email, t.product_id, p.name,
    coalesce((t.order_details->'quantity'->>'value')::integer, 1), t.created_at, t.participants_mail_sent_at
  FROM public.payment_transactions t JOIN public.products p ON p.id = t.product_id
  WHERE public.order_awaits_participants(t.order_details, p.checkout_profile, t.status)
    AND (NOT p_unsent_only OR t.participants_mail_sent_at IS NULL)
  ORDER BY t.created_at, t.id LIMIT greatest(1, least(p_limit, 500));
END $$;
REVOKE ALL ON FUNCTION public.list_orders_missing_participants(boolean,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_orders_missing_participants(boolean,integer) TO service_role;

-- One atomic completion: stores the list and commits the webhook event with it.
CREATE FUNCTION public.submit_order_participants(p_order_id uuid, p_people jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions; prod public.products; qty integer; person jsonb;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  SELECT * INTO prod FROM public.products WHERE id = tx.product_id;
  IF tx.status <> 'completed' THEN RETURN jsonb_build_object('ok', false, 'code', 'not_paid'); END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(prod.checkout_profile->'modules', '[]')) m
      WHERE m->>'id' = 'participants' AND m->'allow_later' = 'true'::jsonb) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_allowed');
  END IF;
  IF coalesce(jsonb_array_length(tx.order_details->'participants'->'people'), 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_complete');
  END IF;
  qty := coalesce((tx.order_details->'quantity'->>'value')::integer, 1);
  IF p_people IS NULL OR jsonb_typeof(p_people) <> 'array' OR jsonb_array_length(p_people) <> qty THEN
    RETURN jsonb_build_object('ok', false, 'code', 'participant_count');
  END IF;
  FOR person IN SELECT * FROM jsonb_array_elements(p_people) LOOP
    IF jsonb_typeof(person) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(person)) <> 3
       OR jsonb_typeof(person->'first_name') <> 'string' OR jsonb_typeof(person->'last_name') <> 'string'
       OR jsonb_typeof(person->'email') <> 'string' OR length(person->>'email') > 254 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid');
    END IF;
  END LOOP;
  UPDATE public.payment_transactions SET
    order_details = coalesce(order_details, '{}'::jsonb) || jsonb_build_object('participants', jsonb_build_object('v', 1, 'people', p_people)),
    participants_completed_at = now(), updated_at = now()
  WHERE id = tx.id;
  INSERT INTO public.business_events(event_type, product_id, payload, deduplication_key)
  VALUES ('order.participants_updated', tx.product_id, jsonb_build_object(
    'customer', jsonb_build_object('userId', tx.user_id, 'email', tx.customer_email),
    'order', jsonb_build_object('orderId', tx.id, 'orderNumber', tx.order_number, 'status', tx.status),
    'product', jsonb_build_object('id', prod.id, 'name', prod.name, 'slug', prod.slug),
    'orderDetails', jsonb_build_object('quantity', tx.order_details->'quantity', 'participants', jsonb_build_object('v', 1, 'people', p_people)),
    'reason', 'participants_added_after_payment',
    'actor', jsonb_build_object('type', 'customer', 'id', NULL),
    'occurredAt', clock_timestamp()), 'order.participants_updated:' || tx.id)
  ON CONFLICT (deduplication_key) DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.submit_order_participants(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order_participants(uuid,jsonb) TO service_role;

-- Buyer mail data: new notice kind and its signed participants link. The current definition is patched in
-- place (not replaced), so fields added by other migrations (mail_kind/pay_url/release_text, license_key, ...) survive.
DO $$
DECLARE def text := pg_get_functiondef('public.prepare_event_mail(text,jsonb)'::regprocedure); patched text := def;
BEGIN
  patched := replace(patched, $a$'order_cancelled'$a$, $b$'order_cancelled','participants_needed'$b$);
  patched := replace(patched, $a$    OR length(p_data->>'release_text')>500$a$,
    $b$    OR length(p_data->>'participants_url')>2048
    OR (p_data->>'participants_url') !~ '^https?://[^/[:space:]]+/(pl|en)/order/[0-9a-f-]{36}/participants\?token=[0-9]{1,12}\.[A-Za-z0-9_-]{43}$'
    OR length(p_data->>'release_text')>500$b$);
  patched := replace(patched, $a$-'release_text'$a$, $b$-'release_text'-'participants_url'$b$);
  patched := replace(patched, $a$'release_text',p_data->>'release_text',$a$, $b$'release_text',p_data->>'release_text','participants_url',p_data->>'participants_url',$b$);
  IF patched NOT LIKE '%''participants_needed''%' OR patched NOT LIKE '%OR length(p_data->>''participants_url'')>2048%'
     OR patched NOT LIKE '%-''participants_url''%' OR patched NOT LIKE '%''participants_url'',p_data->>''participants_url''%' THEN
    RAISE EXCEPTION 'prepare_event_mail has an unexpected shape';
  END IF;
  EXECUTE patched;
END $$;

-- ===== Source: 20261103192000_participants_reminder_stages.sql =====
-- Participants reminders: first 24 h after purchase, second 2 days before the event (max two mails per order).
-- Products without an event date get only the first. Related: admin-panel/src/lib/orders/participants-service.ts
ALTER TABLE public.payment_transactions ADD COLUMN participants_reminder2_sent_at timestamptz;

CREATE FUNCTION public.list_participants_reminders_due(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, stage integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH waiting AS (
    SELECT t.id, t.participants_mail_sent_at AS first_sent, t.participants_reminder2_sent_at AS second_sent,
      coalesce(t.paid_at, t.created_at) AS bought_at,
      (SELECT min(s.starts_at) FROM public.payment_line_items l JOIN public.product_sessions s ON s.id = l.session_id
        WHERE l.transaction_id = t.id) AS event_at
    FROM public.payment_transactions t JOIN public.products p ON p.id = t.product_id
    WHERE public.order_awaits_participants(t.order_details, p.checkout_profile, t.status)
  )
  SELECT w.id, CASE
      WHEN w.event_at IS NOT NULL AND w.second_sent IS NULL AND p_now >= w.event_at - interval '2 days' AND p_now < w.event_at THEN 2
      WHEN w.first_sent IS NULL AND p_now >= w.bought_at + interval '24 hours' AND (w.event_at IS NULL OR p_now < w.event_at) THEN 1
    END
  FROM waiting w
  WHERE (w.event_at IS NOT NULL AND w.second_sent IS NULL AND p_now >= w.event_at - interval '2 days' AND p_now < w.event_at)
     OR (w.first_sent IS NULL AND p_now >= w.bought_at + interval '24 hours' AND (w.event_at IS NULL OR p_now < w.event_at))
  ORDER BY w.bought_at, w.id LIMIT greatest(1, least(p_limit, 500));
END $$;
REVOKE ALL ON FUNCTION public.list_participants_reminders_due(timestamptz,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_participants_reminders_due(timestamptz,integer) TO service_role;

-- Seller panel shows the latest reminder.
CREATE OR REPLACE FUNCTION public.list_orders_missing_participants(p_unsent_only boolean DEFAULT false, p_limit integer DEFAULT 100)
RETURNS TABLE(id uuid, order_number bigint, customer_email text, product_id uuid, product_name text, quantity integer,
  created_at timestamptz, mail_sent_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT t.id, t.order_number, t.customer_email, t.product_id, p.name,
    coalesce((t.order_details->'quantity'->>'value')::integer, 1), t.created_at,
    coalesce(t.participants_reminder2_sent_at, t.participants_mail_sent_at)
  FROM public.payment_transactions t JOIN public.products p ON p.id = t.product_id
  WHERE public.order_awaits_participants(t.order_details, p.checkout_profile, t.status)
    AND (NOT p_unsent_only OR t.participants_mail_sent_at IS NULL)
  ORDER BY t.created_at, t.id LIMIT greatest(1, least(p_limit, 500));
END $$;

-- ===== Source: 20261103234000_transfer_paid_mail.sql =====
-- Marks that the buyer was told the transfer was booked (the mail context itself: prepare_event_mail superset migration).
ALTER TABLE public.payment_transactions ADD COLUMN transfer_paid_mail_sent_at timestamptz;
-- Orders paid before this release are not announced retroactively.
UPDATE public.payment_transactions SET transfer_paid_mail_sent_at = now()
  WHERE payment_provider = 'bank_transfer' AND status = 'completed' AND transfer_paid_mail_sent_at IS NULL;
CREATE INDEX payment_transactions_transfer_paid_mail_idx ON public.payment_transactions (id)
  WHERE payment_provider = 'bank_transfer' AND status = 'completed' AND transfer_paid_mail_sent_at IS NULL;

-- ===== Source: 20261103235000_prepare_event_mail_superset.sql =====
-- One definition of the Auth mail context for every sender: order notices (mail_kind, pay_url, release_text,
-- participants_url), structured transfer details, payment-received flag and license key. Supersedes earlier
-- redefinitions, so later ones must extend this list instead of replacing it.
CREATE OR REPLACE FUNCTION public.prepare_event_mail(p_email text, p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF length(p_data->>'event_date')>500 OR length(p_data->>'event_online_url')>2048
    OR (p_data->>'event_online_url') !~ '^https://[^[:space:]]+$'
    OR length(p_data->>'transfer_text')>2000 OR length(p_data->>'purchase_product')>500
    OR length(p_data->>'purchase_amount')>100 OR (p_data->>'locale') NOT IN ('pl','en')
    OR (p_data->>'mail_kind') NOT IN ('transfer_placed','payment_reminder','order_cancelled','participants_needed')
    OR length(p_data->>'pay_url')>2048
    OR (p_data->>'pay_url') !~ '^https?://[^/[:space:]]+/(pl|en)/order/[0-9a-f-]{36}/transfer\?token=[0-9]{1,12}\.[A-Za-z0-9_-]{43}$'
    OR length(p_data->>'participants_url')>2048
    OR (p_data->>'participants_url') !~ '^https?://[^/[:space:]]+/(pl|en)/order/[0-9a-f-]{36}/participants\?token=[0-9]{1,12}\.[A-Za-z0-9_-]{43}$'
    OR length(p_data->>'release_text')>500
    OR length(p_data->>'license_key')>4096 OR (p_data->>'license_key') !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    OR (p_data ? 'payment_received' AND (p_data->>'payment_received') <> 'true')
    OR (p_data ? 'transfer' AND (jsonb_typeof(p_data->'transfer') <> 'object'
      OR octet_length((p_data->'transfer')::text)>2000
      OR EXISTS (SELECT 1 FROM jsonb_each(p_data->'transfer') e
        WHERE jsonb_typeof(e.value) <> 'string' OR e.key NOT IN ('holder','account','bank','title','amount','due'))))
    THEN RAISE EXCEPTION 'Invalid mail data' USING ERRCODE='22023'; END IF;
  UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}')
    -'event_date'-'event_online_url'-'transfer_text'-'transfer'-'purchase_product'-'purchase_amount'-'locale'
    -'mail_kind'-'pay_url'-'release_text'-'participants_url'-'license_key'-'payment_received')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date',
      'event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text','transfer',p_data->'transfer',
      'purchase_product',p_data->>'purchase_product','purchase_amount',p_data->>'purchase_amount',
      'mail_kind',p_data->>'mail_kind','pay_url',p_data->>'pay_url','release_text',p_data->>'release_text',
      'participants_url',p_data->>'participants_url','license_key',p_data->>'license_key',
      'payment_received',p_data->>'payment_received',
      'locale',coalesce(p_data->>'locale','en')))
    WHERE lower(email)=lower(p_email);
END $$;
REVOKE ALL ON FUNCTION public.prepare_event_mail(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_mail(text,jsonb) TO service_role;

-- ===== Source: 20261104030000_webhook_contract_w152.sql =====
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
  CHECK (revocation_reason IN ('refund','dispute','manual','subscription_cancelled','expired'));
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
  IF why IS NOT NULL AND why NOT IN ('refund','manual','subscription_cancelled','expired') THEN
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
REVOKE EXECUTE ON FUNCTION public.revoke_issued_licenses(uuid[],uuid,text) FROM PUBLIC,anon,authenticated;
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

-- ===== Source: 20261104051510_transfer_paid_at_window.sql =====
-- W146 B10: the receipt date of a bank transfer ("Oznacz jako opłacone") must fall between
-- the order day (UTC) and now. Both violations return a code instead of raising, so the
-- admin panel and API v1 can name the problem. Body otherwise identical to
-- 20261103150000_unpaid_order_reservations.sql.
CREATE OR REPLACE FUNCTION public.admin_bank_transfer_order(p_id uuid,p_action text,p_amount numeric DEFAULT NULL,p_paid_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL,p_actor uuid DEFAULT NULL,p_accept_cancelled boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; tx public.payment_transactions%ROWTYPE; invoice_status text; reopen boolean:=false;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.admin_users WHERE user_id=p_actor) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  SELECT status INTO invoice_status FROM public.invoices WHERE transaction_id=p_id;
  IF p_action='mark-paid' THEN
    IF p_paid_at IS NULL THEN RAISE EXCEPTION 'Invalid payment date' USING ERRCODE='22023'; END IF;
    IF p_paid_at>now() THEN RETURN jsonb_build_object('success',false,'error','paid_at_future'); END IF;
    IF p_paid_at<(date_trunc('day',tx.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') THEN
      RETURN jsonb_build_object('success',false,'error','paid_at_before_order');
    END IF;
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

-- ===== Source: 20261105120000_webhook_consumer_fields.sql =====
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
  RETURN jsonb_build_object('id',p_license.id,'product_id',p_license.product_id,'email',p_license.email,'user_id',p_license.user_id,
    'order_id',p_license.order_id,'seller_id',p_license.seller_id,'original_seller_id',p_license.original_seller_id,
    'license_domain',p_license.license_domain,'issuance_source',p_license.issuance_source,
    'issued_at',p_license.issued_at,'expires_at',p_license.expires_at,'revoked_at',p_license.revoked_at,'products',product,
    'sellf_order_id',tx.id,'order_number',tx.order_number,
    'revocation_reason',CASE WHEN p_license.revoked_at IS NULL THEN NULL
      WHEN p_license.revoked_by_dispute_id IS NOT NULL THEN 'dispute'
      ELSE p_license.revocation_reason END);
END $$;
REVOKE ALL ON FUNCTION public.license_event_snapshot(public.issued_licenses) FROM PUBLIC,anon,authenticated,service_role;

-- ===== Source: 20261106120000_subscription_paid_access.sql =====
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

-- ===== Source: 20261107160000_license_customer_locale.sql =====
ALTER TABLE public.issued_licenses ADD COLUMN customer_locale text CHECK (customer_locale IN ('pl','en'));

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
  RETURN jsonb_build_object('id',p_license.id,'product_id',p_license.product_id,'email',p_license.email,'user_id',p_license.user_id,
    'order_id',p_license.order_id,'seller_id',p_license.seller_id,'original_seller_id',p_license.original_seller_id,
    'license_domain',p_license.license_domain,'issuance_source',p_license.issuance_source,
    'issued_at',p_license.issued_at,'expires_at',p_license.expires_at,'revoked_at',p_license.revoked_at,'products',product,
    'customer_locale',p_license.customer_locale,'sellf_order_id',tx.id,'order_number',tx.order_number,
    'revocation_reason',CASE WHEN p_license.revoked_at IS NULL THEN NULL
      WHEN p_license.revoked_by_dispute_id IS NOT NULL THEN 'dispute'
      ELSE p_license.revocation_reason END);
END $$;

-- ===== Source: 20261107220000_guest_subscription_paid_claim.sql =====
ALTER TABLE public.subscriptions
  ADD COLUMN paid_access_expires_at timestamptz,
  ADD COLUMN paid_access_invoice_id text;

CREATE FUNCTION public.claim_paid_subscription_access(p_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Serialize claims with changes to the payment ledger.
  PERFORM 1 FROM public.payment_transactions t
  JOIN public.subscriptions s ON s.id=t.subscription_id AND s.paid_access_invoice_id=t.stripe_invoice_id
  WHERE s.user_id=p_user_id AND s.status='canceled'
  ORDER BY t.id FOR UPDATE OF t;

  INSERT INTO public.user_product_access(user_id,product_id,subscription_id,access_granted_at,access_expires_at,grant_source)
  SELECT DISTINCT ON (s.product_id) s.user_id,s.product_id,s.id,now(),s.paid_access_expires_at,'subscription'
  FROM public.subscriptions s
  JOIN auth.users u ON u.id=s.user_id AND u.email_confirmed_at IS NOT NULL
  JOIN public.payment_transactions t ON t.subscription_id=s.id AND t.stripe_invoice_id=s.paid_access_invoice_id
    AND t.product_id=s.product_id AND t.status='completed' AND coalesce(t.refunded_amount,0)=0
  WHERE s.user_id=p_user_id AND s.status='canceled' AND s.paid_access_expires_at>now()
  ORDER BY s.product_id,s.paid_access_expires_at DESC,s.id
  ON CONFLICT (user_id,product_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.claim_paid_subscription_access(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paid_subscription_access(uuid) TO service_role;

-- Reuse the existing claim entry point for both confirmation and explicit claims.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.claim_guest_purchases_for_user(uuid)'::regprocedure) INTO definition;
  IF position('  RETURN result;' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected guest claim definition'; END IF;
  EXECUTE replace(definition,'  RETURN result;',
    E'  PERFORM public.claim_paid_subscription_access(p_user_id);\n  RETURN result;');
END $$;

-- ===== Source: 20261108160000_purchase_final_state.sql =====
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

-- ===== Source: 20261108170000_product_content_url_cleanup.sql =====
-- Normalize stored content URLs and preserve item metadata.
WITH repaired AS (
  SELECT p.id, jsonb_agg(
    CASE WHEN item->>'type' IN ('video_embed', 'download_link')
                   AND jsonb_typeof(item->'config') = 'object'
      THEN jsonb_set(item, '{config}',
        ((item->'config') - 'embed_url' - 'download_url') || jsonb_build_object(
          keys.canonical,
          CASE
            WHEN translate(item->'config'->>keys.canonical, chr(9)||chr(10)||chr(13), '') ~* '^[[:cntrl:][:space:]]*https:'
              THEN item->'config'->>keys.canonical
            WHEN coalesce(item->'config'->>keys.canonical, '') ~ '^[[:cntrl:][:space:]]*$'
                 AND translate(item->'config'->>keys.previous, chr(9)||chr(10)||chr(13), '') ~* '^[[:cntrl:][:space:]]*https:'
              THEN item->'config'->>keys.previous
            ELSE ''
          END))
      ELSE item END ORDER BY position
    ) AS items
  FROM public.products p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.content_config->'content_items') = 'array'
      THEN p.content_config->'content_items' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS entries(item, position)
  CROSS JOIN LATERAL (SELECT
    CASE WHEN item->>'type' = 'download_link' THEN 'download_url' ELSE 'embed_url' END AS canonical,
    CASE WHEN item->>'type' = 'download_link' THEN 'embed_url' ELSE 'download_url' END AS previous
  ) keys
  GROUP BY p.id
)
UPDATE public.products p
SET content_config = jsonb_set(p.content_config, '{content_items}', repaired.items)
FROM repaired
WHERE p.id = repaired.id
  AND p.content_config->'content_items' IS DISTINCT FROM repaired.items;

-- ===== Source: 20261109210000_guest_order_claim_state.sql =====
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public._claim_guest_purchases_before_disputes(uuid)'::regprocedure) INTO definition;
  IF position('WHERE gp.customer_email=email AND gp.claimed_by_user_id IS NULL FOR UPDATE' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected guest claim definition';
  END IF;
  EXECUTE replace(definition,
    'WHERE gp.customer_email=email AND gp.claimed_by_user_id IS NULL FOR UPDATE',
    E'WHERE gp.customer_email=email AND gp.claimed_by_user_id IS NULL\n      AND (pt.id IS NULL OR (pt.status NOT IN (''refunded'',''disputed'',''cancelled'')\n        AND (pt.amount=0 OR coalesce(pt.refunded_amount,0)<pt.amount))) FOR UPDATE');
END $$;

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.claim_guest_purchases_for_user(uuid)'::regprocedure) INTO definition;
  IF position('AND NOT g.metadata ? ''_dispute_access_terms''' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected guest terms definition';
  END IF;
  EXECUTE replace(definition,
    'AND NOT g.metadata ? ''_dispute_access_terms''',
    E'AND NOT g.metadata ? ''_dispute_access_terms''\n      AND NOT EXISTS(SELECT 1 FROM public.payment_transactions t\n        WHERE (t.id=g.transaction_id OR (g.transaction_id IS NULL AND t.session_id=g.session_id))\n          AND (t.status IN (''refunded'',''disputed'',''cancelled'') OR (t.amount>0 AND coalesce(t.refunded_amount,0)>=t.amount)))');

  SELECT pg_get_functiondef('public.release_transfer_access()'::regprocedure) INTO definition;
  IF position('IF NEW.status=''cancelled'' AND OLD.status=''awaiting_payment'' THEN' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected transfer release definition';
  END IF;
  EXECUTE replace(definition,
    'IF NEW.status=''cancelled'' AND OLD.status=''awaiting_payment'' THEN',
    'IF (NEW.status=''cancelled'' AND OLD.status=''awaiting_payment'') OR (NEW.status=''refunded'' AND NEW.status IS DISTINCT FROM OLD.status) THEN');
END $$;

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.transfer_access_source()'::regprocedure) INTO definition;
  IF position('  IF txid IS NOT NULL AND EXISTS' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected transfer source definition'; END IF;
  EXECUTE replace(definition,'  IF txid IS NOT NULL AND EXISTS',
    E'  IF TG_OP=''UPDATE'' AND txid IS NULL\n    AND NEW.subscription_id IS NOT DISTINCT FROM OLD.subscription_id\n    AND NEW.access_granted_at IS NOT DISTINCT FROM OLD.access_granted_at\n    AND coalesce(current_setting(''sellf.grant_source'',true),'''') NOT IN (''purchase'',''bundle'',''free'') THEN RETURN NEW; END IF;\n  IF txid IS NOT NULL AND EXISTS');
END $$;

-- ===== Source: 20261110010000_order_license_revocation.sql =====
-- Resolve an order without rewriting historical signed order claims.
CREATE FUNCTION public.license_order_references(p_order public.payment_transactions) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT array_remove(ARRAY[p_order.id::text,p_order.session_id,p_order.stripe_payment_intent_id,p_order.stripe_invoice_id],NULL)
$$;
REVOKE ALL ON FUNCTION public.license_order_references(public.payment_transactions) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.revoke_order_licenses(p_product_id uuid,p_order_ids text[],p_reason text)
RETURNS TABLE(id uuid,changed boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE refs text[]; item record;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  PERFORM t.id FROM public.payment_transactions t
    WHERE t.product_id=p_product_id AND public.license_order_references(t) && p_order_ids ORDER BY t.id FOR UPDATE;
  SELECT array_agg(DISTINCT ref) INTO refs FROM public.payment_transactions t
    CROSS JOIN LATERAL unnest(public.license_order_references(t)) ref
    WHERE t.product_id=p_product_id AND public.license_order_references(t) && p_order_ids;
  FOR item IN SELECT l.id FROM public.issued_licenses l
    WHERE (refs IS NOT NULL AND l.order_id=ANY(refs))
      OR (l.product_id=p_product_id AND l.order_id=ANY(p_order_ids))
    ORDER BY l.id FOR UPDATE
  LOOP
    RETURN QUERY SELECT * FROM public.revoke_issued_licenses(ARRAY[item.id],NULL,p_reason);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.revoke_order_licenses(uuid,text[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_order_licenses(uuid,text[],text) TO service_role;

-- All refund entry points persist the same transaction state; capture the decision there.
CREATE FUNCTION public.revoke_terminal_order_licenses() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE refs text[];
BEGIN
  IF NEW.status IN ('refunded','cancelled') OR (NEW.amount>0 AND NEW.refunded_amount>=NEW.amount) THEN
    refs:=public.license_order_references(NEW);
    PERFORM l.id FROM public.issued_licenses l WHERE l.order_id=ANY(refs) ORDER BY l.id FOR UPDATE;
    UPDATE public.issued_licenses l SET revoked_at=coalesce(l.revoked_at,now()),revoked_by_dispute_id=NULL,
      revocation_reason=CASE WHEN NEW.status='cancelled' THEN 'manual' ELSE 'refund' END
      WHERE l.order_id=ANY(refs)
        AND (l.revoked_at IS NULL OR l.revoked_by_dispute_id IS NOT NULL);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.revoke_terminal_order_licenses() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER revoke_terminal_order_licenses AFTER INSERT OR UPDATE OF status,refunded_amount ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.revoke_terminal_order_licenses();

-- Serialize issuance with refund/dispute decisions. A delayed fulfillment cannot resurrect an order.
CREATE OR REPLACE FUNCTION public.revoke_license_for_disputed_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions; dispute_id text;
BEGIN
  SELECT t.* INTO tx FROM public.payment_transactions t
    WHERE t.id=CASE WHEN NEW.order_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NEW.order_id::uuid END
      OR t.session_id=NEW.order_id OR t.stripe_payment_intent_id=NEW.order_id OR t.stripe_invoice_id=NEW.order_id
    ORDER BY (t.product_id=NEW.product_id) DESC,t.created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF tx.status IN ('refunded','cancelled') OR (tx.amount>0 AND tx.refunded_amount>=tx.amount) THEN
    NEW.revoked_at:=coalesce(NEW.revoked_at,now());
    NEW.revoked_by_dispute_id:=NULL;
    NEW.revocation_reason:=CASE WHEN tx.status='cancelled' THEN 'manual' ELSE 'refund' END;
  ELSIF tx.status='disputed' THEN
    SELECT d.stripe_dispute_id INTO dispute_id FROM public.payment_disputes d
      WHERE d.transaction_id=tx.id AND d.status<>'won' AND d.suspended_at IS NOT NULL ORDER BY d.suspended_at,d.stripe_dispute_id LIMIT 1 FOR UPDATE;
    IF dispute_id IS NOT NULL THEN
      NEW.revoked_at:=coalesce(NEW.revoked_at,now());
      NEW.revoked_by_dispute_id:=dispute_id;
      UPDATE public.payment_disputes SET revoked_license_ids=array_append(revoked_license_ids,NEW.id)
        WHERE stripe_dispute_id=dispute_id AND NOT NEW.id=ANY(revoked_license_ids);
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.revoke_license_for_disputed_order() FROM PUBLIC,anon,authenticated,service_role;

-- Keep dispute ownership/restoration unchanged; extend only the order membership predicate.
DO $$ DECLARE definition text; original text; BEGIN
  SELECT pg_get_functiondef('public.apply_payment_dispute_before_guest_claim(uuid,text,text,boolean,text,integer,text,timestamptz)'::regprocedure) INTO definition;
  original:=definition;
  definition:=replace(definition,'l.product_id=t.product_id' || chr(10) || '        AND l.order_id IN (t.stripe_payment_intent_id,t.session_id)',
    'l.order_id=ANY(public.license_order_references(t))');
  definition:=replace(definition,'l.order_id IN (t.stripe_payment_intent_id,t.session_id)',
    'l.order_id=ANY(public.license_order_references(t))');
  IF definition=original OR definition LIKE '%l.product_id=t.product_id%' THEN RAISE EXCEPTION 'Order license predicate not updated'; END IF;
  EXECUTE definition;
END $$;

-- Repair existing full refunds and cancellations, preserving tokens and their CRL hashes.
UPDATE public.issued_licenses l SET revoked_at=coalesce(l.revoked_at,now()),revoked_by_dispute_id=NULL,
  revocation_reason=CASE WHEN t.status='cancelled' THEN 'manual' ELSE 'refund' END
FROM public.payment_transactions t
WHERE (t.status IN ('refunded','cancelled') OR (t.amount>0 AND t.refunded_amount>=t.amount))
  AND l.order_id=ANY(public.license_order_references(t))
  AND (l.revoked_at IS NULL OR l.revoked_by_dispute_id IS NOT NULL);

-- Sellf 2026.11.0: attribution.
-- Source sections retain their SQL and relative order within this area.

-- ===== Source: 20261103120000_purchase_attribution.sql =====
-- Purchase attribution: where did a purchase come from (2026.10.8).
--
-- Owner decisions 2026-11-03 (priv/rfc/2026-11-03-atrybucja-zakupow-ustalenia.md):
--   * without cookie consent the source comes from the URL that opened the checkout;
--     with consent the collector also keeps first and last touch;
--   * click ids (gclid/fbclid/...) only with marketing consent, kept for a seller-configured
--     number of days (default 30), then erased (the click id TYPE stays for reporting);
--   * partners (affiliate coupons) are a channel in the same report;
--   * no merging of small groups.
--
-- Flow: checkout endpoints store the validated payload in checkout_attribution under the
-- checkout reference (Stripe session / intent / subscription id, or an order reference kept in
-- payment_transactions.metadata.sf_attr_ref). When an order becomes a purchase the trigger on
-- payment_transactions copies it once into purchase_attribution, classifies the channel with
-- the seller's rules and never changes it again (immutable snapshot).
--
-- @see admin-panel/src/lib/attribution/

-- ===== SETTINGS =====
CREATE TABLE public.attribution_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  click_id_retention_days integer NOT NULL DEFAULT 30 CHECK (click_id_retention_days BETWEEN 1 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.attribution_settings(id) VALUES (1);
ALTER TABLE public.attribution_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.attribution_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admin read" ON public.attribution_settings FOR SELECT TO authenticated USING ((select public.is_admin()));
CREATE POLICY "Admin update" ON public.attribution_settings FOR UPDATE TO authenticated
  USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));
REVOKE ALL ON public.attribution_settings FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.attribution_settings TO authenticated;
GRANT ALL ON public.attribution_settings TO service_role;

-- ===== CHANNEL RULES (per seller, first match by priority wins) =====
CREATE TABLE public.attribution_channel_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  priority integer NOT NULL CHECK (priority BETWEEN 0 AND 100000),
  channel text NOT NULL CHECK (channel ~ '^[a-z0-9_]{1,40}$'),
  field text NOT NULL CHECK (field IN ('source','medium','campaign','referrer_host','click_id_type')),
  operator text NOT NULL CHECK (operator IN ('equals','in','contains','host_in','exists')),
  value text CHECK (value IS NULL OR length(value) BETWEEN 1 AND 2000),
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (operator = 'exists' OR value IS NOT NULL)
);
CREATE INDEX attribution_channel_rules_order ON public.attribution_channel_rules(priority, created_at) WHERE is_active;
ALTER TABLE public.attribution_channel_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.attribution_channel_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admin manage" ON public.attribution_channel_rules FOR ALL TO authenticated
  USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));
REVOKE ALL ON public.attribution_channel_rules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attribution_channel_rules TO authenticated;
GRANT ALL ON public.attribution_channel_rules TO service_role;

INSERT INTO public.attribution_channel_rules(priority, channel, field, operator, value, is_default) VALUES
  (100, 'affiliate',      'medium',        'in',       'affiliate,partner,affiliates', true),
  (200, 'paid_search',    'click_id_type', 'in',       'gclid,gbraid,wbraid,msclkid', true),
  (300, 'paid_social',    'click_id_type', 'in',       'fbclid,ttclid,twclid,li_fat_id', true),
  (400, 'paid_search',    'medium',        'in',       'cpc,ppc,paid_search,paidsearch,sem', true),
  (500, 'paid_social',    'medium',        'in',       'paid_social,paidsocial,paid-social,social_paid,cpm,display', true),
  (600, 'email',          'medium',        'in',       'email,e-mail,newsletter,mail', true),
  (700, 'email',          'source',        'in',       'listmonk,mailchimp,mailerlite,getresponse,convertkit,kit,brevo,newsletter,mailstack', true),
  (800, 'organic_social', 'medium',        'in',       'social,organic_social,social-organic,organic-social', true),
  (900, 'organic_social', 'referrer_host', 'host_in',  'facebook.com,instagram.com,t.co,x.com,twitter.com,linkedin.com,lnkd.in,youtube.com,tiktok.com,pinterest.com,reddit.com,threads.net,threads.com', true),
  (1000,'organic_search', 'referrer_host', 'contains', 'google.,bing.com,duckduckgo.com,yahoo.,ecosia.org,yandex.,baidu.com,search.brave.com', true),
  (1100,'referral',       'referrer_host', 'exists',   NULL, true);

-- ===== PENDING (checkout → purchase handoff) =====
CREATE TABLE public.checkout_attribution (
  ref text PRIMARY KEY CHECK (length(ref) BETWEEN 1 AND 255),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.checkout_attribution ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.checkout_attribution FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.checkout_attribution FROM anon, authenticated;
GRANT ALL ON public.checkout_attribution TO service_role;

-- ===== SNAPSHOT =====
CREATE TABLE public.purchase_attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid UNIQUE REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('payment','subscription','renewal','bank_transfer','free')),
  channel text NOT NULL CHECK (channel ~ '^[a-z0-9_]{1,40}$'),
  first_channel text CHECK (first_channel IS NULL OR first_channel ~ '^[a-z0-9_]{1,40}$'),
  affiliate_member_id uuid REFERENCES public.affiliate_memberships(id) ON DELETE SET NULL,
  mode text NOT NULL CHECK (mode IN ('url','stored','none')),
  consent text NOT NULL CHECK (consent IN ('none','analytics','marketing')),
  last_source text, last_medium text, last_campaign text, last_content text, last_term text, last_utm_id text,
  last_referrer_host text, last_landing_path text, last_at timestamptz,
  first_source text, first_medium text, first_campaign text, first_content text, first_term text, first_utm_id text,
  first_referrer_host text, first_landing_path text, first_at timestamptz,
  sessions_count integer CHECK (sessions_count IS NULL OR sessions_count BETWEEN 1 AND 10000),
  first_seen_at timestamptz,
  click_id_type text CHECK (click_id_type IS NULL OR click_id_type ~ '^[a-z_]{2,20}$'),
  click_id text CHECK (click_id IS NULL OR length(click_id) <= 255),
  click_id_expires_at timestamptz,
  device_class text NOT NULL DEFAULT 'unknown' CHECK (device_class IN ('desktop','mobile','tablet','bot','unknown')),
  country text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'free') = (transaction_id IS NULL))
);
CREATE UNIQUE INDEX purchase_attribution_free_once ON public.purchase_attribution(product_id, user_id) WHERE kind = 'free';
CREATE INDEX purchase_attribution_created ON public.purchase_attribution(created_at DESC);
CREATE INDEX purchase_attribution_product ON public.purchase_attribution(product_id);
CREATE INDEX purchase_attribution_user ON public.purchase_attribution(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX purchase_attribution_member ON public.purchase_attribution(affiliate_member_id) WHERE affiliate_member_id IS NOT NULL;
CREATE INDEX purchase_attribution_click_expiry ON public.purchase_attribution(click_id_expires_at) WHERE click_id IS NOT NULL;
ALTER TABLE public.purchase_attribution ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.purchase_attribution FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admin read" ON public.purchase_attribution FOR SELECT TO authenticated USING ((select public.is_admin()));
REVOKE ALL ON public.purchase_attribution FROM anon, authenticated;
GRANT SELECT ON public.purchase_attribution TO authenticated;
GRANT ALL ON public.purchase_attribution TO service_role;

-- The snapshot never changes; only the retention job may erase a click id.
CREATE FUNCTION public.purchase_attribution_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Allowed: erasing the click id (retention) and FK ON DELETE SET NULL (deleted account/product/partner).
  IF (to_jsonb(NEW) - ARRAY['click_id','click_id_expires_at','user_id','product_id','affiliate_member_id'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['click_id','click_id_expires_at','user_id','product_id','affiliate_member_id'])
     OR (NEW.click_id IS NOT NULL AND NEW.click_id IS DISTINCT FROM OLD.click_id)
     OR (NEW.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id)
     OR (NEW.product_id IS NOT NULL AND NEW.product_id IS DISTINCT FROM OLD.product_id)
     OR (NEW.affiliate_member_id IS NOT NULL AND NEW.affiliate_member_id IS DISTINCT FROM OLD.affiliate_member_id) THEN
    RAISE EXCEPTION 'purchase attribution is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_attribution_immutable BEFORE UPDATE ON public.purchase_attribution
  FOR EACH ROW EXECUTE FUNCTION public.purchase_attribution_immutable();

-- ===== CLASSIFICATION =====
CREATE FUNCTION public.classify_attribution_channel(
  p_source text, p_medium text, p_campaign text, p_referrer_host text, p_click_type text
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.attribution_channel_rules%ROWTYPE;
  v text;
  items text[];
BEGIN
  FOR r IN SELECT * FROM public.attribution_channel_rules WHERE is_active ORDER BY priority, created_at, id LOOP
    v := lower(CASE r.field WHEN 'source' THEN p_source WHEN 'medium' THEN p_medium WHEN 'campaign' THEN p_campaign
      WHEN 'referrer_host' THEN p_referrer_host WHEN 'click_id_type' THEN p_click_type END);
    CONTINUE WHEN v IS NULL;
    IF r.operator = 'exists' THEN RETURN r.channel; END IF;
    items := ARRAY(SELECT btrim(t) FROM unnest(string_to_array(lower(r.value), ',')) t WHERE btrim(t) <> '');
    IF (r.operator = 'equals' AND v = lower(btrim(r.value)))
       OR (r.operator = 'in' AND v = ANY(items))
       OR (r.operator = 'contains' AND EXISTS (SELECT 1 FROM unnest(items) t WHERE strpos(v, t) > 0))
       OR (r.operator = 'host_in' AND EXISTS (SELECT 1 FROM unnest(items) t WHERE v = t OR right(v, length(t) + 1) = '.' || t)) THEN
      RETURN r.channel;
    END IF;
  END LOOP;
  RETURN CASE WHEN coalesce(p_source, p_medium, p_campaign) IS NOT NULL THEN 'other' ELSE 'direct' END;
END $$;
REVOKE ALL ON FUNCTION public.classify_attribution_channel(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classify_attribution_channel(text,text,text,text,text) TO service_role;

CREATE FUNCTION public.attribution_text(p jsonb, k text, max_len integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(p) = 'object' AND jsonb_typeof(p->k) = 'string'
    THEN left(nullif(btrim(regexp_replace(p->>k, '[[:cntrl:]]', '', 'g')), ''), max_len) END
$$;
CREATE FUNCTION public.attribution_time(p jsonb, k text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  RETURN CASE WHEN jsonb_typeof(p) = 'object' AND jsonb_typeof(p->k) = 'string' THEN (p->>k)::timestamptz END;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.attribution_text(jsonb,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attribution_time(jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attribution_text(jsonb,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.attribution_time(jsonb,text) TO service_role;

CREATE FUNCTION public.insert_purchase_attribution(
  p_tx uuid, p_product uuid, p_user uuid, p_kind text, p_payload jsonb, p_coupon uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l jsonb := CASE WHEN jsonb_typeof(p_payload->'last') = 'object' THEN p_payload->'last' END;
  f jsonb := CASE WHEN jsonb_typeof(p_payload->'first') = 'object' THEN p_payload->'first' END;
  c jsonb := CASE WHEN jsonb_typeof(p_payload->'click') = 'object' THEN p_payload->'click' END;
  consent text := CASE WHEN p_payload->>'consent' IN ('analytics','marketing') THEN p_payload->>'consent' ELSE 'none' END;
  click_type text := public.attribution_text(c, 'type', 20);
  click_value text := CASE WHEN consent = 'marketing' THEN public.attribution_text(c, 'value', 255) END;
  ch text;
  fch text;
  member uuid;
  retention integer;
  sessions integer;
BEGIN
  IF click_type IS NOT NULL AND click_type !~ '^[a-z_]{2,20}$' THEN click_type := NULL; END IF;
  IF consent <> 'marketing' THEN click_type := NULL; END IF;
  IF p_payload IS NULL THEN
    ch := 'unknown';
  ELSE
    ch := public.classify_attribution_channel(lower(public.attribution_text(l,'source',200)), lower(public.attribution_text(l,'medium',200)),
      public.attribution_text(l,'campaign',200), lower(public.attribution_text(l,'referrer_host',253)), click_type);
    IF f IS NOT NULL THEN
      fch := public.classify_attribution_channel(lower(public.attribution_text(f,'source',200)), lower(public.attribution_text(f,'medium',200)),
        public.attribution_text(f,'campaign',200), lower(public.attribution_text(f,'referrer_host',253)), NULL);
    END IF;
  END IF;
  IF p_coupon IS NOT NULL THEN
    SELECT b.member_id INTO member FROM public.affiliate_coupon_bindings b WHERE b.coupon_id = p_coupon AND b.retired_at IS NULL;
    IF member IS NOT NULL THEN ch := 'affiliate'; END IF;
  END IF;
  SELECT s.click_id_retention_days INTO retention FROM public.attribution_settings s WHERE s.id = 1;
  sessions := CASE WHEN jsonb_typeof(p_payload->'sessions_count') = 'number'
    AND (p_payload->>'sessions_count') ~ '^[0-9]{1,5}$' AND (p_payload->>'sessions_count')::integer BETWEEN 1 AND 10000
    THEN (p_payload->>'sessions_count')::integer END;
  INSERT INTO public.purchase_attribution(
    transaction_id, product_id, user_id, kind, channel, first_channel, affiliate_member_id, mode, consent,
    last_source, last_medium, last_campaign, last_content, last_term, last_utm_id, last_referrer_host, last_landing_path, last_at,
    first_source, first_medium, first_campaign, first_content, first_term, first_utm_id, first_referrer_host, first_landing_path, first_at,
    sessions_count, first_seen_at, click_id_type, click_id, click_id_expires_at, device_class, country
  ) VALUES (
    p_tx, p_product, p_user, p_kind, ch, fch, member,
    CASE WHEN p_payload->>'mode' IN ('url','stored') THEN p_payload->>'mode' ELSE 'none' END, consent,
    lower(public.attribution_text(l,'source',200)), lower(public.attribution_text(l,'medium',200)), public.attribution_text(l,'campaign',200),
    public.attribution_text(l,'content',200), public.attribution_text(l,'term',200), public.attribution_text(l,'id',200),
    lower(public.attribution_text(l,'referrer_host',253)), public.attribution_text(l,'landing_path',300), public.attribution_time(l,'at'),
    lower(public.attribution_text(f,'source',200)), lower(public.attribution_text(f,'medium',200)), public.attribution_text(f,'campaign',200),
    public.attribution_text(f,'content',200), public.attribution_text(f,'term',200), public.attribution_text(f,'id',200),
    lower(public.attribution_text(f,'referrer_host',253)), public.attribution_text(f,'landing_path',300), public.attribution_time(f,'at'),
    sessions, public.attribution_time(p_payload,'first_seen_at'),
    click_type, click_value, CASE WHEN click_value IS NOT NULL THEN now() + make_interval(days => coalesce(retention, 30)) END,
    CASE WHEN p_payload->>'device_class' IN ('desktop','mobile','tablet','bot') THEN p_payload->>'device_class' ELSE 'unknown' END,
    CASE WHEN p_payload->>'country' ~ '^[A-Z]{2}$' THEN p_payload->>'country' END
  ) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.insert_purchase_attribution(uuid,uuid,uuid,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_purchase_attribution(uuid,uuid,uuid,text,jsonb,uuid) TO service_role;

-- ===== SELLER CONFIGURATION (admin) =====
-- Retention of click ids + own channel rules (replaced as a whole). Default rules stay; they can
-- only be switched on/off, so the seller can always return to the defaults.
CREATE FUNCTION public.save_attribution_config(p_retention_days integer, p_rules jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; n integer := 0;
BEGIN
  IF NOT ((select auth.role()) = 'service_role' OR (select public.is_admin())) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_retention_days IS NULL OR p_retention_days NOT BETWEEN 1 AND 365 OR jsonb_typeof(p_rules) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_rules) > 200 THEN
    RAISE EXCEPTION 'Invalid attribution config' USING ERRCODE = '22023';
  END IF;
  UPDATE public.attribution_settings SET click_id_retention_days = p_retention_days, updated_at = now() WHERE id = 1;
  DELETE FROM public.attribution_channel_rules WHERE NOT is_default;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rules) LOOP
    IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid rule' USING ERRCODE = '22023'; END IF;
    IF r ? 'id' AND EXISTS (SELECT 1 FROM public.attribution_channel_rules WHERE id::text = r->>'id' AND is_default) THEN
      UPDATE public.attribution_channel_rules SET is_active = coalesce((r->>'is_active')::boolean, true) WHERE id::text = r->>'id';
    ELSE
      INSERT INTO public.attribution_channel_rules(priority, channel, field, operator, value, is_active)
      VALUES ((r->>'priority')::integer, lower(r->>'channel'), r->>'field', r->>'operator', nullif(btrim(r->>'value'), ''),
        coalesce((r->>'is_active')::boolean, true));
      n := n + 1;
    END IF;
  END LOOP;
  PERFORM public.log_admin_action('save_attribution_config', 'attribution_settings', '1',
    jsonb_build_object('click_id_retention_days', p_retention_days, 'custom_rules', n));
  RETURN jsonb_build_object('success', true, 'custom_rules', n);
END $$;
REVOKE ALL ON FUNCTION public.save_attribution_config(integer,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_attribution_config(integer,jsonb) TO authenticated, service_role;

-- ===== WRITE ENTRY POINTS (service role) =====
CREATE FUNCTION public.store_checkout_attribution(p_ref text, p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_ref IS NULL OR length(p_ref) NOT BETWEEN 1 AND 255 OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR octet_length(p_payload::text) > 16384 THEN
    RAISE EXCEPTION 'Invalid attribution payload' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.checkout_attribution(ref, payload) VALUES (p_ref, p_payload)
    ON CONFLICT (ref) DO UPDATE SET payload = EXCLUDED.payload, created_at = now();
END $$;
REVOKE ALL ON FUNCTION public.store_checkout_attribution(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_checkout_attribution(text,jsonb) TO service_role;

CREATE FUNCTION public.record_free_attribution(p_product uuid, p_user uuid, p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_product IS NULL OR p_user IS NULL OR (p_payload IS NOT NULL AND (jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::text) > 16384)) THEN
    RAISE EXCEPTION 'Invalid attribution payload' USING ERRCODE = '22023';
  END IF;
  PERFORM public.insert_purchase_attribution(NULL, p_product, p_user, 'free', p_payload, NULL);
END $$;
REVOKE ALL ON FUNCTION public.record_free_attribution(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_free_attribution(uuid,uuid,jsonb) TO service_role;

-- Guest free signup: the magic link stored the payload under a reference; the grant claims it.
-- Without a pending payload the grant is still recorded (channel unknown).
CREATE FUNCTION public.record_free_attribution_from_ref(p_product uuid, p_user uuid, p_ref text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE payload jsonb;
BEGIN
  IF p_product IS NULL OR p_user IS NULL OR p_ref IS NULL OR length(p_ref) > 255 THEN
    RAISE EXCEPTION 'Invalid attribution reference' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.checkout_attribution WHERE ref = p_ref RETURNING checkout_attribution.payload INTO payload;
  PERFORM public.insert_purchase_attribution(NULL, p_product, p_user, 'free', payload, NULL);
END $$;
REVOKE ALL ON FUNCTION public.record_free_attribution_from_ref(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_free_attribution_from_ref(uuid,uuid,text) TO service_role;

-- ===== SNAPSHOT TRIGGER =====
CREATE FUNCTION public.snapshot_purchase_attribution() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  payload jsonb;
  prior public.purchase_attribution%ROWTYPE;
  sub_stripe text;
  sub_ref text;
  coupon uuid;
BEGIN
  IF NEW.status NOT IN ('completed','awaiting_payment','partially_refunded','refunded','disputed') THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_attribution WHERE transaction_id = NEW.id) THEN RETURN NULL; END IF;
  BEGIN
    IF NEW.subscription_id IS NOT NULL THEN
      SELECT pa.* INTO prior FROM public.purchase_attribution pa
        JOIN public.payment_transactions pt ON pt.id = pa.transaction_id
        WHERE pt.subscription_id = NEW.subscription_id AND pt.id <> NEW.id ORDER BY pa.created_at LIMIT 1;
      IF prior.id IS NOT NULL THEN
        INSERT INTO public.purchase_attribution
          SELECT (jsonb_populate_record(NULL::public.purchase_attribution, to_jsonb(prior) || jsonb_build_object(
            'id', gen_random_uuid(), 'transaction_id', NEW.id, 'kind', 'renewal',
            'click_id', NULL, 'click_id_expires_at', NULL, 'created_at', now()))).*
          ON CONFLICT DO NOTHING;
        RETURN NULL;
      END IF;
      SELECT s.stripe_subscription_id, s.metadata->>'sf_attr_ref' INTO sub_stripe, sub_ref
        FROM public.subscriptions s WHERE s.id = NEW.subscription_id;
    END IF;
    SELECT ca.payload INTO payload FROM public.checkout_attribution ca
      WHERE ca.ref IN (NEW.session_id, NEW.stripe_payment_intent_id, NEW.id::text, NEW.metadata->>'sf_attr_ref', sub_stripe, sub_ref)
      ORDER BY ca.created_at DESC LIMIT 1;
    coupon := CASE WHEN to_jsonb(NEW)->>'coupon_id' IS NOT NULL THEN (to_jsonb(NEW)->>'coupon_id')::uuid END;
    IF coupon IS NULL AND NEW.metadata->>'coupon_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      coupon := (NEW.metadata->>'coupon_id')::uuid;
    END IF;
    PERFORM public.insert_purchase_attribution(NEW.id, NEW.product_id, NEW.user_id,
      CASE WHEN NEW.subscription_id IS NOT NULL THEN 'subscription'
           WHEN NEW.payment_provider = 'bank_transfer' THEN 'bank_transfer' ELSE 'payment' END,
      payload, coupon);
  EXCEPTION WHEN OTHERS THEN
    -- Attribution must never break a payment.
    RAISE WARNING 'purchase attribution snapshot skipped for %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_purchase_attribution() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER snapshot_purchase_attribution AFTER INSERT OR UPDATE OF status ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_purchase_attribution();

-- ===== RETENTION =====
CREATE FUNCTION public.purge_attribution_click_ids() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  UPDATE public.purchase_attribution SET click_id = NULL, click_id_expires_at = NULL
    WHERE click_id IS NOT NULL AND click_id_expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.checkout_attribution WHERE created_at < now() - interval '7 days';
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.purge_attribution_click_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_attribution_click_ids() TO service_role;
SELECT cron.schedule('purchase-attribution-retention', '23 * * * *', $$SELECT public.purge_attribution_click_ids()$$);