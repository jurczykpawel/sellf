-- Sellf 2026.11.1
-- Requires the updater shipped with 2026.11.0 or later.
-- Sections retain dependency order; later function definitions take precedence.

-- ===== Checkout details =====
-- ===== Source: 20261111000000_checkout_details_reconciliation.sql =====
-- Preserve completion while recording missing required checkout modules.
-- @see admin-panel/src/lib/checkout-modules/registry.ts
CREATE OR REPLACE FUNCTION public.mark_checkout_details_missing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  profile jsonb;
  module jsonb;
  details jsonb := coalesce(NEW.order_details, '{}'::jsonb);
  missing boolean := false;
  missing_modules jsonb := '[]'::jsonb;
BEGIN
  SELECT checkout_profile INTO profile FROM public.products WHERE id = NEW.product_id;
  IF profile IS NULL THEN
    IF NEW.order_details ? 'details_missing' OR NEW.order_details ? 'missing_modules' THEN
      NEW.order_details := NEW.order_details - 'details_missing' - 'missing_modules';
    END IF;
    RETURN NEW;
  END IF;
  FOR module IN SELECT value FROM jsonb_array_elements(profile->'modules') LOOP
    missing := false;
    CASE module->>'id'
      WHEN 'buyer' THEN
        missing := missing OR coalesce(jsonb_typeof(details->'buyer') <> 'object'
          OR details->'buyer'->>'type' NOT IN ('person', 'organization'), true);
      WHEN 'recipient' THEN
        IF details->'buyer'->>'type' = 'organization' THEN
          missing := missing OR coalesce(jsonb_typeof(details->'recipient'->'differs') <> 'boolean', true);
        END IF;
      WHEN 'quantity' THEN
        missing := missing OR coalesce(jsonb_typeof(details->'quantity'->'value') <> 'number', true);
      WHEN 'phone' THEN
        IF (module->>'required')::boolean THEN
          missing := missing OR coalesce(length(details->'phone'->>'value'), 0) = 0;
        END IF;
      WHEN 'participants' THEN
        IF (module->>'required')::boolean THEN
          missing := missing OR coalesce(jsonb_typeof(details->'participants'->'people') <> 'array', true);
          IF jsonb_typeof(details->'participants'->'people') = 'array' THEN
            missing := missing OR jsonb_array_length(details->'participants'->'people') = 0;
          END IF;
        END IF;
      ELSE NULL;
    END CASE;
    IF missing THEN missing_modules := missing_modules || jsonb_build_array(module->>'id'); END IF;
  END LOOP;
  NEW.order_details := details - 'details_missing' - 'missing_modules';
  IF jsonb_array_length(missing_modules) > 0 THEN
    NEW.order_details := NEW.order_details || jsonb_build_object('details_missing', true, 'missing_modules', missing_modules);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_checkout_details_missing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_checkout_details_missing() TO service_role;
DROP TRIGGER checkout_details_on_completion ON public.payment_transactions;
CREATE TRIGGER checkout_details_on_completion
  BEFORE INSERT OR UPDATE OF status, order_details ON public.payment_transactions
  FOR EACH ROW WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.mark_checkout_details_missing();

-- Reconcile already completed orders, including participant lists saved before this release.
UPDATE public.payment_transactions t SET order_details = coalesce(t.order_details, '{}'::jsonb)
WHERE t.status = 'completed' AND (t.order_details->'details_missing' = 'true'::jsonb
  OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = t.product_id AND p.checkout_profile IS NOT NULL));

-- Release 11.1: custom field values and the MERGED order details are saved in ONE transaction.
-- The pending row is locked and the merged JSON (order_details || p_details) is measured before the
-- write; an over-limit result raises details_too_large (54000) and saves nothing, custom fields included.
-- p_custom_field_values NULL keeps the stored values. The trailing parameter has a default, so the
-- five-argument named call keeps working.
-- @see admin-panel/src/app/api/update-payment-metadata/route.ts
DROP FUNCTION public.set_payment_order_details(jsonb, uuid, integer, text, text);
CREATE FUNCTION public.set_payment_order_details(
  p_details jsonb, p_product_id uuid, p_quantity integer,
  p_session_id text DEFAULT NULL, p_payment_intent_id text DEFAULT NULL,
  p_custom_field_values jsonb DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions; v_quantity integer; v_merged jsonb;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object'
     OR p_product_id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 100
     OR (p_session_id IS NULL) = (p_payment_intent_id IS NULL)
     OR (p_custom_field_values IS NOT NULL AND jsonb_typeof(p_custom_field_values) <> 'object') THEN
    RAISE EXCEPTION 'Invalid order details' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO tx FROM public.payment_transactions
    WHERE (session_id = p_session_id OR stripe_payment_intent_id = p_payment_intent_id)
      AND product_id = p_product_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT quantity INTO v_quantity FROM public.payment_line_items
    WHERE transaction_id = tx.id AND product_id = p_product_id AND item_type = 'main_product';
  IF v_quantity IS DISTINCT FROM p_quantity THEN RETURN -1; END IF;
  v_merged := coalesce(tx.order_details, '{}'::jsonb) || p_details;
  -- Same measure as the payment_transactions_order_details_check constraint.
  IF octet_length(v_merged::text) > 65536 THEN
    RAISE EXCEPTION 'details_too_large' USING ERRCODE = '54000';
  END IF;
  UPDATE public.payment_transactions
  SET order_details = v_merged,
      custom_field_values = coalesce(p_custom_field_values, custom_field_values),
      updated_at = now()
  WHERE id = tx.id;
  RETURN 1;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_payment_order_details(jsonb, uuid, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_payment_order_details(jsonb, uuid, integer, text, text, jsonb) TO service_role;

-- ===== Invoices =====
-- ===== Source: 20261111010000_manual_invoice_correction.sql =====
ALTER TABLE public.invoices DROP CONSTRAINT invoices_provider_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_provider_check
  CHECK (provider = 'fakturownia' OR (provider = 'manual' AND status = 'corrected'));

CREATE FUNCTION public.record_invoice_correction(p_transaction uuid, p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; existing public.invoices%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id=p_actor) THEN
    RETURN false;
  END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_transaction FOR UPDATE;
  IF NOT FOUND OR tx.status NOT IN ('cancelled','refunded') THEN RETURN false; END IF;
  SELECT * INTO existing FROM public.invoices WHERE transaction_id=p_transaction FOR UPDATE;
  IF FOUND THEN
    IF existing.status='corrected' THEN RETURN true; END IF;
    IF existing.status<>'issued' THEN RETURN false; END IF;
    UPDATE public.invoices SET status='corrected',updated_at=now() WHERE id=existing.id;
  ELSE
    IF tx.invoice_hold_at IS NULL THEN RETURN false; END IF;
    INSERT INTO public.invoices(transaction_id,provider,status,external_key,provider_domain)
      VALUES(p_transaction,'manual','corrected','manual:'||p_transaction::text,'');
  END IF;
  INSERT INTO public.audit_log(table_name,operation,performed_by,new_values)
    VALUES('invoices','UPDATE',p_actor,jsonb_build_object('transaction_id',p_transaction,'action','corrected'));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_invoice_correction(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_correction(uuid,uuid) TO service_role;

-- ===== Invoice settings + their audit entry in ONE transaction =====
-- Used by actions/invoicing.ts: the settings and their audit entry commit together or not at all.
-- p_token is the already encrypted token (app-side APP_ENCRYPTION_KEY); NULL
-- keeps the saved one. Validation of the values stays in the table's CHECK constraints.
CREATE FUNCTION public.save_invoicing_config(p_settings jsonb, p_token jsonb, p_performed_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_performed_by IS NULL OR jsonb_typeof(p_settings) IS DISTINCT FROM 'object'
     OR (p_token IS NOT NULL AND jsonb_typeof(p_token) <> 'object') THEN
    RAISE EXCEPTION 'Invalid invoice settings' USING ERRCODE='22023';
  END IF;
  UPDATE public.invoicing_config SET
    provider = p_settings->>'provider', domain = p_settings->>'domain', mode = p_settings->>'mode',
    exemption = p_settings->>'exemption', template = p_settings->>'template',
    token = CASE WHEN p_token IS NULL THEN token ELSE p_token END
  WHERE id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice settings unavailable' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.audit_log(table_name, operation, performed_by, new_values)
    VALUES('invoicing_config', 'UPDATE', p_performed_by, jsonb_build_object('provider', p_settings->>'provider'));
END $$;
REVOKE ALL ON FUNCTION public.save_invoicing_config(jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_invoicing_config(jsonb, jsonb, uuid) TO service_role;

-- ===== Webhook delivery destinations =====
ALTER TABLE public.webhook_endpoints ADD COLUMN url_changed_at timestamptz;
ALTER TABLE public.webhook_logs ALTER COLUMN created_at SET DEFAULT clock_timestamp();

CREATE FUNCTION public.stamp_webhook_url() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.url_changed_at := clock_timestamp();
  ELSIF NEW.url IS DISTINCT FROM OLD.url THEN NEW.url_changed_at := clock_timestamp();
  ELSE NEW.url_changed_at := OLD.url_changed_at;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stamp_webhook_url() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER stamp_webhook_url BEFORE INSERT OR UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.stamp_webhook_url();

CREATE FUNCTION public.close_previous_webhook_deliveries() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.webhook_logs SET status = 'permanently_failed', next_retry_at = NULL,
    failed_permanently_at = clock_timestamp(), error_message = 'Endpoint URL changed'
  WHERE endpoint_id = NEW.id AND created_at < NEW.url_changed_at AND status = 'pending_retry';
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.close_previous_webhook_deliveries() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER close_previous_webhook_deliveries AFTER UPDATE OF url ON public.webhook_endpoints
  FOR EACH ROW WHEN (NEW.url IS DISTINCT FROM OLD.url)
  EXECUTE FUNCTION public.close_previous_webhook_deliveries();

CREATE FUNCTION public.check_webhook_delivery_date() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed timestamptz; source_created timestamptz;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.delivery_key ~ ':business_[0-9a-f-]{36}$' THEN
    SELECT created_at INTO source_created FROM public.business_events
      WHERE id = substring(NEW.delivery_key from ':business_([0-9a-f-]{36})$')::uuid;
    NEW.created_at := least(NEW.created_at, source_created);
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.endpoint_id := OLD.endpoint_id;
  END IF;
  SELECT url_changed_at INTO changed FROM public.webhook_endpoints WHERE id = NEW.endpoint_id;
  IF NEW.created_at < changed THEN
    IF TG_OP = 'UPDATE' AND NEW.status = 'pending_retry' AND OLD.status <> 'pending_retry' THEN
      RAISE EXCEPTION 'Endpoint URL changed' USING ERRCODE = 'PT409';
    END IF;
    IF NEW.status = 'pending_retry' THEN
      NEW.status := 'permanently_failed';
      NEW.next_retry_at := NULL;
      NEW.failed_permanently_at := clock_timestamp();
      NEW.error_message := 'Endpoint URL changed';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_webhook_delivery_date() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER check_webhook_delivery_date BEFORE INSERT OR UPDATE ON public.webhook_logs
  FOR EACH ROW EXECUTE FUNCTION public.check_webhook_delivery_date();

CREATE FUNCTION public.webhook_delivery_target(p_id uuid)
RETURNS SETOF public.webhook_endpoints
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.* FROM public.webhook_endpoints e JOIN public.webhook_logs l ON l.endpoint_id = e.id
  WHERE l.id = p_id AND l.status = 'pending_retry'
    AND (e.url_changed_at IS NULL OR l.created_at >= e.url_changed_at);
$$;
REVOKE ALL ON FUNCTION public.webhook_delivery_target(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_delivery_target(uuid) TO service_role;

CREATE FUNCTION public.check_webhook_delivery_target(p_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.webhook_logs l JOIN public.webhook_endpoints e ON e.id=l.endpoint_id
    WHERE l.id=p_id AND l.created_at < e.url_changed_at) THEN
    RAISE EXCEPTION 'Endpoint URL changed' USING ERRCODE = 'PT409';
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.check_webhook_delivery_target(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_webhook_delivery_target(uuid) TO service_role;

-- ===== Product events =====
-- ===== Source: 20261111100000_product_lifecycle_webhooks.sql =====
-- Public catalogue lifecycle snapshots share the committed business-event outbox.
ALTER TABLE public.products ADD COLUMN webhook_revision bigint NOT NULL DEFAULT 0 CHECK (webhook_revision >= 0);

DO $$
DECLARE def text; added text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
    WHERE conname='business_events_event_type_check' AND conrelid='public.business_events'::regclass;
  IF def IS NULL OR def NOT LIKE '%])))' THEN RAISE EXCEPTION 'Unexpected business_events constraint'; END IF;
  SELECT string_agg(format(', %L::text', t),'') INTO added FROM unnest(ARRAY[
    'product.created','product.updated','product.deleted']) t WHERE position(quote_literal(t) IN def)=0;
  IF added IS NOT NULL THEN
    ALTER TABLE public.business_events DROP CONSTRAINT business_events_event_type_check;
    EXECUTE 'ALTER TABLE public.business_events ADD CONSTRAINT business_events_event_type_check '
      ||left(def,length(def)-4)||added||'])))';
  END IF;
END $$;

CREATE FUNCTION public.product_catalogue_snapshot(p public.products) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.product_price_snapshot(p)||jsonb_build_object(
    'id',p.id,'name',p.name,'slug',p.slug,'description',p.description,'longDescription',p.long_description,
    'icon',p.icon,'imageUrl',p.image_url,'thumbnailUrl',p.thumbnail_url,'previewVideoUrl',p.preview_video_url,
    'features',p.features,'marketingFields',p.marketing_fields,
    'productType',p.product_type,'isBundle',p.is_bundle,'eventMode',p.event_mode,
    'isActive',p.is_active,'isListed',p.is_listed,'isFeatured',p.is_featured,
    'availableFrom',p.available_from,'availableUntil',p.available_until,
    'allowCustomPrice',p.allow_custom_price,'customPriceMin',round(p.custom_price_min*public.currency_minor_factor(p.currency))::bigint,
    'billingInterval',p.billing_interval,'billingIntervalCount',p.billing_interval_count,'trialDays',p.trial_days,
    'priceIncludesVat',p.price_includes_vat,'vatRate',p.vat_rate,'vatExempt',p.vat_exempt,
    'isRefundable',p.is_refundable,'refundPeriodDays',p.refund_period_days,
    'autoGrantDurationDays',p.auto_grant_duration_days,'allowRepeatPurchase',p.allow_repeat_purchase,
    'enableWaitlist',p.enable_waitlist,'saleQuantityLimit',p.sale_quantity_limit,
    'issueLicenseOnPurchase',p.issue_license_on_purchase,'licenseDurationDays',p.license_duration_days);
$$;
REVOKE ALL ON FUNCTION public.product_catalogue_snapshot(public.products) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.set_product_webhook_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' THEN NEW.webhook_revision:=1;
  ELSE NEW.webhook_revision:=OLD.webhook_revision+CASE WHEN
    public.product_catalogue_snapshot(NEW) IS DISTINCT FROM public.product_catalogue_snapshot(OLD) THEN 1 ELSE 0 END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.set_product_webhook_revision() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER product_webhook_revision BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_product_webhook_revision();

CREATE FUNCTION public.capture_product_lifecycle_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.products:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  snapshot jsonb:=public.product_catalogue_snapshot(p);
  previous jsonb; changed jsonb:='[]'; event text:='product.'||CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END;
  revision bigint:=p.webhook_revision+CASE WHEN TG_OP='DELETE' THEN 1 ELSE 0 END;
  event_id uuid:=gen_random_uuid(); routing jsonb:='{}';
BEGIN
  IF TG_OP='UPDATE' THEN
    previous:=public.product_catalogue_snapshot(OLD);
    SELECT coalesce(jsonb_agg(key ORDER BY key),'[]') INTO changed
      FROM jsonb_each(snapshot) WHERE value IS DISTINCT FROM previous->key;
    IF changed='[]'::jsonb THEN RETURN NEW; END IF;
  END IF;
  -- Product links are removed by the delete cascade; retain their routing for the outbox worker.
  SELECT jsonb_build_object('_selectedEndpointIds',coalesce(jsonb_agg(webhook_endpoint_id),'[]')) INTO routing
    FROM public.webhook_endpoint_products WHERE product_id=p.id;
  INSERT INTO public.business_events(id,event_type,product_id,payload,deduplication_key)
    VALUES(event_id,event,p.id,routing||jsonb_build_object('schemaVersion',1,'eventId',event_id,'revision',revision,
      'operation',lower(TG_OP),'amountUnit','minor','product',snapshot,'changedFields',changed,
      'actor',public.business_event_actor(),'occurredAt',clock_timestamp()),event||':'||p.id||':'||revision)
    ON CONFLICT(deduplication_key) DO NOTHING;
  RETURN p;
END $$;
REVOKE ALL ON FUNCTION public.capture_product_lifecycle_event() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER product_lifecycle_event AFTER INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.capture_product_lifecycle_event();
CREATE TRIGGER product_delete_lifecycle_event BEFORE DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.capture_product_lifecycle_event();

-- ===== Access and licenses =====
-- ===== Source: 20261111110000_access_licenses.sql =====
-- Licenses issued by an individual manual access grant.
ALTER TABLE public.user_product_access ADD COLUMN license_requested boolean NOT NULL DEFAULT false;
ALTER TABLE public.issued_licenses
  ADD COLUMN access_grant_id uuid UNIQUE;

CREATE FUNCTION public.bind_access_license() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE a public.user_product_access;
BEGIN
  IF NEW.access_grant_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO a FROM public.user_product_access WHERE id = NEW.access_grant_id FOR UPDATE;
  IF NOT FOUND OR NOT a.license_requested OR a.user_id IS DISTINCT FROM NEW.user_id
    OR a.product_id IS DISTINCT FROM NEW.product_id OR NEW.order_id <> 'access_' || a.id::text THEN
    RAISE EXCEPTION 'Access grant is not available for license issuance';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bind_access_license() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER bind_access_license BEFORE INSERT ON public.issued_licenses
FOR EACH ROW EXECUTE FUNCTION public.bind_access_license();

CREATE OR REPLACE FUNCTION public.mutate_access(p_action text, p_user_id uuid, p_product_id uuid DEFAULT NULL, p_access_id uuid DEFAULT NULL, p_values jsonb DEFAULT '{}', p_actor jsonb DEFAULT '{}')
RETURNS SETOF public.user_product_access LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE previous text := current_setting('sellf.grant_source', true); a public.user_product_access;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  PERFORM set_config('sellf.grant_source', 'manual', true);
  IF p_action = 'revoke' THEN
    FOR a IN SELECT * FROM public.user_product_access WHERE user_id = p_user_id
      AND (id = p_access_id OR (p_access_id IS NULL AND product_id = p_product_id)) FOR UPDATE LOOP
      IF coalesce((p_values->>'revoke_license')::boolean, false) THEN
        PERFORM public.revoke_order_licenses(a.product_id, ARRAY['access_' || a.id::text], 'manual');
      END IF;
    END LOOP;
  END IF;
  FOR a IN SELECT * FROM public.mutate_access_impl(p_action, p_user_id, p_product_id, p_access_id, p_values, p_actor) LOOP
    IF p_action = 'grant' AND coalesce((p_values->>'issue_license')::boolean, false) THEN
      UPDATE public.user_product_access SET license_requested = true WHERE id = a.id RETURNING * INTO a;
    END IF;
    RETURN NEXT a;
  END LOOP;
  PERFORM set_config('sellf.grant_source', coalesce(previous, ''), true);
END $$;
REVOKE ALL ON FUNCTION public.mutate_access(text,uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_access(text,uuid,uuid,uuid,jsonb,jsonb) TO service_role;

-- ===== License issued by the seller + its audit entry in ONE transaction =====
-- Manual and API v1 issuance (src/lib/license-keys/request.ts). The issued_licenses insert fires
-- capture_license_issued_event, which queues license.issued. The license row, the event (trigger, same statement)
-- and the audit_log row commit together; when the audit insert fails, none of them exists.
-- 23505 (same order_id + product_id) propagates unchanged so the caller can return the winner.
CREATE FUNCTION public.issue_license_with_audit(p_license jsonb, p_performed_by uuid, p_audit_values jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.issued_licenses; v public.issued_licenses;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_performed_by IS NULL OR jsonb_typeof(p_license) IS DISTINCT FROM 'object'
     OR (p_audit_values IS NOT NULL AND jsonb_typeof(p_audit_values) <> 'object') THEN
    RAISE EXCEPTION 'Invalid license issuance' USING ERRCODE='22023';
  END IF;
  r := jsonb_populate_record(NULL::public.issued_licenses, p_license);
  INSERT INTO public.issued_licenses(id, seller_id, original_seller_id, product_id, email, user_id, order_id, access_grant_id,
      customer_locale, kid, license_key, expires_at, issuance_source, license_domain)
    VALUES(coalesce(r.id, gen_random_uuid()), r.seller_id, r.original_seller_id, r.product_id, r.email, r.user_id, r.order_id,
      r.access_grant_id, r.customer_locale, r.kid, r.license_key, r.expires_at, coalesce(r.issuance_source, 'purchase'), r.license_domain)
    RETURNING * INTO v;
  INSERT INTO public.audit_log(table_name, operation, performed_by, new_values)
    VALUES('issued_licenses', 'INSERT', p_performed_by, coalesce(p_audit_values, '{}'::jsonb)
      || CASE WHEN v.access_grant_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('access_grant_id', v.access_grant_id) END
      || jsonb_build_object('license_id', v.id, 'product_id', v.product_id, 'email', v.email, 'domain', v.license_domain, 'kid', v.kid));
  RETURN v.id;
END $$;
REVOKE ALL ON FUNCTION public.issue_license_with_audit(jsonb, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_license_with_audit(jsonb, uuid, jsonb) TO service_role;

-- ===== Admin access grant/update/revoke + its audit entry in ONE transaction =====
-- Used by api/users/[id]/access: the change and its audit entry commit together or not at all.
-- The entry is written only when a row actually changed; performed_by references auth.users, so the
-- actor must be a user (the admin's auth UUID). p_audit is stored as new_values (grant/update) or
-- old_values (revoke), as before.
CREATE FUNCTION public.mutate_access_audited(p_action text, p_user_id uuid, p_product_id uuid DEFAULT NULL, p_access_id uuid DEFAULT NULL,
  p_values jsonb DEFAULT '{}', p_actor jsonb DEFAULT '{}', p_audit jsonb DEFAULT '{}')
RETURNS SETOF public.user_product_access LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE a public.user_product_access; changed integer := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_actor->>'type' IS DISTINCT FROM 'user' OR p_actor->>'id' IS NULL
     OR (p_audit IS NOT NULL AND jsonb_typeof(p_audit) <> 'object') THEN
    RAISE EXCEPTION 'Audited access change needs a user actor' USING ERRCODE='22023';
  END IF;
  FOR a IN SELECT * FROM public.mutate_access(p_action, p_user_id, p_product_id, p_access_id, p_values, p_actor) LOOP
    changed := changed + 1;
    RETURN NEXT a;
  END LOOP;
  IF changed > 0 THEN
    INSERT INTO public.audit_log(table_name, operation, user_id, performed_by, old_values, new_values)
      VALUES('user_product_access',
        CASE p_action WHEN 'grant' THEN 'INSERT' WHEN 'revoke' THEN 'DELETE' ELSE 'UPDATE' END,
        p_user_id, (p_actor->>'id')::uuid,
        CASE WHEN p_action = 'revoke' THEN coalesce(p_audit, '{}'::jsonb) END,
        CASE WHEN p_action <> 'revoke' THEN coalesce(p_audit, '{}'::jsonb) END);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.mutate_access_audited(text,uuid,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_access_audited(text,uuid,uuid,uuid,jsonb,jsonb,jsonb) TO service_role;

-- ===== License signing keys: a planned key change keeps earlier keys published =====
-- Changing the signing key retires the previous one (is_active = false) instead of hiding it:
-- the public-keys reader returns the active key first, then every retired key, each with its
-- status. Licenses signed with a retired key keep verifying offline; new licenses use the
-- active key. The return type changes, so the function is dropped and created again.
DROP FUNCTION IF EXISTS public.seller_license_public_keys(UUID);
CREATE FUNCTION public.seller_license_public_keys(seller UUID)
RETURNS TABLE (kid TEXT, public_key TEXT, alg TEXT, status TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT k.kid, k.public_key, k.alg,
         CASE WHEN k.is_active THEN 'active' ELSE 'retired' END
  FROM public.seller_license_keys k
  WHERE k.original_seller_id = seller
  ORDER BY k.is_active DESC, k.created_at DESC, k.kid;
$$;
REVOKE EXECUTE ON FUNCTION public.seller_license_public_keys(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_license_public_keys(UUID) TO service_role;
COMMENT ON FUNCTION public.seller_license_public_keys(UUID) IS
  'Public keys (kid, public_key, alg, status) for a seller: the active signing key first, then retired keys that still verify licenses signed before a key change. Never exposes encrypted private-key columns.';

-- ===== License signing keys: replacing the active key is one transaction =====
-- The application encrypts the new private key first, then calls this function once. It locks the
-- seller's key set, retires the current active key and saves the new one together, so a failed save
-- leaves the current key signing and two simultaneous changes end with exactly one active key.
-- Saving a key the seller already has (same kid) makes it active again.
CREATE OR REPLACE FUNCTION public.replace_seller_license_key(
  p_seller_id UUID,
  p_kid TEXT,
  p_public_key TEXT,
  p_encrypted_key TEXT,
  p_encryption_iv TEXT,
  p_encryption_tag TEXT,
  p_custody TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_seller_id IS NULL OR coalesce(p_kid, '') = '' OR coalesce(p_public_key, '') = ''
     OR coalesce(p_encrypted_key, '') = '' OR coalesce(p_encryption_iv, '') = ''
     OR coalesce(p_encryption_tag, '') = '' THEN
    RAISE EXCEPTION 'replace_seller_license_key: missing key data' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('seller_license_keys:' || p_seller_id::text, 0));

  UPDATE public.seller_license_keys
     SET is_active = false
   WHERE seller_id = p_seller_id
     AND is_active = true
     AND kid <> p_kid;

  INSERT INTO public.seller_license_keys
    (seller_id, original_seller_id, kid, public_key, encrypted_key, encryption_iv, encryption_tag, custody, is_active)
  VALUES
    (p_seller_id, p_seller_id, p_kid, p_public_key, p_encrypted_key, p_encryption_iv, p_encryption_tag, p_custody, true)
  ON CONFLICT (seller_id, kid) DO UPDATE
    SET public_key = EXCLUDED.public_key,
        encrypted_key = EXCLUDED.encrypted_key,
        encryption_iv = EXCLUDED.encryption_iv,
        encryption_tag = EXCLUDED.encryption_tag,
        custody = EXCLUDED.custody,
        is_active = true;

  RETURN p_kid;
END $$;
REVOKE ALL ON FUNCTION public.replace_seller_license_key(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_seller_license_key(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
COMMENT ON FUNCTION public.replace_seller_license_key(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Server only: retires the seller''s active license signing key and saves the new (already encrypted) key in one transaction, serialized per seller.';

-- ===== Company lookup =====
-- ===== Source: 20261111120018_shop_company_lookup.sql =====
-- Company lookup is configured by the shop, independently of product profiles.
UPDATE public.products AS product
SET checkout_profile = jsonb_set(product.checkout_profile, '{modules}', (
  SELECT jsonb_agg(CASE WHEN module->>'id' = 'buyer' THEN module - 'gus' ELSE module END ORDER BY position)
  FROM jsonb_array_elements(product.checkout_profile->'modules') WITH ORDINALITY AS entries(module, position)
))
WHERE jsonb_typeof(product.checkout_profile->'modules') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(product.checkout_profile->'modules') AS module
    WHERE module->>'id' = 'buyer' AND module ? 'gus'
  );

-- ===== Product archive =====
-- ===== Source: 20261114100000_product_archive.sql =====
-- Product archive: "delete" of a product with sales history moves it to the archive.
-- Orders, invoices and licenses never disappear together with a product: a permanent delete
-- (allowed only from the archive) keeps them with the product name from the time of purchase.
-- @see admin-panel/src/app/api/v1/products/[id]/route.ts, admin-panel/src/app/api/v1/products/[id]/restore/route.ts

-- ===== ARCHIVE STATE =====
ALTER TABLE public.products
  ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT products_archived_not_active CHECK (archived_at IS NULL OR NOT is_active);
CREATE INDEX idx_products_archived_at ON public.products(archived_at) WHERE archived_at IS NOT NULL;

-- ===== PURCHASE-TIME PRODUCT NAME =====
ALTER TABLE public.payment_transactions ADD COLUMN product_name text;
ALTER TABLE public.issued_licenses ADD COLUMN product_name text;

CREATE FUNCTION public.snapshot_purchase_product_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.product_name IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT name INTO NEW.product_name FROM public.products WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_purchase_product_name() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER purchase_product_name BEFORE INSERT ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_purchase_product_name();
CREATE TRIGGER purchase_product_name BEFORE INSERT ON public.issued_licenses
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_purchase_product_name();

-- Existing rows: the current name is the best available copy.
UPDATE public.payment_transactions t SET product_name = p.name FROM public.products p
  WHERE p.id = t.product_id AND t.product_name IS NULL;
UPDATE public.issued_licenses l SET product_name = p.name FROM public.products p
  WHERE p.id = l.product_id AND l.product_name IS NULL;

-- ===== RECORDS KEPT WHEN A PRODUCT IS DELETED =====
ALTER TABLE public.payment_transactions ALTER COLUMN product_id DROP NOT NULL,
  DROP CONSTRAINT payment_transactions_product_id_fkey,
  ADD CONSTRAINT payment_transactions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
ALTER TABLE public.payment_line_items ALTER COLUMN product_id DROP NOT NULL,
  DROP CONSTRAINT payment_line_items_product_id_fkey,
  ADD CONSTRAINT payment_line_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
ALTER TABLE public.refund_requests ALTER COLUMN product_id DROP NOT NULL,
  DROP CONSTRAINT refund_requests_product_id_fkey,
  ADD CONSTRAINT refund_requests_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
ALTER TABLE public.issued_licenses ALTER COLUMN product_id DROP NOT NULL,
  DROP CONSTRAINT issued_licenses_product_id_fkey,
  ADD CONSTRAINT issued_licenses_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

-- ===== WEBHOOK SNAPSHOT: archive state =====
CREATE OR REPLACE FUNCTION public.product_catalogue_snapshot(p public.products) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.product_price_snapshot(p)||jsonb_build_object(
    'id',p.id,'name',p.name,'slug',p.slug,'description',p.description,'longDescription',p.long_description,
    'icon',p.icon,'imageUrl',p.image_url,'thumbnailUrl',p.thumbnail_url,'previewVideoUrl',p.preview_video_url,
    'features',p.features,'marketingFields',p.marketing_fields,
    'productType',p.product_type,'isBundle',p.is_bundle,'eventMode',p.event_mode,
    'isActive',p.is_active,'isListed',p.is_listed,'isFeatured',p.is_featured,'archivedAt',p.archived_at,
    'availableFrom',p.available_from,'availableUntil',p.available_until,
    'allowCustomPrice',p.allow_custom_price,'customPriceMin',round(p.custom_price_min*public.currency_minor_factor(p.currency))::bigint,
    'billingInterval',p.billing_interval,'billingIntervalCount',p.billing_interval_count,'trialDays',p.trial_days,
    'priceIncludesVat',p.price_includes_vat,'vatRate',p.vat_rate,'vatExempt',p.vat_exempt,
    'isRefundable',p.is_refundable,'refundPeriodDays',p.refund_period_days,
    'autoGrantDurationDays',p.auto_grant_duration_days,'allowRepeatPurchase',p.allow_repeat_purchase,
    'enableWaitlist',p.enable_waitlist,'saleQuantityLimit',p.sale_quantity_limit,
    'issueLicenseOnPurchase',p.issue_license_on_purchase,'licenseDurationDays',p.license_duration_days);
$$;
REVOKE ALL ON FUNCTION public.product_catalogue_snapshot(public.products) FROM PUBLIC,anon,authenticated,service_role;

-- ===== DELETION IMPACT =====
-- What a permanent delete keeps (orders, invoices, licenses) and what it ends (buyer access).
CREATE FUNCTION public.product_deletion_impact(p_product_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH orders AS (
    SELECT id FROM public.payment_transactions WHERE product_id = p_product_id
    UNION SELECT transaction_id FROM public.payment_line_items WHERE product_id = p_product_id
  ), counts AS (
    SELECT (SELECT count(*) FROM orders) AS orders,
      (SELECT count(*) FROM public.invoices WHERE transaction_id IN (SELECT id FROM orders)) AS invoices,
      (SELECT count(*) FROM public.issued_licenses WHERE product_id = p_product_id) AS licenses,
      (SELECT count(*) FROM public.user_product_access WHERE product_id = p_product_id)
        + (SELECT count(*) FROM public.guest_purchases WHERE product_id = p_product_id AND claimed_by_user_id IS NULL) AS accesses,
      (SELECT count(*) FROM public.subscriptions WHERE product_id = p_product_id) AS subscriptions,
      EXISTS (SELECT 1 FROM public.affiliate_rules WHERE product_id = p_product_id) AS affiliate
  )
  SELECT jsonb_build_object('orders', orders, 'invoices', invoices, 'licenses', licenses, 'accesses', accesses,
    'subscriptions', subscriptions,
    'hasHistory', orders > 0 OR licenses > 0 OR accesses > 0 OR subscriptions > 0 OR affiliate)
  FROM counts;
$$;
REVOKE ALL ON FUNCTION public.product_deletion_impact(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_deletion_impact(uuid) TO service_role;

-- ===== REMOVE / RESTORE =====
-- Without history: delete. With history: archive (repeated calls are no-ops).
-- p_permanent: delete; a product with history must be archived first (SQLSTATE 55000).
CREATE FUNCTION public.remove_product_as(event_actor jsonb, p_product_id uuid, actor_id uuid, p_permanent boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  current_row public.products;
  impact jsonb;
BEGIN
  SELECT * INTO current_row FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  impact := public.product_deletion_impact(p_product_id);
  IF (impact->>'hasHistory')::boolean AND NOT p_permanent THEN
    IF current_row.archived_at IS NULL THEN
      PERFORM public.mutate_product_as(event_actor, 'UPDATE',
        jsonb_build_object('archived_at', now(), 'is_active', false), p_product_id, actor_id);
    END IF;
    RETURN jsonb_build_object('result', 'archived', 'impact', impact);
  END IF;
  IF (impact->>'hasHistory')::boolean AND current_row.archived_at IS NULL THEN
    RAISE EXCEPTION 'Archive the product before deleting it permanently' USING ERRCODE = '55000';
  END IF;
  PERFORM public.mutate_product_as(event_actor, 'DELETE', '{}'::jsonb, p_product_id, actor_id);
  RETURN jsonb_build_object('result', 'deleted', 'impact', impact);
END $$;
REVOKE ALL ON FUNCTION public.remove_product_as(jsonb, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_product_as(jsonb, uuid, uuid, boolean) TO service_role;

-- Restored products stay inactive until the seller activates them.
CREATE FUNCTION public.restore_product_as(event_actor jsonb, p_product_id uuid, actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE archived timestamptz;
BEGIN
  SELECT archived_at INTO archived FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  IF archived IS NOT NULL THEN
    PERFORM public.mutate_product_as(event_actor, 'UPDATE', jsonb_build_object('archived_at', NULL), p_product_id, actor_id);
  END IF;
  RETURN jsonb_build_object('result', 'restored');
END $$;
REVOKE ALL ON FUNCTION public.restore_product_as(jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_product_as(jsonb, uuid, uuid) TO service_role;

-- ===== Archive access =====
-- ===== Source: 20261114100001_product_archive_owner_access.sql =====
-- Product archive:
-- * an archived product is hidden from the public (waitlist included) but its buyers keep the content;
-- * a permanent delete is blocked only by active subscriptions and future event reservations;
--   ended subscriptions and past reservations stay as history, affiliate rules and bundle links go.
-- @see supabase/migrations/20261118000000_release_2026_11_1.sql

-- ===== VISIBILITY =====
GRANT SELECT (archived_at) ON public.products TO anon, authenticated;

-- Buyer check for the policy below; anon has no access to user_product_access itself.
CREATE FUNCTION public.owns_product_access(p_product_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_product_access
    WHERE product_id = p_product_id AND user_id = (SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.owns_product_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owns_product_access(uuid) TO anon, authenticated, service_role;

DROP POLICY "SELECT policy for products" ON public.products;
CREATE POLICY "SELECT policy for products" ON public.products FOR SELECT USING (
  (SELECT public.is_admin())
  OR (archived_at IS NULL AND is_active = true
      AND (available_from IS NULL OR available_from <= now())
      AND (available_until IS NULL OR available_until >= now()))
  OR (archived_at IS NULL AND is_active = false AND enable_waitlist = true)
  OR (is_active = false AND public.owns_product_access(id))
);

-- ===== HISTORY KEPT ON PERMANENT DELETE =====
ALTER TABLE public.subscriptions ADD COLUMN product_name text;
CREATE TRIGGER purchase_product_name BEFORE INSERT ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_purchase_product_name();
UPDATE public.subscriptions s SET product_name = p.name FROM public.products p
  WHERE p.id = s.product_id AND s.product_name IS NULL;
ALTER TABLE public.subscriptions ALTER COLUMN product_id DROP NOT NULL,
  DROP CONSTRAINT subscriptions_product_id_fkey,
  ADD CONSTRAINT subscriptions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

-- Subscription receipts keep their purchased summary when the offer leaves the catalogue.
ALTER TABLE public.subscriptions ADD COLUMN product_summary jsonb;
CREATE FUNCTION public.snapshot_subscription_product() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.product_summary IS NOT NULL THEN
    NEW.product_summary := OLD.product_summary;
  ELSIF NEW.product_summary IS NULL THEN
    SELECT jsonb_build_object('id', p.id, 'name', coalesce(NEW.product_name, p.name), 'slug', p.slug,
      'currency', coalesce(purchase.currency, p.currency), 'recurring_price', coalesce(purchase.amount / public.currency_minor_factor(purchase.currency), p.recurring_price),
      'billing_interval', p.billing_interval, 'billing_interval_count', p.billing_interval_count)
    INTO NEW.product_summary FROM public.products p
    LEFT JOIN LATERAL (
      SELECT t.amount, t.currency FROM public.payment_transactions t
      WHERE t.subscription_id = NEW.id AND t.amount > 0
        AND t.status IN ('completed', 'partially_refunded')
      ORDER BY t.created_at, t.id LIMIT 1
    ) purchase ON true
    WHERE p.id = NEW.product_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.snapshot_subscription_product() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER snapshot_subscription_product BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_subscription_product();
UPDATE public.subscriptions SET product_summary = NULL WHERE product_id IS NOT NULL;

-- Past reservations are detached from the deleted sessions by remove_product_as; the session
-- foreign keys keep blocking the removal of a reserved session through a product edit.
ALTER TABLE public.seat_reservations ALTER COLUMN session_id DROP NOT NULL, ALTER COLUMN tier_id DROP NOT NULL;

-- Removed together with the product. Affiliate rules stay append-only except for the rules of the
-- product remove_product_as is deleting (commissions still reference their rule and block it).
CREATE FUNCTION public.affiliate_rule_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.product_id::text = current_setting('sellf.deleting_product', true) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Append only record' USING ERRCODE = '23514';
END $$;
REVOKE ALL ON FUNCTION public.affiliate_rule_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER affiliate_rules_guard ON public.affiliate_rules;
CREATE TRIGGER affiliate_rules_guard BEFORE UPDATE OR DELETE ON public.affiliate_rules
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_rule_guard();
ALTER TABLE public.affiliate_rules DROP CONSTRAINT affiliate_rules_product_id_fkey,
  ADD CONSTRAINT affiliate_rules_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
ALTER TABLE public.bundle_items DROP CONSTRAINT bundle_items_component_product_id_fkey,
  ADD CONSTRAINT bundle_items_component_product_id_fkey FOREIGN KEY (component_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

-- ===== DELETION IMPACT =====
-- activeSubscriptions: statuses in which Stripe is charging or about to charge (as for account deletion).
-- futureReservations: confirmed or still-held seats of a session that has not ended yet.
-- affiliateCommissions: partner commissions recorded under the product's rules (partner payout history).
CREATE OR REPLACE FUNCTION public.product_deletion_impact(p_product_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH orders AS (
    SELECT id FROM public.payment_transactions WHERE product_id = p_product_id
    UNION SELECT transaction_id FROM public.payment_line_items WHERE product_id = p_product_id
  ), counts AS (
    SELECT (SELECT count(*) FROM orders) AS orders,
      (SELECT count(*) FROM public.invoices WHERE transaction_id IN (SELECT id FROM orders)) AS invoices,
      (SELECT count(*) FROM public.issued_licenses WHERE product_id = p_product_id) AS licenses,
      (SELECT count(*) FROM public.user_product_access WHERE product_id = p_product_id)
        + (SELECT count(*) FROM public.guest_purchases WHERE product_id = p_product_id AND claimed_by_user_id IS NULL) AS accesses,
      (SELECT count(*) FROM public.subscriptions WHERE product_id = p_product_id) AS subscriptions,
      (SELECT count(*) FROM public.subscriptions WHERE product_id = p_product_id
        AND status IN ('trialing', 'active', 'past_due', 'incomplete')) AS active_subscriptions,
      (SELECT count(*) FROM public.seat_reservations r JOIN public.product_sessions s ON s.id = r.session_id
        WHERE s.product_id = p_product_id AND coalesce(s.ends_at, s.starts_at) > now()
          AND (r.status = 'confirmed' OR (r.status = 'held' AND (r.expires_at IS NULL OR r.expires_at > now())))) AS future_reservations,
      (SELECT count(*) FROM public.affiliate_rules WHERE product_id = p_product_id) AS affiliate_rules,
      (SELECT count(*) FROM public.affiliate_commissions c JOIN public.affiliate_rules ar ON ar.id = c.rule_id
        WHERE ar.product_id = p_product_id) AS affiliate_commissions,
      (SELECT count(*) FROM public.bundle_items WHERE component_product_id = p_product_id) AS bundles
  )
  SELECT jsonb_build_object('orders', orders, 'invoices', invoices, 'licenses', licenses, 'accesses', accesses,
    'subscriptions', subscriptions, 'activeSubscriptions', active_subscriptions, 'futureReservations', future_reservations,
    'affiliateRules', affiliate_rules, 'affiliateCommissions', affiliate_commissions, 'bundles', bundles,
    'hasHistory', orders > 0 OR licenses > 0 OR accesses > 0 OR subscriptions > 0 OR affiliate_rules > 0)
  FROM counts;
$$;

-- p_permanent: 55000 = archive first; 55006 = still in use (active subscription, future reservation,
-- partner commissions).
CREATE OR REPLACE FUNCTION public.remove_product_as(event_actor jsonb, p_product_id uuid, actor_id uuid, p_permanent boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  current_row public.products;
  impact jsonb;
BEGIN
  SELECT * INTO current_row FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  impact := public.product_deletion_impact(p_product_id);
  IF (impact->>'bundles')::int > 0 THEN
    RAISE EXCEPTION 'Product belongs to bundles' USING ERRCODE = '2BP01',
      DETAIL = (SELECT string_agg(r->>'name', ', ' ORDER BY r->>'name')
        FROM jsonb_array_elements(impact->'bundleReferences') r);
  END IF;
  IF (impact->>'hasHistory')::boolean AND NOT p_permanent THEN
    IF current_row.archived_at IS NULL THEN
      PERFORM public.mutate_product_as(event_actor, 'UPDATE',
        jsonb_build_object('archived_at', now(), 'is_active', false), p_product_id, actor_id);
    END IF;
    RETURN jsonb_build_object('result', 'archived', 'impact', impact);
  END IF;
  IF (impact->>'hasHistory')::boolean AND current_row.archived_at IS NULL THEN
    RAISE EXCEPTION 'Archive the product before deleting it permanently' USING ERRCODE = '55000';
  END IF;
  IF (impact->>'activeSubscriptions')::int > 0 OR (impact->>'futureReservations')::int > 0
     OR (impact->>'affiliateCommissions')::int > 0 THEN
    RAISE EXCEPTION 'Product is still in use' USING ERRCODE = '55006';
  END IF;
  PERFORM set_config('sellf.deleting_product', p_product_id::text, true);
  UPDATE public.seat_reservations SET session_id = NULL, tier_id = NULL
    WHERE session_id IN (SELECT id FROM public.product_sessions WHERE product_id = p_product_id);
  PERFORM public.mutate_product_as(event_actor, 'DELETE', '{}'::jsonb, p_product_id, actor_id);
  PERFORM set_config('sellf.deleting_product', '', true);
  RETURN jsonb_build_object('result', 'deleted', 'impact', impact);
END $$;

-- ===== Queues and retries =====
-- ===== Source: 20261115100000_queue_retries.sql =====
-- Sellf 2026.11.1: queue retries.
--
-- 1. Abandoned license mails can be resumed. A repeated license grant puts a given-up
--    auth_mail_retries row back in the queue (application side). When the worker purges a
--    given-up row after seven days it now also forgets the mail's receipt, so a later grant
--    sends the key again instead of treating the never-delivered mail as sent.
--
-- 2. Business events that keep failing no longer starve new ones. Each claim counts an
--    attempt; a failed attempt waits with a growing interval (next_attempt_at) and after
--    eight attempts the event is abandoned: it stays visible in the admin panel (webhook
--    deliveries) and can be retried from there. The queue is ordered by next_attempt_at, so a
--    new event goes ahead of events that are waiting out their backoff.
--
-- Service role only, as before: no table or function is reachable by anon or authenticated.

-- ===== 1. License mail receipts follow purged given-up retries =====

CREATE OR REPLACE FUNCTION public.claim_auth_mail_retries(p_limit integer DEFAULT 20)
RETURNS SETOF public.auth_mail_retries LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- A purged license mail was never delivered: dropping its receipt lets a repeated grant send it again.
  WITH purged AS (
    DELETE FROM public.auth_mail_retries WHERE given_up_at < now() - interval '7 days' RETURNING license_mail_key
  )
  DELETE FROM public.license_mail_receipts r USING purged p WHERE r.mail_key = p.license_mail_key;
  RETURN QUERY
  UPDATE public.auth_mail_retries r SET attempts = r.attempts + 1, next_attempt_at = now() + interval '10 minutes'
  WHERE r.id IN (SELECT q.id FROM public.auth_mail_retries q WHERE q.given_up_at IS NULL AND q.next_attempt_at <= now()
    ORDER BY q.next_attempt_at LIMIT least(greatest(coalesce(p_limit, 20), 1), 100) FOR UPDATE SKIP LOCKED)
  RETURNING r.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_auth_mail_retries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_auth_mail_retries(integer) TO service_role;

-- ===== 2. Business event attempts, backoff and abandonment =====

ALTER TABLE public.business_events
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_error text CHECK (last_error IS NULL OR length(last_error) <= 200),
  ADD COLUMN abandoned_at timestamptz;

-- Backfill: pending events keep their original order (oldest first); delivered ones are never read again.
UPDATE public.business_events SET next_attempt_at = created_at WHERE dispatched_at IS NULL;

DROP INDEX IF EXISTS public.business_events_pending_idx;
CREATE INDEX business_events_due_idx ON public.business_events (next_attempt_at, created_at, id)
  WHERE dispatched_at IS NULL AND abandoned_at IS NULL;
CREATE INDEX business_events_abandoned_idx ON public.business_events (abandoned_at DESC)
  WHERE dispatched_at IS NULL AND abandoned_at IS NOT NULL;

-- Claims due events for one worker. The one-minute lease still keeps a parallel run away; an
-- event whose attempts ran out without a recorded failure (worker crashed mid-delivery) is
-- abandoned here instead of being claimed forever.
-- Contract for callers: every claimed event must be delivered or recorded with
-- fail_business_event in the same run, whatever happened before the claim.
CREATE OR REPLACE FUNCTION public.claim_business_events(p_limit integer DEFAULT 100) RETURNS SETOF public.business_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.business_events SET abandoned_at = now(), last_error = coalesce(last_error, 'lease_expired')
  WHERE dispatched_at IS NULL AND abandoned_at IS NULL AND attempts >= 8 AND (leased_until IS NULL OR leased_until < now());
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.business_events
    WHERE dispatched_at IS NULL AND abandoned_at IS NULL AND next_attempt_at <= now()
      AND (leased_until IS NULL OR leased_until < now())
    ORDER BY next_attempt_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT greatest(1, least(coalesce(p_limit, 100), 100))
  ),
  leased AS (
    UPDATE public.business_events b SET leased_until = now() + interval '1 minute', attempts = b.attempts + 1
    FROM picked WHERE b.id = picked.id RETURNING b.*
  )
  SELECT * FROM leased ORDER BY next_attempt_at, created_at, id;
END $$;
REVOKE ALL ON FUNCTION public.claim_business_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_business_events(integer) TO service_role;

-- Records a failed attempt: waits 1, 5, 15, 30, 60, 120, 240 minutes after attempts 1-7 and
-- abandons the event after the eighth. Returns true when the event was abandoned.
CREATE FUNCTION public.fail_business_event(p_id uuid, p_error text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  backoff constant integer[] := ARRAY[1, 5, 15, 30, 60, 120, 240];
  done integer;
BEGIN
  UPDATE public.business_events SET
    leased_until = NULL,
    last_error = left(coalesce(nullif(btrim(p_error), ''), 'delivery_failed'), 200),
    abandoned_at = CASE WHEN attempts >= 8 THEN now() ELSE NULL END,
    next_attempt_at = CASE WHEN attempts >= 8 THEN next_attempt_at
      ELSE now() + make_interval(mins => backoff[least(greatest(attempts, 1), 7)]) END
  WHERE id = p_id AND dispatched_at IS NULL AND abandoned_at IS NULL
  RETURNING attempts INTO done;
  RETURN coalesce(done >= 8, false);
END $$;
REVOKE ALL ON FUNCTION public.fail_business_event(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_business_event(uuid, text) TO service_role;

-- An admin's retry of an abandoned event: fresh attempts, due on the next worker tick.
CREATE FUNCTION public.retry_business_event(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.business_events SET abandoned_at = NULL, attempts = 0, next_attempt_at = now(), leased_until = NULL, last_error = NULL
  WHERE id = p_id AND dispatched_at IS NULL AND abandoned_at IS NOT NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.retry_business_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_business_event(uuid) TO service_role;

-- ===== Transfer orders =====
-- ===== Source: 20261115110000_cancelled_order_no_payment.sql =====
-- A cancelled order can no longer be paid by the buyer in any way, whether the
-- administrator cancelled it or the reservation timer released it (payment_window_expired). Only the administrator
-- can accept a transfer that arrived late (admin_bank_transfer_order, p_accept_cancelled).
-- * open_order_payment_attempt accepts only 'settle' on an order still awaiting payment (the 'reopen' mode is gone).
-- * complete_order_payment_attempt completes only a 'settle' attempt on an order awaiting payment; anything else is a
--   duplicate the caller refunds automatically (sellf-dup-refund-<attempt>).
-- * Every closing of an order (admin cancel, timer release, admin mark-paid) supersedes the open attempts and returns
--   their Stripe session ids in expire_sessions, so the caller expires the payment pages still open in the buyer's browser.
-- * After the reservation deadline (release_at) no NEW online payment attempt opens. An attempt started before it may
--   finish, but the release job's protection ends 30 minutes after the deadline at the latest (cannot be renewed).
-- * Accepting a late transfer that would go over a seat limit (session capacity OR the order's saved price tier, the
--   rules confirm_event_order applies) requires the administrator's explicit confirmation (p_accept_oversold).
--   event_order_seats() gives the preview the same facts the acceptance uses.
-- * "I have sent the transfer" after the reservation deadline (release_at, before the release job cancels) is recorded so the
--   seller sees it, but neither extends the reservation nor delays the cancellation. Before the deadline: extended as before.
-- Bodies otherwise identical to 20261110235905 / 20261110235906.

-- ===== Close the open online payment attempts of an order; caller holds the order row lock =====
CREATE FUNCTION public._supersede_order_payment_attempts(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sessions jsonb;
BEGIN
  WITH closed AS (
    UPDATE public.order_payment_attempts SET status='superseded'
      WHERE transaction_id=p_id AND status IN ('opening','open') RETURNING stripe_session_id
  ) SELECT coalesce(jsonb_agg(stripe_session_id) FILTER (WHERE stripe_session_id IS NOT NULL),'[]'::jsonb) INTO sessions FROM closed;
  RETURN sessions;
END $$;
REVOKE ALL ON FUNCTION public._supersede_order_payment_attempts(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._supersede_order_payment_attempts(uuid) TO service_role;

-- Revival attempts opened before this version can no longer complete; a payment that still lands is refunded.
UPDATE public.order_payment_attempts SET status='superseded' WHERE kind='reopen' AND status IN ('opening','open');

-- ===== ONLINE PAYMENT: only an unpaid order =====
CREATE OR REPLACE FUNCTION public.open_order_payment_attempt(p_id uuid,p_kind text,p_amount numeric,p_currency text,p_expires_at timestamptz,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; a public.order_payment_attempts%ROWTYPE;
BEGIN
  IF p_now IS NULL OR p_expires_at IS NULL OR p_expires_at<=p_now OR p_kind IS DISTINCT FROM 'settle' THEN
    RAISE EXCEPTION 'Invalid attempt' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' OR tx.status<>'awaiting_payment'
    OR p_amount IS DISTINCT FROM tx.amount OR upper(p_currency)<>upper(tx.currency) THEN
    RAISE EXCEPTION 'Order not payable' USING ERRCODE='22023'; END IF;
  UPDATE public.order_payment_attempts SET status='expired' WHERE transaction_id=p_id AND status IN ('opening','open') AND expires_at<=p_now;
  SELECT * INTO a FROM public.order_payment_attempts WHERE transaction_id=p_id AND status IN ('opening','open');
  IF FOUND THEN RETURN to_jsonb(a)||'{"reused":true}'; END IF;
  -- Past the reservation deadline the order waits for the release job; no new attempt may extend it.
  IF tx.release_at IS NOT NULL AND p_now>=tx.release_at THEN RAISE EXCEPTION 'Payment window closed' USING ERRCODE='22023'; END IF;
  INSERT INTO public.order_payment_attempts(transaction_id,kind,amount,currency,expires_at) VALUES(p_id,p_kind,p_amount,upper(p_currency),p_expires_at) RETURNING * INTO a;
  RETURN to_jsonb(a)||'{"reused":false}';
END $$;
REVOKE ALL ON FUNCTION public.open_order_payment_attempt(uuid,text,numeric,text,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.open_order_payment_attempt(uuid,text,numeric,text,timestamptz,timestamptz) TO service_role;

-- Paid online. Completes the same unpaid order once; if it was already paid (admin), cancelled meanwhile or the attempt
-- was superseded, the payment is a duplicate the caller refunds. result: completed | already | duplicate.
CREATE OR REPLACE FUNCTION public.complete_order_payment_attempt(p_attempt uuid,p_session_id text,p_payment_intent text,p_amount numeric,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.order_payment_attempts%ROWTYPE; tx public.payment_transactions%ROWTYPE; result jsonb;
BEGIN
  SELECT * INTO a FROM public.order_payment_attempts WHERE id=p_attempt;
  IF NOT FOUND OR a.stripe_session_id IS DISTINCT FROM p_session_id OR p_amount IS DISTINCT FROM a.amount THEN
    RAISE EXCEPTION 'Attempt mismatch' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=a.transaction_id FOR UPDATE;
  SELECT * INTO a FROM public.order_payment_attempts WHERE id=p_attempt FOR UPDATE;
  IF a.status IN ('completed','duplicate') THEN
    RETURN jsonb_build_object('result',CASE a.status WHEN 'completed' THEN 'already' ELSE 'duplicate' END,'transaction_id',tx.id,'attempt_status',a.status,'refund_id',a.refund_id);
  END IF;
  IF a.status='superseded' OR a.kind<>'settle' OR tx.status<>'awaiting_payment' THEN
    UPDATE public.order_payment_attempts SET status='duplicate',stripe_payment_intent_id=p_payment_intent,completed_at=p_now WHERE id=a.id;
    INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('order_payment_attempts','UPDATE',
      jsonb_build_object('action','order.payment_duplicate','transaction_id',tx.id,'attempt_id',a.id,'payment_intent',p_payment_intent,
        'order_status',tx.status));
    RETURN jsonb_build_object('result','duplicate','transaction_id',tx.id);
  END IF;
  UPDATE public.payment_transactions SET stripe_payment_intent_id=p_payment_intent,settled_via='stripe' WHERE id=tx.id;
  result:=public.complete_offline_order(tx.id,a.amount);
  IF NOT coalesce((result->>'success')::boolean,false) THEN RAISE EXCEPTION 'Online completion failed' USING ERRCODE='P0001'; END IF;
  UPDATE public.payment_transactions SET paid_at=p_now WHERE id=tx.id;
  UPDATE public.order_payment_attempts SET status='completed',stripe_payment_intent_id=p_payment_intent,completed_at=p_now WHERE id=a.id;
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('payment_transactions','UPDATE',
    jsonb_build_object('action','order.paid_online','transaction_id',tx.id,'attempt_id',a.id,'previous_status',tx.status,'amount',a.amount,
      'oversold',coalesce((SELECT (metadata->>'oversold')::boolean FROM public.payment_transactions WHERE id=tx.id),false)));
  RETURN jsonb_build_object('result','completed','transaction_id',tx.id,'reopened',false);
END $$;
REVOKE ALL ON FUNCTION public.complete_order_payment_attempt(uuid,text,text,numeric,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order_payment_attempt(uuid,text,text,numeric,timestamptz) TO service_role;

-- ===== ADMIN CANCELLATION: also closes the buyer's open online payment =====
CREATE OR REPLACE FUNCTION public.cancel_unpaid_order(p_transaction_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  redeemed uuid;
  sessions jsonb;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Cancellation reason required'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider <> 'bank_transfer' THEN RAISE EXCEPTION 'Unpaid transfer required'; END IF;
  IF tx.status = 'cancelled' THEN RETURN jsonb_build_object('success', true, 'already_cancelled', true, 'expire_sessions', '[]'::jsonb); END IF;
  IF tx.status <> 'awaiting_payment' THEN RAISE EXCEPTION 'Unpaid transfer required'; END IF;
  FOR redeemed IN DELETE FROM public.coupon_redemptions WHERE transaction_id = tx.id RETURNING coupon_id LOOP
    UPDATE public.coupons SET current_usage_count = greatest(0, current_usage_count - 1) WHERE id = redeemed;
  END LOOP;
  UPDATE public.payment_transactions SET status = 'cancelled', cancel_note = btrim(p_reason), updated_at = now() WHERE id = tx.id;
  sessions := public._supersede_order_payment_attempts(tx.id);
  PERFORM public.log_admin_action('cancel_unpaid_order', 'payment_transaction', tx.id::text,
    jsonb_build_object('reason', p_reason, 'coupon_id', tx.coupon_id, 'transaction_id', tx.id, 'expire_sessions', sessions));
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id, 'expire_sessions', sessions);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_unpaid_order(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_order(uuid,text) TO service_role;

-- ===== RELEASE: an attempt still running protects the order (at most 30 min past the deadline); a stale one is closed with the release =====
CREATE OR REPLACE FUNCTION public.release_unpaid_transfer(p_id uuid,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; redeemed uuid; sessions jsonb;
BEGIN
  IF p_now IS NULL THEN RAISE EXCEPTION 'Time required' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' OR tx.status<>'awaiting_payment' OR tx.release_at IS NULL
    OR tx.release_at>p_now OR tx.invoice_hold_at IS NOT NULL
    OR (p_now<tx.release_at+interval '30 minutes'
      AND EXISTS(SELECT 1 FROM public.order_payment_attempts a WHERE a.transaction_id=tx.id AND a.status IN ('opening','open') AND a.expires_at>p_now))
    OR EXISTS(SELECT 1 FROM public.invoices i WHERE i.transaction_id=tx.id AND i.status IN ('issuing','issued','corrected')) THEN
    RETURN jsonb_build_object('success',true,'released',false);
  END IF;
  FOR redeemed IN DELETE FROM public.coupon_redemptions WHERE transaction_id=tx.id RETURNING coupon_id LOOP
    UPDATE public.coupons SET current_usage_count=greatest(0,current_usage_count-1) WHERE id=redeemed;
  END LOOP;
  PERFORM set_config('sellf.event_context',jsonb_build_object('actor',jsonb_build_object('type','system','id',NULL),'reason','payment_window_expired')::text,true);
  UPDATE public.payment_transactions SET status='cancelled',cancel_reason='payment_window_expired',updated_at=now() WHERE id=tx.id;
  PERFORM set_config('sellf.event_context','',true);
  sessions:=public._supersede_order_payment_attempts(tx.id);
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('payment_transactions','UPDATE',
    jsonb_build_object('action','order.released','transaction_id',tx.id,'release_at',tx.release_at,'coupon_id',tx.coupon_id,'expire_sessions',sessions));
  RETURN jsonb_build_object('success',true,'released',true,'transaction_id',tx.id,'expire_sessions',sessions);
END $$;
REVOKE ALL ON FUNCTION public.release_unpaid_transfer(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_unpaid_transfer(uuid,timestamptz) TO service_role;

-- ===== SEATS: what re-taking a released seat would do (one rule for confirmation, preview and acceptance) =====
-- Seats left for one order line, excluding the order itself: session capacity and the saved price tier. NULL = unlimited.
CREATE FUNCTION public._event_line_seats(p_transaction_id uuid, p_session_id uuid, p_tier_id uuid, p_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'session',(SELECT s.capacity-coalesce((SELECT sum(r.quantity) FROM public.seat_reservations r WHERE r.session_id=p_session_id
      AND r.transaction_id<>p_transaction_id AND (r.status='confirmed' OR (r.status='held' AND (r.expires_at IS NULL OR r.expires_at>p_at)))),0)
      FROM public.product_sessions s WHERE s.id=p_session_id),
    'tier',(SELECT t.seats-coalesce((SELECT sum(r.quantity) FROM public.seat_reservations r WHERE r.tier_id=p_tier_id
      AND r.transaction_id<>p_transaction_id AND (r.status='confirmed' OR (r.status='held' AND (r.expires_at IS NULL OR r.expires_at>p_at)))),0)
      FROM public.product_price_tiers t WHERE t.id=p_tier_id));
$$;
REVOKE ALL ON FUNCTION public._event_line_seats(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._event_line_seats(uuid,uuid,uuid,timestamptz) TO service_role;

-- Seat facts of an order at p_at: quantity, seats left in the session and in the saved tier (NULL = unlimited), and
-- oversold = completing it now would go over a limit. NULL for an order without a seat. Read-only.
CREATE FUNCTION public.event_order_seats(p_transaction_id uuid, p_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('session_id',li.session_id,'quantity',li.quantity,'session_remaining',seats->'session','tier_remaining',seats->'tier',
    'oversold',NOT EXISTS(SELECT 1 FROM public.seat_reservations r WHERE r.transaction_id=p_transaction_id
        AND (r.status='confirmed' OR (r.status='held' AND (r.expires_at IS NULL OR r.expires_at>p_at))))
      AND (coalesce((seats->>'session')::integer<li.quantity,false) OR coalesce((seats->>'tier')::integer<li.quantity,false)))
  FROM public.payment_line_items li CROSS JOIN LATERAL (SELECT public._event_line_seats(p_transaction_id,li.session_id,li.tier_id,p_at) seats) x
  WHERE li.transaction_id=p_transaction_id AND li.session_id IS NOT NULL ORDER BY li.item_type<>'main_product', li.session_id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.event_order_seats(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_order_seats(uuid,timestamptz) TO service_role;

-- Same body as 20261110235904 except the seat count, which now comes from _event_line_seats.
CREATE OR REPLACE FUNCTION public.confirm_event_order(p_transaction_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE li public.payment_line_items%ROWTYPE; r public.seat_reservations%ROWTYPE; seats jsonb;
BEGIN
  FOR li IN SELECT * FROM public.payment_line_items WHERE transaction_id=p_transaction_id AND session_id IS NOT NULL ORDER BY session_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(li.session_id::text,0));
    SELECT * INTO r FROM public.seat_reservations WHERE transaction_id=p_transaction_id FOR UPDATE;
    IF r.status='confirmed' THEN CONTINUE; END IF;
    IF r.status='held' AND (r.expires_at IS NULL OR r.expires_at>now()) THEN
      UPDATE public.seat_reservations SET status='confirmed',confirmed_at=now() WHERE id=r.id;
      CONTINUE;
    END IF;
    seats:=public._event_line_seats(p_transaction_id,li.session_id,li.tier_id,now());
    IF coalesce((seats->>'session')::integer<li.quantity,false) OR coalesce((seats->>'tier')::integer<li.quantity,false) THEN
      UPDATE public.payment_transactions SET metadata=coalesce(metadata,'{}'::jsonb)||'{"oversold":true}'::jsonb WHERE id=p_transaction_id;
      UPDATE public.seat_reservations SET status='released',released_at=now() WHERE id=r.id;
      INSERT INTO public.audit_log(table_name,operation,new_values) VALUES ('payment_transactions','UPDATE',
        jsonb_build_object('action','event.oversold','transaction_id',p_transaction_id,'session_id',li.session_id));
      RAISE LOG 'event.oversold transaction=% session=%',p_transaction_id,li.session_id;
    ELSE
      INSERT INTO public.seat_reservations(session_id,tier_id,transaction_id,quantity,status,confirmed_at)
        VALUES (li.session_id,li.tier_id,p_transaction_id,li.quantity,'confirmed',now())
        ON CONFLICT (transaction_id) DO UPDATE SET status='confirmed',confirmed_at=now(),released_at=NULL;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.confirm_event_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_event_order(uuid) TO service_role;

-- ===== ADMIN: mark-paid and cancel name the online payment sessions to expire; going over a seat limit needs confirmation =====
DROP FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean);
CREATE FUNCTION public.admin_bank_transfer_order(p_id uuid,p_action text,p_amount numeric DEFAULT NULL,p_paid_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL,p_actor uuid DEFAULT NULL,p_accept_cancelled boolean DEFAULT false,p_accept_oversold boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; tx public.payment_transactions%ROWTYPE; invoice_status text; reopen boolean:=false; seats jsonb;
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
      -- Same session lock as confirm_event_order, so the checked seats cannot change before completion takes them.
      PERFORM pg_advisory_xact_lock(hashtextextended(li.session_id::text,0))
        FROM public.payment_line_items li WHERE li.transaction_id=tx.id AND li.session_id IS NOT NULL ORDER BY li.session_id;
      seats:=public.event_order_seats(tx.id,now());
      IF coalesce((seats->>'oversold')::boolean,false) AND NOT coalesce(p_accept_oversold,false) THEN
        RETURN jsonb_build_object('success',false,'error','oversold_confirmation_required','seats',seats);
      END IF;
      PERFORM public._reopen_cancelled_transfer(tx.id);
      reopen:=true;
    END IF;
    result:=public.complete_offline_order(p_id,p_amount);
    IF (result->>'success')::boolean THEN
      result:=result||jsonb_build_object('expire_sessions',public._supersede_order_payment_attempts(p_id));
    END IF;
    IF (result->>'success')::boolean AND tx.status<>'completed' THEN
      UPDATE public.payment_transactions SET paid_at=p_paid_at,reopened_at=CASE WHEN reopen THEN now() ELSE reopened_at END WHERE id=p_id;
    END IF;
    IF reopen AND (result->>'success')::boolean THEN
      INSERT INTO public.audit_log(table_name,operation,performed_by,user_id,new_values) VALUES('payment_transactions','UPDATE',p_actor,p_actor,
        jsonb_build_object('action','order.reopened','transaction_id',p_id,'previous_status','cancelled','amount',tx.amount,'reason',p_reason,
          'oversold',coalesce((SELECT (metadata->>'oversold')::boolean FROM public.payment_transactions WHERE id=p_id),false),
          'oversold_confirmed',coalesce((seats->>'oversold')::boolean,false)));
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
REVOKE EXECUTE ON FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bank_transfer_order(uuid,text,numeric,timestamptz,text,uuid,boolean,boolean) TO service_role;

-- ===== DECLARATION: past the deadline it only tells the seller =====
CREATE OR REPLACE FUNCTION public.declare_transfer(p_id uuid,p_note text,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tx public.payment_transactions%ROWTYPE; hold integer; note text:=nullif(btrim(p_note),''); late boolean;
BEGIN
  IF p_now IS NULL OR length(note)>200 OR note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid declaration' USING ERRCODE='22023'; END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR tx.payment_provider<>'bank_transfer' OR tx.status<>'awaiting_payment' THEN
    RETURN jsonb_build_object('success',false,'error','not_awaiting_payment');
  END IF;
  -- Same moment the release job cancels at (release_at<=now): from then on the reservation is over.
  late:=tx.release_at IS NOT NULL AND p_now>=tx.release_at;
  IF tx.transfer_declared_at IS NOT NULL THEN
    RETURN jsonb_build_object('success',true,'already_declared',true,'releaseAt',tx.release_at,'declaredAt',tx.transfer_declared_at,'afterDeadline',late);
  END IF;
  SELECT declared_hold_hours INTO STRICT hold FROM public.bank_transfer_config WHERE id;
  UPDATE public.payment_transactions SET transfer_declared_at=p_now,transfer_declared_note=note,
    release_at=CASE WHEN release_at IS NULL OR late THEN release_at ELSE greatest(release_at,p_now+make_interval(hours=>hold)) END,
    updated_at=now() WHERE id=tx.id RETURNING * INTO tx;
  INSERT INTO public.audit_log(table_name,operation,new_values) VALUES('payment_transactions','UPDATE',
    jsonb_build_object('action','order.transfer_declared','transaction_id',tx.id,'release_at',tx.release_at,'after_deadline',late));
  RETURN jsonb_build_object('success',true,'already_declared',false,'releaseAt',tx.release_at,'declaredAt',tx.transfer_declared_at,'afterDeadline',late);
END $$;
REVOKE ALL ON FUNCTION public.declare_transfer(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.declare_transfer(uuid,text,timestamptz) TO service_role;

-- ===== Order mail policy =====

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
    OR (p_data ? 'access_on_placement' AND p_data->>'access_on_placement' NOT IN ('true','false'))
    OR length(p_data->>'release_text')>500
    OR length(p_data->>'cancel_reason_text')>2000 OR length(p_data->>'license_expires_text')>100
    OR length(p_data->>'license_expires_at')>50
    OR (p_data ? 'license_keys' AND (jsonb_typeof(p_data->'license_keys') <> 'object'
      OR octet_length((p_data->'license_keys')::text)>65536
      OR EXISTS (SELECT 1 FROM jsonb_each_text(p_data->'license_keys') e
        WHERE length(e.key)>500 OR length(e.value)>4096 OR e.value !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')))
    OR length(p_data->>'license_key')>4096 OR (p_data->>'license_key') !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    OR (p_data ? 'payment_received' AND (p_data->>'payment_received') <> 'true')
    OR (p_data ? 'transfer' AND (jsonb_typeof(p_data->'transfer') <> 'object'
      OR octet_length((p_data->'transfer')::text)>2000
      OR EXISTS (SELECT 1 FROM jsonb_each(p_data->'transfer') e
        WHERE jsonb_typeof(e.value) <> 'string' OR e.key NOT IN ('holder','account','bank','title','amount','due'))))
    THEN RAISE EXCEPTION 'Invalid mail data' USING ERRCODE='22023'; END IF;
  UPDATE auth.users SET raw_user_meta_data=(coalesce(raw_user_meta_data,'{}')
    -'event_date'-'event_online_url'-'transfer_text'-'transfer'-'purchase_product'-'purchase_amount'-'locale'
    -'cancel_reason_text'-'license_expires_at'-'license_expires_text'
    -'access_on_placement'-'mail_kind'-'pay_url'-'release_text'-'participants_url'-'license_keys'-'license_key'-'payment_received')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date',
      'event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text','transfer',p_data->'transfer',
      'purchase_product',p_data->>'purchase_product','purchase_amount',p_data->>'purchase_amount',
      'access_on_placement',p_data->>'access_on_placement',
      'mail_kind',p_data->>'mail_kind','pay_url',p_data->>'pay_url','release_text',p_data->>'release_text',
      'license_keys',p_data->'license_keys','participants_url',p_data->>'participants_url','license_key',p_data->>'license_key',
      'payment_received',p_data->>'payment_received',
      'cancel_reason_text',p_data->>'cancel_reason_text','license_expires_at',p_data->>'license_expires_at',
      'license_expires_text',p_data->>'license_expires_text',
      'locale',coalesce(p_data->>'locale','en')))
    WHERE lower(email)=lower(p_email);
END $$;
REVOKE ALL ON FUNCTION public.prepare_event_mail(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_mail(text,jsonb) TO service_role;


-- ===== Stripe reconciliation =====
-- ===== Source: 20261115120000_stripe_marker_reconciliation.sql =====
-- Release 11.1: Stripe payments of this installation on a shared Stripe account.
--
-- 1. Payments waiting for reconciliation (admin_actions 'stripe_payment_needs_reconciliation', written by
--    the Stripe webhook for a paid product that was deleted) are recorded once per payment, atomically:
--    a partial unique index on the payment id serves Checkout Session and PaymentIntent deliveries alike.
-- 2. Log retention (cleanup_old_admin_actions) never deletes those records: they are open work for the
--    administrator, not history.
-- 3. Payment completion accepts allow_inactive_product_param: the webhook sets it for a paid session that
--    carries this installation's own marker, so a product deactivated or archived after checkout is still
--    fulfilled. Amount, currency and saved-order checks are unchanged; the buyer-side verification path
--    keeps the default (false).
--
-- @see admin-panel/src/lib/stripe/payment-reconciliation.ts
-- @see admin-panel/src/app/api/webhooks/stripe/onetime-handlers.ts

-- ===== 1. One reconciliation record per payment =====
DELETE FROM public.admin_actions a
USING public.admin_actions b
WHERE a.action = 'stripe_payment_needs_reconciliation'
  AND b.action = 'stripe_payment_needs_reconciliation'
  AND a.target_id = b.target_id
  AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX admin_actions_payment_reconciliation_key
  ON public.admin_actions (target_id)
  WHERE action = 'stripe_payment_needs_reconciliation';

-- ===== 2. Retention keeps payments waiting for reconciliation =====
CREATE OR REPLACE FUNCTION public.cleanup_old_admin_actions(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    IF NOT (SELECT public.is_admin()) THEN
        RAISE EXCEPTION 'Unauthorized: Admin privileges required';
    END IF;
    IF retention_days IS NULL OR retention_days < 30 THEN
        RAISE EXCEPTION 'Retention period must be at least 30 days';
    END IF;

    DELETE FROM public.admin_actions
    WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL
      AND action <> 'stripe_payment_needs_reconciliation';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_admin_actions(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_admin_actions(INTEGER) TO service_role;

-- ===== 3. Completion of our paid session for an inactive product =====
DROP FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric);
DROP FUNCTION public._process_stripe_payment_completion_with_bump_impl(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric);

CREATE FUNCTION public._process_stripe_payment_completion_with_bump_impl(
  session_id_param TEXT,
  product_id_param UUID,
  customer_email_param TEXT,
  amount_total NUMERIC,
  currency_param TEXT,
  stripe_payment_intent_id TEXT DEFAULT NULL,
  user_id_param UUID DEFAULT NULL,
  bump_product_ids_param UUID[] DEFAULT NULL,
  coupon_id_param UUID DEFAULT NULL,
  amount_subtotal_param NUMERIC DEFAULT NULL,
  allow_inactive_product_param BOOLEAN DEFAULT false
) RETURNS JSONB AS $$
DECLARE
  pi_param TEXT := stripe_payment_intent_id;
  current_user_id UUID;
  product_record RECORD;
  existing_user_id UUID;
  access_expires_at TIMESTAMPTZ := NULL;
  transaction_id_var UUID;
  pending_transaction_id UUID;
  bump_rec RECORD;
  total_bump_price NUMERIC := 0;
  bump_count INTEGER := 0;
  bump_ids_found UUID[] := '{}';
  main_line_item_price NUMERIC := 0;
  effective_unit_price NUMERIC := 0;
  existing_transaction_id UUID;
  caller_email TEXT;
  charge_basis NUMERIC := 0;  -- net for net-priced products, else gross
  minor_factor NUMERIC := public.currency_minor_factor(currency_param);  -- 100, or 1 for zero-decimal currencies
  saved_tx public.payment_transactions%ROWTYPE;
  saved_main public.payment_line_items%ROWTYPE;
  saved_total numeric;

BEGIN
  IF NOT public.check_rate_limit('process_stripe_payment_completion', 100, 3600) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rate limit exceeded');
  END IF;

  IF session_id_param IS NULL OR length(session_id_param) = 0 OR length(session_id_param) > 255 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID');
  END IF;

  IF NOT (session_id_param ~* '^(cs_|pi_)[a-zA-Z0-9_]+$') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid session ID format');
  END IF;

  IF product_id_param IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product ID is required');
  END IF;

  IF NOT public.validate_email_format(customer_email_param) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Valid email address is required');
  END IF;

  IF amount_total IS NULL OR amount_total <= 0 OR amount_total > 99999999 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount');
  END IF;

  IF user_id_param IS NOT NULL THEN
    IF (select auth.role()) = 'service_role' THEN
      current_user_id := user_id_param;
    ELSIF auth.uid() = user_id_param THEN
      current_user_id := user_id_param;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
    END IF;
  ELSE
    current_user_id := NULL;
  END IF;

  IF current_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = current_user_id AND email_confirmed_at IS NOT NULL
  ) THEN
    current_user_id := NULL;
  END IF;

  SELECT * INTO saved_tx FROM public.payment_transactions
  WHERE session_id = session_id_param OR (pi_param IS NOT NULL AND payment_transactions.stripe_payment_intent_id = pi_param)
  LIMIT 1 FOR UPDATE;
  IF saved_tx.pricing_snapshot_version IS NOT NULL THEN
    SELECT * INTO saved_main FROM public.payment_line_items
      WHERE transaction_id = saved_tx.id AND item_type = 'main_product';
    IF saved_tx.payment_provider <> 'stripe' OR saved_tx.product_id IS DISTINCT FROM product_id_param
      OR saved_main.product_id IS DISTINCT FROM product_id_param
      OR (SELECT count(*) FROM public.payment_line_items WHERE transaction_id = saved_tx.id AND item_type = 'main_product') <> 1
      OR saved_tx.coupon_id IS DISTINCT FROM coupon_id_param
      OR upper(saved_tx.currency) IS DISTINCT FROM upper(currency_param)
      OR EXISTS (SELECT 1 FROM unnest(bump_product_ids_param) bid WHERE NOT EXISTS (
        SELECT 1 FROM public.payment_line_items li WHERE li.transaction_id = saved_tx.id
          AND li.item_type = 'order_bump' AND li.product_id = bid))
      OR EXISTS (SELECT 1 FROM public.payment_line_items WHERE transaction_id = saved_tx.id
        AND (discounted_total IS NULL OR upper(currency) IS DISTINCT FROM upper(currency_param))) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Saved order details do not match', 'error_kind', 'data');
    END IF;
    SELECT round(sum(discounted_total) * minor_factor) INTO saved_total
      FROM public.payment_line_items WHERE transaction_id = saved_tx.id;
    charge_basis := CASE WHEN saved_main.tax_behavior = 'exclusive' THEN coalesce(amount_subtotal_param, amount_total) ELSE amount_total END;
    IF charge_basis IS DISTINCT FROM saved_total THEN
      RETURN jsonb_build_object('success', false, 'error', 'Saved order amount does not match', 'error_kind', 'data');
    END IF;
    IF saved_tx.status = 'pending' THEN
      SELECT id INTO existing_user_id FROM auth.users
        WHERE email = customer_email_param AND email_confirmed_at IS NOT NULL;
      current_user_id := coalesce(current_user_id, existing_user_id);
      UPDATE public.payment_transactions SET status = 'completed', fulfillment_pending = true,
        user_id = current_user_id, customer_email = customer_email_param, updated_at = now()
        WHERE id = saved_tx.id;
      RETURN public._order_grant_and_record(saved_tx.id, current_user_id, existing_user_id,
        user_id_param, coupon_id_param, 'consume_reservation') || jsonb_build_object('pricing_source', 'snapshot');
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.payment_transactions WHERE session_id = session_id_param AND status != 'pending') THEN
    IF current_user_id IS NOT NULL THEN
      SELECT email INTO caller_email FROM auth.users WHERE id = current_user_id AND email_confirmed_at IS NOT NULL;
      IF caller_email IS NOT NULL AND lower(caller_email) = lower(customer_email_param) THEN
        SELECT id INTO existing_transaction_id
        FROM public.payment_transactions
        WHERE session_id = session_id_param
        LIMIT 1;

        IF EXISTS (
          SELECT 1 FROM public.guest_purchases
          WHERE session_id = session_id_param AND claimed_by_user_id IS NULL
        ) THEN
          PERFORM public.grant_product_and_bundle_components(current_user_id, product_id_param);

          FOR bump_rec IN
            SELECT pli.product_id, pli.access_duration_override
            FROM public.payment_line_items pli
            WHERE pli.transaction_id = existing_transaction_id
              AND pli.item_type = 'order_bump'
          LOOP
            PERFORM public.grant_product_access_service_role(
              current_user_id,
              bump_rec.product_id,
              override_duration_days_param => bump_rec.access_duration_override
            );
          END LOOP;

          UPDATE public.guest_purchases
          SET claimed_by_user_id = current_user_id,
              claimed_at = NOW()
          WHERE session_id = session_id_param;

          UPDATE public.payment_transactions
          SET user_id = current_user_id,
              updated_at = NOW()
          WHERE id = existing_transaction_id AND user_id IS NULL;

          RETURN jsonb_build_object(
            'success', true,
            'scenario', 'idempotent_claimed_for_logged_in_user',
            'access_granted', true,
            'is_guest_purchase', false,
            'send_magic_link', false,
            'requires_login', false,
            'customer_email', customer_email_param
          );
        END IF;
      END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM public.guest_purchases WHERE session_id = session_id_param AND claimed_by_user_id IS NULL) THEN
      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'guest_purchase_new_user_with_bump',
        'access_granted', false,
        'is_guest_purchase', true,
        'send_magic_link', true,
        'customer_email', customer_email_param,
        'message', 'Payment already processed (idempotent)'
      );
    ELSE
      RETURN jsonb_build_object(
        'success', true,
        'scenario', 'already_processed_idempotent',
        'access_granted', true,
        'already_had_access', true,
        'message', 'Payment already processed (idempotent)'
      );
    END IF;
  END IF;

  SELECT id, name, auto_grant_duration_days, price, currency, allow_custom_price, custom_price_min,
         sale_price, sale_price_until, sale_quantity_limit, sale_quantity_sold, price_includes_vat, is_active INTO product_record
  FROM public.products
  WHERE id = product_id_param;

  -- A paid session of this installation stays payable after the product was deactivated or archived;
  -- the amount and currency checks below still apply.
  IF NOT FOUND OR (NOT product_record.is_active AND NOT coalesce(allow_inactive_product_param, false)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found or inactive');
  END IF;

  IF product_record.currency IS NOT NULL THEN
    IF upper(currency_param) != upper(product_record.currency) THEN
      RAISE EXCEPTION 'Currency mismatch: expected %, got %',
        product_record.currency, currency_param;
    END IF;
  END IF;

  effective_unit_price := CASE
    WHEN public.is_sale_price_active(
           product_record.sale_price,
           product_record.sale_price_until,
           product_record.sale_quantity_limit,
           product_record.sale_quantity_sold)
    THEN product_record.sale_price
    ELSE product_record.price
  END;

  IF bump_product_ids_param IS NOT NULL AND array_length(bump_product_ids_param, 1) > 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many bump products (max 20)');
  END IF;

  IF bump_product_ids_param IS NOT NULL AND array_length(bump_product_ids_param, 1) > 0 THEN
    FOR bump_rec IN
      SELECT
        p.id,
        p.name,
        ob.id as order_bump_id,
        COALESCE(ob.access_duration_days, p.auto_grant_duration_days) as auto_grant_duration_days,
        COALESCE(ob.bump_price, p.price) as price,
        p.currency
      FROM unnest(bump_product_ids_param) AS bid(id)
      JOIN public.products p ON p.id = bid.id
      JOIN public.order_bumps ob ON ob.bump_product_id = p.id AND ob.main_product_id = product_id_param
      WHERE coalesce(allow_inactive_product_param, false) OR (p.is_active AND ob.is_active)
    LOOP
      total_bump_price := total_bump_price + bump_rec.price;
      bump_count := bump_count + 1;
      bump_ids_found := array_append(bump_ids_found, bump_rec.id);
    END LOOP;
  END IF;

  charge_basis := CASE
    WHEN COALESCE(product_record.price_includes_vat, false) = false
         AND amount_subtotal_param IS NOT NULL
    THEN amount_subtotal_param
    ELSE amount_total
  END;

  IF product_record.price IS NOT NULL THEN
    DECLARE
      expected_total NUMERIC;   -- full price + bumps (upper bound)
      effective_total NUMERIC;  -- effective (sale-aware) price + bumps (lower bound)
    BEGIN
      expected_total := product_record.price + total_bump_price;
      effective_total := effective_unit_price + total_bump_price;

      IF product_record.allow_custom_price = true THEN
        IF charge_basis < ((COALESCE(product_record.custom_price_min, 0) + total_bump_price) * minor_factor) THEN
          RAISE EXCEPTION 'Amount below minimum: got % (minor units), minimum is % (minor units)',
            charge_basis, ((COALESCE(product_record.custom_price_min, 0) + total_bump_price) * minor_factor);
        END IF;
      ELSIF coupon_id_param IS NULL THEN
        IF charge_basis < (effective_total * minor_factor) OR charge_basis > (expected_total * minor_factor) THEN
          RAISE EXCEPTION 'Amount mismatch: expected between % and % (minor units) (effective % + bumps %), got % (minor units)',
            (effective_total * minor_factor),
            (expected_total * minor_factor),
            (effective_unit_price * minor_factor),
            (total_bump_price * minor_factor),
            charge_basis;
        END IF;
      ELSE
        IF charge_basis <= 0 THEN
          RAISE EXCEPTION 'Invalid amount with coupon: amount cannot be zero or negative';
        END IF;

        IF charge_basis > (expected_total * minor_factor) THEN
          RAISE EXCEPTION 'Amount too high with coupon: got % (minor units) but max possible is % (minor units)',
            charge_basis, (expected_total * minor_factor);
        END IF;
      END IF;
    END;
  END IF;

  IF product_record.allow_custom_price = true THEN
    main_line_item_price := (charge_basis / minor_factor) - total_bump_price;
    IF main_line_item_price < 0 THEN
      RAISE EXCEPTION 'Invalid PWYW line item amount: amount % (minor units) is lower than bump total %',
        charge_basis, total_bump_price;
    END IF;
  ELSE
    main_line_item_price := effective_unit_price;
  END IF;

  SELECT id INTO existing_user_id FROM auth.users WHERE email = customer_email_param AND email_confirmed_at IS NOT NULL;

  IF product_record.auto_grant_duration_days IS NOT NULL THEN
    access_expires_at := NOW() + (product_record.auto_grant_duration_days || ' days')::INTERVAL;
  END IF;

  BEGIN
    IF current_user_id IS NULL AND existing_user_id IS NOT NULL THEN
      current_user_id := existing_user_id;
    END IF;

    SELECT pt.id INTO pending_transaction_id
    FROM public.payment_transactions pt
    WHERE (pt.stripe_payment_intent_id = pi_param OR pt.session_id = session_id_param)
      AND pt.status = 'pending'
    LIMIT 1;

    IF pending_transaction_id IS NOT NULL THEN
      UPDATE public.payment_transactions
      SET
        status = 'completed',
        fulfillment_pending = true,
        user_id = current_user_id,
        customer_email = customer_email_param,
        metadata = metadata || jsonb_build_object(
          'has_bump', bump_count > 0,
          'bump_product_ids', bump_ids_found,
          'bump_count', bump_count,
          'has_coupon', coupon_id_param IS NOT NULL,
          'coupon_id', coupon_id_param,
          'converted_from_pending', true
        ),
        updated_at = NOW()
      WHERE id = pending_transaction_id
      RETURNING id INTO transaction_id_var;
    ELSE
      INSERT INTO public.payment_transactions (
        session_id, user_id, product_id, customer_email, amount, currency,
        stripe_payment_intent_id, status, fulfillment_pending, metadata
      ) VALUES (
        session_id_param, current_user_id, product_id_param, customer_email_param,
        amount_total, upper(currency_param), stripe_payment_intent_id, 'completed', true,
        jsonb_build_object(
          'has_bump', bump_count > 0,
          'bump_product_ids', bump_ids_found,
          'bump_count', bump_count,
          'has_coupon', coupon_id_param IS NOT NULL,
          'coupon_id', coupon_id_param
        )
      ) RETURNING id INTO transaction_id_var;
    END IF;

    INSERT INTO public.payment_line_items (
      transaction_id, product_id, item_type, quantity, unit_price, total_price,
      currency, product_name
    ) VALUES (
      transaction_id_var, product_id_param, 'main_product', 1,
      main_line_item_price, main_line_item_price,
      upper(currency_param), product_record.name
    );

    IF bump_count > 0 THEN
      FOR bump_rec IN
        SELECT
          p.id,
          p.name,
          ob.id as order_bump_id,
          ob.access_duration_days as access_duration_override,
          COALESCE(ob.bump_price, p.price) as price,
          p.currency
        FROM unnest(bump_ids_found) AS bid(id)
        JOIN public.products p ON p.id = bid.id
        JOIN public.order_bumps ob ON ob.bump_product_id = p.id AND ob.main_product_id = product_id_param
        WHERE coalesce(allow_inactive_product_param, false) OR (p.is_active AND ob.is_active)
      LOOP
        INSERT INTO public.payment_line_items (
          transaction_id, product_id, item_type, quantity, unit_price, total_price,
          currency, product_name, order_bump_id, access_duration_override
        ) VALUES (
          transaction_id_var, bump_rec.id, 'order_bump', 1,
          bump_rec.price, bump_rec.price,
          upper(COALESCE(bump_rec.currency, currency_param)), bump_rec.name,
          bump_rec.order_bump_id, bump_rec.access_duration_override
        );
      END LOOP;
    END IF;

    RETURN public._order_grant_and_record(transaction_id_var, current_user_id, existing_user_id,
      user_id_param, coupon_id_param, 'consume_reservation');

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_process_stripe_payment_completion_with_bump_impl error: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Payment processing failed. Please try again or contact support.',
      'code', SQLSTATE
    );
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s';
REVOKE EXECUTE ON FUNCTION public._process_stripe_payment_completion_with_bump_impl(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._process_stripe_payment_completion_with_bump_impl(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric,boolean) TO service_role;

CREATE FUNCTION public.process_stripe_payment_completion_with_bump(
  session_id_param text, product_id_param uuid, customer_email_param text,
  amount_total numeric, currency_param text,
  stripe_payment_intent_id text DEFAULT NULL, user_id_param uuid DEFAULT NULL,
  bump_product_ids_param uuid[] DEFAULT NULL, coupon_id_param uuid DEFAULT NULL,
  amount_subtotal_param numeric DEFAULT NULL,
  allow_inactive_product_param boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  pi_param text := stripe_payment_intent_id;
  tx public.payment_transactions%ROWTYPE;
  result jsonb;
  full_bumps uuid[];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(coalesce(pi_param, session_id_param)));
  SELECT pt.* INTO tx FROM public.payment_transactions pt
    WHERE pt.session_id = session_id_param OR (pi_param IS NOT NULL AND pt.stripe_payment_intent_id = pi_param)
    ORDER BY (pt.session_id = session_id_param) DESC LIMIT 1 FOR UPDATE;

  IF tx.id IS NOT NULL THEN
    IF tx.payment_provider <> 'stripe'
       OR tx.product_id IS DISTINCT FROM product_id_param
       OR upper(tx.currency) IS DISTINCT FROM upper(currency_param)
       OR (tx.stripe_payment_intent_id IS NOT NULL AND tx.stripe_payment_intent_id IS DISTINCT FROM pi_param)
       OR (tx.session_id LIKE 'cs_%' AND session_id_param LIKE 'cs_%' AND tx.session_id <> session_id_param)
       OR tx.status NOT IN ('pending', 'abandoned', 'completed')
       OR (tx.status = 'completed' AND (tx.amount IS DISTINCT FROM amount_total OR lower(tx.customer_email) IS DISTINCT FROM lower(trim(customer_email_param))))
    THEN
      RETURN jsonb_build_object('success', false, 'error', 'Order details do not match', 'error_kind', 'data');
    END IF;
    IF EXISTS (SELECT 1 FROM public.payment_transactions pt
      WHERE pt.id <> tx.id AND (pt.session_id = session_id_param OR pt.stripe_payment_intent_id = pi_param)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Order records need review', 'error_kind', 'data');
    END IF;
    IF tx.session_id LIKE 'cs_%' THEN session_id_param := tx.session_id; END IF;
    IF jsonb_typeof(tx.metadata->'bump_product_ids_full') = 'array' THEN
      SELECT array_agg(value::uuid) INTO full_bumps
        FROM jsonb_array_elements_text(tx.metadata->'bump_product_ids_full');
      IF coalesce(cardinality(full_bumps), 0) > coalesce(cardinality(bump_product_ids_param), 0) THEN
        bump_product_ids_param := full_bumps;
      END IF;
    END IF;
  END IF;

  -- Attach the order and complete it within one savepoint.
  BEGIN
    IF tx.id IS NOT NULL THEN
      UPDATE public.payment_transactions SET
        stripe_payment_intent_id = coalesce(pi_param, tx.stripe_payment_intent_id),
        session_id = session_id_param,
        status = CASE WHEN status = 'abandoned' THEN 'pending' ELSE status END,
        amount = CASE WHEN status IN ('pending', 'abandoned') THEN amount_total ELSE amount END,
        currency = upper(currency_param)
      WHERE id = tx.id;
      IF tx.session_id <> session_id_param THEN
        UPDATE public.guest_purchases SET session_id = session_id_param
        WHERE session_id = tx.session_id AND product_id = tx.product_id;
      END IF;
    END IF;
    result := public._process_stripe_payment_completion_with_bump_impl(
      session_id_param, product_id_param, lower(trim(customer_email_param)), amount_total,
      currency_param, pi_param, user_id_param, bump_product_ids_param, coupon_id_param, amount_subtotal_param,
      allow_inactive_product_param
    );
    IF NOT coalesce((result->>'success')::boolean, false) THEN
      RAISE EXCEPTION USING MESSAGE = 'Completion not accepted', DETAIL = result::text;
    END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Completion not accepted' THEN
      GET STACKED DIAGNOSTICS result = PG_EXCEPTION_DETAIL;
      RETURN result::jsonb || jsonb_build_object('error_kind', CASE WHEN result->>'error' = 'Rate limit exceeded' OR result->>'code' IN ('40001','40P01','57014') THEN 'transient' ELSE 'data' END);
    END IF;
    RAISE;
  END;

  SELECT pt.* INTO tx FROM public.payment_transactions pt WHERE pt.session_id = session_id_param;
  IF result->>'message' = 'Payment already processed (idempotent)'
     OR result->>'scenario' = 'idempotent_claimed_for_logged_in_user' THEN
    result := result || jsonb_build_object('already_had_access', true);
  END IF;
  RETURN result || jsonb_build_object('transaction_id', tx.id, 'session_id', tx.session_id,
    'bump_product_ids', coalesce(bump_product_ids_param, '{}'::uuid[]),
    'pricing_source', CASE WHEN tx.pricing_snapshot_version IS NULL THEN 'legacy' ELSE 'snapshot' END);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric,boolean) TO service_role;

-- ===== Invoice recipient settings =====
-- ===== Source: 20261116110000_invoice_recipient_setting_atomic.sql =====
-- The shop setting "collect a different invoice recipient" and its audit entry
-- are saved in ONE transaction. The shop_config row is locked, only the one key in custom_settings is
-- changed (jsonb_set — other keys and parallel changes of other settings stay), and the audit_log
-- insert runs in the same statement: when it fails (e.g. performed_by is not an auth user) nothing is
-- saved and the caller gets the error. Shared by the panel action and PATCH /api/v1/settings/checkout.
--
-- @see admin-panel/src/lib/checkout/invoice-recipient-setting.ts

CREATE FUNCTION public.set_invoice_recipient_enabled(
  p_enabled BOOLEAN,
  p_performed_by UUID,
  p_details JSONB DEFAULT '{}'::jsonb
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.shop_config;
  v_previous BOOLEAN;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL OR p_performed_by IS NULL
     OR (p_details IS NOT NULL AND jsonb_typeof(p_details) <> 'object') THEN
    RAISE EXCEPTION 'Invalid setting change' USING ERRCODE = '22023';
  END IF;

  -- Fresh install: create the singleton row (shop_config_singleton_idx) without racing another call.
  INSERT INTO public.shop_config DEFAULT VALUES ON CONFLICT DO NOTHING;
  SELECT * INTO v_row FROM public.shop_config LIMIT 1 FOR UPDATE;

  v_previous := coalesce(v_row.custom_settings -> 'invoice_recipient_enabled' = 'true'::jsonb, false);

  UPDATE public.shop_config
  SET custom_settings = jsonb_set(
        CASE WHEN jsonb_typeof(custom_settings) = 'object' THEN custom_settings ELSE '{}'::jsonb END,
        '{invoice_recipient_enabled}', to_jsonb(p_enabled), true),
      updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.audit_log (table_name, operation, user_id, performed_by, old_values, new_values)
  VALUES (
    'shop_config', 'UPDATE', p_performed_by, p_performed_by,
    jsonb_build_object('invoice_recipient_enabled', v_previous),
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('invoice_recipient_enabled', p_enabled)
  );

  RETURN v_previous;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_invoice_recipient_enabled(BOOLEAN, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_invoice_recipient_enabled(BOOLEAN, UUID, JSONB) TO service_role;

-- ===== Affiliates and co-creators =====
-- ===== Source: 20261117100000_affiliate_cocreator.sql =====
-- Co-creator commission: the seller gives one person a fixed share of a one-time product,
-- without any coupon. It is added on top of a partner commission on the same line (also when it is
-- the same person). Shares accrue from purchases made after the assignment only; payouts of
-- co-creator shares wait until that person accepts the separate creator terms.
-- @see admin-panel/src/lib/affiliates/cocreator/service.ts
-- @see admin-panel/tests/affiliates/cocreator/database.test.ts

-- ===== MEMBERSHIPS: PARTNER ROLE AND CREATOR TERMS =====
-- A membership is the payee. A co-creator who never applied as a partner gets one with
-- is_partner=false (no partner terms, cannot own coupons).

ALTER TABLE public.affiliate_memberships
  ADD COLUMN is_partner boolean NOT NULL DEFAULT true,
  ADD COLUMN creator_terms_version text,
  ADD COLUMN creator_accepted_at timestamptz,
  ALTER COLUMN accepted_terms_version DROP NOT NULL,
  ALTER COLUMN accepted_at DROP NOT NULL;
ALTER TABLE public.affiliate_memberships DROP CONSTRAINT affiliate_memberships_accepted_terms_version_check;
ALTER TABLE public.affiliate_memberships
  ADD CONSTRAINT affiliate_memberships_accepted_terms_version_check
    CHECK (accepted_terms_version IS NULL OR public.affiliate_valid_reference(accepted_terms_version)),
  ADD CONSTRAINT affiliate_memberships_partner_terms
    CHECK (NOT is_partner OR (accepted_terms_version IS NOT NULL AND accepted_at IS NOT NULL)),
  ADD CONSTRAINT affiliate_memberships_creator_terms
    CHECK ((creator_terms_version IS NULL) = (creator_accepted_at IS NULL)
      AND (creator_terms_version IS NULL OR public.affiliate_valid_reference(creator_terms_version)));

-- ===== CREATOR TERMS (append-only, newest row is current) =====

CREATE TABLE public.affiliate_creator_terms (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  terms_version text NOT NULL UNIQUE CHECK (public.affiliate_valid_reference(terms_version)),
  terms jsonb NOT NULL CHECK (public.affiliate_valid_program(terms, '{}'::jsonb)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER affiliate_creator_terms_guard BEFORE UPDATE OR DELETE ON public.affiliate_creator_terms
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_immutable();
ALTER TABLE public.affiliate_creator_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_creator_terms_service ON public.affiliate_creator_terms FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
REVOKE ALL ON public.affiliate_creator_terms FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.affiliate_creator_terms TO service_role;

-- ===== CO-CREATOR RULES (append-only revisions per product; member NULL = no co-creator) =====

CREATE TABLE public.affiliate_cocreator_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  member_id uuid REFERENCES public.affiliate_memberships(id),
  percentage_bps integer CHECK (percentage_bps BETWEEN 1 AND 10000),
  fixed_minor bigint CHECK (fixed_minor > 0),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, revision),
  CHECK ((member_id IS NULL AND percentage_bps IS NULL AND fixed_minor IS NULL AND currency IS NULL)
    OR (member_id IS NOT NULL AND ((percentage_bps IS NOT NULL AND fixed_minor IS NULL AND currency IS NULL)
      OR (percentage_bps IS NULL AND fixed_minor IS NOT NULL AND currency IS NOT NULL))))
);
CREATE INDEX affiliate_cocreator_member ON public.affiliate_cocreator_rules(member_id);
CREATE INDEX affiliate_cocreator_time ON public.affiliate_cocreator_rules(product_id, created_at DESC, revision DESC);
-- Append-only like partner rules; removed only together with a permanently deleted product
-- (remove_product_as refuses that while any commission exists).
CREATE TRIGGER affiliate_cocreator_rules_guard BEFORE UPDATE OR DELETE ON public.affiliate_cocreator_rules
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_rule_guard();
ALTER TABLE public.affiliate_cocreator_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY affiliate_cocreator_rules_service ON public.affiliate_cocreator_rules FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
REVOKE ALL ON public.affiliate_cocreator_rules FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.affiliate_cocreator_rules TO service_role;

-- ===== COMMISSIONS: KIND =====

ALTER TABLE public.affiliate_commissions
  ADD COLUMN kind text NOT NULL DEFAULT 'referral' CHECK (kind IN ('referral', 'cocreator')),
  ADD COLUMN cocreator_rule_id uuid REFERENCES public.affiliate_cocreator_rules(id),
  ALTER COLUMN rule_id DROP NOT NULL,
  ALTER COLUMN binding_id DROP NOT NULL;
ALTER TABLE public.affiliate_commissions
  ADD CONSTRAINT affiliate_commissions_source CHECK (
    (kind = 'referral' AND rule_id IS NOT NULL AND binding_id IS NOT NULL AND cocreator_rule_id IS NULL)
    OR (kind = 'cocreator' AND rule_id IS NULL AND binding_id IS NULL AND cocreator_rule_id IS NOT NULL)),
  DROP CONSTRAINT affiliate_commissions_payment_id_line_item_id_livemode_key,
  ADD CONSTRAINT affiliate_commissions_line_kind UNIQUE (payment_id, line_item_id, livemode, kind);
CREATE INDEX affiliate_commission_cocreator_rule ON public.affiliate_commissions(cocreator_rule_id);

-- ===== FUNCTIONS =====

-- True when a line of the payment is a one-time product that has (or had) a co-creator.
-- The rule in force at the session time is decided by affiliate_apply_sync.
CREATE FUNCTION public.affiliate_cocreator_candidate(p_payment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM public.payment_line_items l JOIN public.products p ON p.id = l.product_id
    WHERE l.transaction_id = p_payment AND p.product_type = 'one_time'
      AND EXISTS(SELECT 1 FROM public.affiliate_cocreator_rules r WHERE r.product_id = l.product_id AND r.member_id IS NOT NULL));
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_cocreator_candidate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_cocreator_candidate(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.affiliate_check_relations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.affiliate_commissions; p public.affiliate_payouts; l public.affiliate_ledger; total numeric;
BEGIN
 IF TG_TABLE_NAME='affiliate_commissions' THEN
  SELECT * INTO c FROM public.affiliate_commissions WHERE id=NEW.id;
  IF c.kind='cocreator' THEN
   IF NOT EXISTS(SELECT 1 FROM public.payment_line_items li JOIN public.affiliate_cocreator_rules r ON r.id=c.cocreator_rule_id
    JOIN public.payment_transactions pt ON pt.id=c.payment_id
    WHERE li.id=c.line_item_id AND li.transaction_id=c.payment_id AND li.product_id=r.product_id
     AND upper(li.currency)=c.currency AND upper(pt.currency)=c.currency AND r.member_id=c.member_id) THEN
    RAISE EXCEPTION 'Commission references differ' USING ERRCODE='23514'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.payment_line_items li JOIN public.affiliate_rules r ON r.id=c.rule_id
   JOIN public.affiliate_coupon_bindings b ON b.id=c.binding_id
   JOIN public.payment_transactions pt ON pt.id=c.payment_id
   WHERE li.id=c.line_item_id AND li.transaction_id=c.payment_id AND li.product_id=r.product_id
    AND upper(li.currency)=c.currency AND upper(pt.currency)=c.currency AND b.member_id=c.member_id) THEN
   RAISE EXCEPTION 'Commission references differ' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='affiliate_ledger' THEN
  SELECT * INTO l FROM public.affiliate_ledger WHERE id=NEW.id;
  IF l.commission_id IS NOT NULL THEN
   SELECT * INTO c FROM public.affiliate_commissions WHERE id=l.commission_id;
   IF l.member_id<>c.member_id OR l.currency<>c.currency OR (l.kind='accrual' AND l.amount_minor<>c.accrued_minor) THEN RAISE EXCEPTION 'Entry references differ' USING ERRCODE='23514'; END IF;
   SELECT coalesce(sum(amount_minor),0) INTO total FROM public.affiliate_ledger WHERE commission_id=c.id AND kind<>'manual_adjustment';
   IF total<0 OR total>c.accrued_minor THEN RAISE EXCEPTION 'Automatic total outside commission' USING ERRCODE='23514'; END IF;
   IF c.dispute_seen AND (SELECT coalesce(sum(amount_minor),0) FROM public.affiliate_ledger WHERE commission_id=c.id AND kind='manual_adjustment')>c.accrued_minor THEN
    RAISE EXCEPTION 'Adjustment outside commission' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO p FROM public.affiliate_payouts WHERE id=l.payout_id;
   IF l.member_id<>p.member_id OR l.currency<>p.currency OR l.amount_minor<>-p.earnings_minor OR p.status<>'paid' THEN
    RAISE EXCEPTION 'Settlement differs' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='affiliate_payouts' THEN
  SELECT * INTO p FROM public.affiliate_payouts WHERE id=NEW.id;
 ELSE
  SELECT * INTO p FROM public.affiliate_payouts WHERE id=NEW.payout_id;
 END IF;
 IF p.id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger e ON e.id=a.entry_id
    WHERE a.payout_id=p.id AND (e.member_id<>p.member_id OR e.currency<>p.currency OR e.kind='settlement' OR NOT EXISTS(SELECT 1 FROM public.affiliate_commissions comm WHERE comm.id=e.commission_id AND comm.livemode=p.livemode)))
   OR (SELECT coalesce(sum(e.amount_minor),0) FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger e ON e.id=a.entry_id
    WHERE a.payout_id=p.id AND a.released_at IS NULL)<>(CASE WHEN p.status='cancelled' THEN 0 ELSE p.earnings_minor END)
   OR (p.status='paid' AND NOT EXISTS(SELECT 1 FROM public.affiliate_ledger WHERE payout_id=p.id)) THEN
   RAISE EXCEPTION 'Payout allocation differs' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_check_relations() FROM PUBLIC, anon, authenticated;

-- Paid payments with a co-creator line are queued like coupon payments.
CREATE OR REPLACE FUNCTION public.affiliate_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid uuid; disputed boolean;
BEGIN
 IF TG_TABLE_NAME='coupon_redemptions' THEN
  pid:=NEW.transaction_id;
  IF NOT EXISTS(SELECT 1 FROM public.affiliate_coupon_bindings WHERE coupon_id=NEW.coupon_id) THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='payment_line_items' THEN
  pid:=NEW.transaction_id;
  -- Unpaid orders are queued later by the payment status change.
  IF NOT EXISTS(SELECT 1 FROM public.payment_transactions WHERE id=pid AND status IN ('completed','refunded','disputed'))
   OR NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id=NEW.product_id AND p.product_type='one_time'
    AND EXISTS(SELECT 1 FROM public.affiliate_cocreator_rules r WHERE r.product_id=p.id AND r.member_id IS NOT NULL)) THEN RETURN NEW; END IF;
 ELSE
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.refunded_amount IS NOT DISTINCT FROM OLD.refunded_amount
    AND NEW.fulfillment_pending IS NOT DISTINCT FROM OLD.fulfillment_pending THEN RETURN NEW; END IF;
  pid:=NEW.id;
  IF NOT EXISTS(SELECT 1 FROM public.coupon_redemptions r JOIN public.affiliate_coupon_bindings b ON b.coupon_id=r.coupon_id WHERE r.transaction_id=pid)
   AND NOT EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=pid)
   AND NOT public.affiliate_cocreator_candidate(pid) THEN RETURN NEW; END IF;
 END IF;
 IF pid IS NULL THEN RETURN NEW; END IF;
 SELECT status='disputed' INTO disputed FROM public.payment_transactions WHERE id=pid;
 INSERT INTO public.affiliate_work(payment_id,status,dispute_seen) VALUES(pid,'pending',disputed)
 ON CONFLICT(payment_id) DO UPDATE SET requested_generation=public.affiliate_work.requested_generation+1,
  dispute_seen=public.affiliate_work.dispute_seen OR excluded.dispute_seen,
  status=CASE WHEN public.affiliate_work.status='leased' THEN 'leased' ELSE 'pending' END,next_attempt_at=now();
 UPDATE public.affiliate_payouts p SET needs_review=true,version=version+1
 WHERE p.status='reserved' AND NOT p.needs_review AND EXISTS(
  SELECT 1 FROM public.affiliate_payout_allocations a JOIN public.affiliate_ledger l ON l.id=a.entry_id
  JOIN public.affiliate_commissions c ON c.id=l.commission_id
  WHERE a.payout_id=p.id AND c.payment_id=pid AND a.released_at IS NULL);
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_enqueue() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER affiliate_line_enqueue AFTER INSERT ON public.payment_line_items
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_enqueue();

CREATE OR REPLACE FUNCTION public.affiliate_complete_unbound_work(p_payment uuid,p_token uuid,p_generation bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM 1 FROM public.payment_transactions WHERE id=p_payment FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.coupon_redemptions r JOIN public.affiliate_coupon_bindings b ON b.coupon_id=r.coupon_id WHERE r.transaction_id=p_payment)
  OR EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=p_payment)
  OR public.affiliate_cocreator_candidate(p_payment) THEN RETURN false; END IF;
 UPDATE public.affiliate_work SET processed_generation=p_generation,
  status=CASE WHEN requested_generation>p_generation THEN 'pending' ELSE 'done' END,
  lease_token=NULL,leased_until=NULL,last_error_code=NULL,attempts=0,next_attempt_at=now()
 WHERE payment_id=p_payment AND status='leased' AND lease_token=p_token AND leased_until>now()
  AND p_generation>processed_generation AND p_generation<=requested_generation;
 RETURN FOUND;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_complete_unbound_work(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_complete_unbound_work(uuid,uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.affiliate_apply_sync(p_payment uuid,p_token uuid,p_generation bigint,p_session_created_at timestamptz,p_livemode boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pt public.payment_transactions; w public.affiliate_work; b public.affiliate_coupon_bindings;
 prog public.affiliate_programs; rule public.affiliate_rules; cprog public.affiliate_programs; crule public.affiliate_cocreator_rules;
 c public.affiliate_commissions; li record; red public.coupon_redemptions; member_status text;
 base bigint; earned bigint; target bigint; automatic numeric; loss bigint; delta bigint; paid timestamptz;
 self_match boolean; mature timestamptz; waiting boolean:=false; net_missing boolean:=false; blocked boolean:=false; creator_due boolean;
BEGIN
 SELECT * INTO pt FROM public.payment_transactions WHERE id=p_payment FOR UPDATE;
 SELECT * INTO w FROM public.affiliate_work WHERE payment_id=p_payment FOR UPDATE;
 IF w.payment_id IS NULL OR p_token IS NULL OR p_generation IS NULL OR w.status<>'leased' OR w.lease_token IS DISTINCT FROM p_token OR w.leased_until<=now()
  OR p_generation>w.requested_generation OR p_generation<=w.processed_generation THEN RETURN false; END IF;
 IF p_session_created_at IS NULL OR p_session_created_at>now() OR p_livemode IS NULL THEN
  RAISE EXCEPTION 'Session required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=p_payment
  AND (session_created_at<>p_session_created_at OR livemode<>p_livemode)) THEN
  RAISE EXCEPTION 'Session differs' USING ERRCODE='23514'; END IF;
 SELECT * INTO red FROM public.coupon_redemptions WHERE transaction_id=p_payment ORDER BY redeemed_at,id LIMIT 1;
 IF red.id IS NOT NULL THEN
  SELECT * INTO b FROM public.affiliate_coupon_bindings WHERE coupon_id=red.coupon_id
   AND created_at<=p_session_created_at AND (retired_at IS NULL OR retired_at>p_session_created_at) ORDER BY version DESC LIMIT 1;
 END IF;
 IF b.id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(b.member_id::text||upper(pt.currency),0));
  SELECT v.program_id,true,v.enabled,v.version,v.hold_days,v.buffer_days,v.terms_version,v.terms,v.thresholds
   INTO prog FROM public.affiliate_program_versions v WHERE v.created_at<=p_session_created_at
   ORDER BY v.created_at DESC,v.version DESC LIMIT 1;
  SELECT e.status INTO member_status FROM public.affiliate_membership_events e
   WHERE e.member_id=b.member_id AND e.created_at<=p_session_created_at ORDER BY e.created_at DESC,e.version DESC LIMIT 1;
  IF prog.id IS NULL OR member_status IS NULL THEN
   UPDATE public.affiliate_work SET status='needs_review',lease_token=NULL,leased_until=NULL,last_error_code='history_unavailable'
    WHERE payment_id=p_payment;
   RETURN false;
  END IF;
 END IF;
 IF pt.amount<>trunc(pt.amount) OR coalesce(pt.refunded_amount,0)<>trunc(coalesce(pt.refunded_amount,0)) THEN
  RAISE EXCEPTION 'Integer amounts required' USING ERRCODE='23514'; END IF;
 -- Existing corrections remain processable while new lines await fulfillment.
 FOR c IN SELECT * FROM public.affiliate_commissions WHERE payment_id=p_payment ORDER BY member_id,currency,id FOR UPDATE LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(c.member_id::text||c.currency,0));
  blocked:=c.dispute_seen OR w.dispute_seen OR pt.status='disputed';
  loss:=CASE WHEN c.base_minor=0 THEN 0 ELSE round(c.base_minor::numeric*least(pt.amount,greatest(0,coalesce(pt.refunded_amount,0)))/pt.amount)::bigint END;
  target:=CASE WHEN blocked OR c.base_minor=0 THEN 0 ELSE greatest(0,c.accrued_minor-round(c.accrued_minor::numeric*loss/c.base_minor)::bigint) END;
  SELECT coalesce(sum(amount_minor),0) INTO automatic FROM public.affiliate_ledger WHERE commission_id=c.id AND kind<>'manual_adjustment';
  delta:=target-automatic;
  IF delta<>0 THEN
   INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key)
    VALUES(c.member_id,c.id,CASE WHEN delta>0 THEN 'restoration' ELSE 'reversal' END,delta,c.currency,'sync:'||c.id||':'||p_generation);
  END IF;
  UPDATE public.affiliate_commissions SET observed_refunded_gross=coalesce(pt.refunded_amount,0)::bigint,observed_status=pt.status,
   dispute_seen=blocked,version=version+1 WHERE id=c.id;
  PERFORM public.affiliate_audit('affiliate_commissions',to_jsonb(c),(SELECT to_jsonb(updated) FROM public.affiliate_commissions updated WHERE id=c.id),NULL);
 END LOOP;
 IF b.id IS NOT NULL AND prog.enabled AND member_status='approved' AND pt.status IN ('completed','refunded','disputed') THEN
  SELECT EXISTS(SELECT 1 FROM public.affiliate_memberships am JOIN auth.users u ON u.id=am.user_id
   WHERE am.id=b.member_id AND (u.id=pt.user_id OR lower(btrim(u.email))=lower(btrim(pt.customer_email)))) INTO self_match;
  waiting:=pt.fulfillment_pending;
  net_missing:=NOT waiting AND EXISTS(
   SELECT 1 FROM public.payment_line_items l JOIN public.products p ON p.id=l.product_id
   CROSS JOIN LATERAL (SELECT r.enabled,r.currency FROM public.affiliate_rules r
    WHERE r.product_id=l.product_id AND r.created_at<=p_session_created_at ORDER BY r.created_at DESC,r.revision DESC LIMIT 1) r
   WHERE l.transaction_id=p_payment AND p.product_type='one_time' AND r.enabled
    AND (r.currency IS NULL OR r.currency=upper(l.currency)) AND l.net_amount IS NULL);
  IF NOT waiting AND NOT net_missing THEN
   FOR li IN SELECT l.*,p.is_refundable,p.refund_period_days,p.product_type FROM public.payment_line_items l
    JOIN public.products p ON p.id=l.product_id WHERE l.transaction_id=p_payment ORDER BY l.id LOOP
    IF li.product_type<>'one_time' THEN CONTINUE; END IF;
    SELECT * INTO rule FROM public.affiliate_rules WHERE product_id=li.product_id AND created_at<=p_session_created_at
     ORDER BY created_at DESC,revision DESC LIMIT 1;
    IF rule.id IS NULL OR NOT rule.enabled OR (rule.currency IS NOT NULL AND rule.currency<>upper(li.currency)) THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=p_payment AND line_item_id=li.id AND livemode=p_livemode AND kind='referral') THEN CONTINUE; END IF;
    base:=li.net_amount;
    earned:=CASE WHEN self_match THEN 0 WHEN rule.percentage_bps IS NOT NULL THEN round(base::numeric*rule.percentage_bps/10000)::bigint ELSE least(base,rule.fixed_minor) END;
    mature:=CASE WHEN li.is_refundable AND li.refund_period_days IS NULL THEN NULL ELSE
     red.redeemed_at+greatest(prog.hold_days,CASE WHEN li.is_refundable THEN li.refund_period_days+prog.buffer_days ELSE 0 END)*interval '1 day' END;
    INSERT INTO public.affiliate_commissions(payment_id,line_item_id,member_id,rule_id,binding_id,livemode,session_created_at,paid_at,
     currency,base_minor,accrued_minor,self_referral,is_refundable,refund_period_days,hold_days,buffer_days,eligible_at,observed_refunded_gross,observed_status,dispute_seen)
    VALUES(p_payment,li.id,b.member_id,rule.id,b.id,p_livemode,p_session_created_at,red.redeemed_at,upper(li.currency),base,earned,self_match,
     li.is_refundable,li.refund_period_days,prog.hold_days,prog.buffer_days,mature,coalesce(pt.refunded_amount,0)::bigint,pt.status,w.dispute_seen OR pt.status='disputed') RETURNING * INTO c;
    PERFORM public.affiliate_audit('affiliate_commissions',NULL,to_jsonb(c),NULL);
    IF earned>0 THEN
     INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key)
     VALUES(c.member_id,c.id,'accrual',earned,c.currency,'accrual:'||c.id);
     loss:=CASE WHEN base=0 THEN 0 ELSE round(base::numeric*least(pt.amount,greatest(0,coalesce(pt.refunded_amount,0)))/pt.amount)::bigint END;
     target:=CASE WHEN c.dispute_seen THEN 0 ELSE greatest(0,earned-round(earned::numeric*loss/base)::bigint) END;
     IF target<earned THEN
      INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key)
      VALUES(c.member_id,c.id,'reversal',target-earned,c.currency,'sync:'||c.id||':'||p_generation);
     END IF;
    END IF;
   END LOOP;
  END IF;
 ELSIF b.id IS NOT NULL AND pt.status NOT IN ('completed','refunded','disputed') THEN waiting:=true;
 END IF;
 -- Co-creator shares: no coupon; the rule in force when the checkout session started (never retroactive).
 -- Unpaid orders and pending fulfilment are queued again by the payment change itself.
 SELECT EXISTS(SELECT 1 FROM public.payment_line_items l JOIN public.products p ON p.id=l.product_id
  CROSS JOIN LATERAL (SELECT r.member_id,r.currency FROM public.affiliate_cocreator_rules r
   WHERE r.product_id=l.product_id AND r.created_at<=p_session_created_at ORDER BY r.created_at DESC,r.revision DESC LIMIT 1) r
  WHERE l.transaction_id=p_payment AND p.product_type='one_time' AND r.member_id IS NOT NULL
   AND (r.currency IS NULL OR r.currency=upper(l.currency))
   AND NOT EXISTS(SELECT 1 FROM public.affiliate_commissions x WHERE x.payment_id=p_payment AND x.line_item_id=l.id AND x.livemode=p_livemode AND x.kind='cocreator'))
  INTO creator_due;
 IF creator_due AND NOT waiting AND NOT net_missing AND pt.status IN ('completed','refunded','disputed') AND NOT pt.fulfillment_pending THEN
  net_missing:=EXISTS(SELECT 1 FROM public.payment_line_items l JOIN public.products p ON p.id=l.product_id
   CROSS JOIN LATERAL (SELECT r.member_id,r.currency FROM public.affiliate_cocreator_rules r
    WHERE r.product_id=l.product_id AND r.created_at<=p_session_created_at ORDER BY r.created_at DESC,r.revision DESC LIMIT 1) r
   WHERE l.transaction_id=p_payment AND p.product_type='one_time' AND r.member_id IS NOT NULL
    AND (r.currency IS NULL OR r.currency=upper(l.currency)) AND l.net_amount IS NULL);
  IF NOT net_missing THEN
   SELECT v.program_id,true,v.enabled,v.version,v.hold_days,v.buffer_days,v.terms_version,v.terms,v.thresholds
    INTO cprog FROM public.affiliate_program_versions v WHERE v.created_at<=p_session_created_at
    ORDER BY v.created_at DESC,v.version DESC LIMIT 1;
   IF cprog.id IS NULL THEN
    UPDATE public.affiliate_work SET status='needs_review',lease_token=NULL,leased_until=NULL,last_error_code='history_unavailable'
     WHERE payment_id=p_payment;
    RETURN false;
   END IF;
   paid:=coalesce(red.redeemed_at,pt.paid_at,pt.created_at);
   FOR li IN SELECT l.*,p.is_refundable,p.refund_period_days,p.product_type FROM public.payment_line_items l
    JOIN public.products p ON p.id=l.product_id WHERE l.transaction_id=p_payment ORDER BY l.id LOOP
    IF li.product_type<>'one_time' THEN CONTINUE; END IF;
    crule:=NULL;
    SELECT * INTO crule FROM public.affiliate_cocreator_rules WHERE product_id=li.product_id AND created_at<=p_session_created_at
     ORDER BY created_at DESC,revision DESC LIMIT 1;
    IF crule.id IS NULL OR crule.member_id IS NULL OR (crule.currency IS NOT NULL AND crule.currency<>upper(li.currency)) THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM public.affiliate_commissions WHERE payment_id=p_payment AND line_item_id=li.id AND livemode=p_livemode AND kind='cocreator') THEN CONTINUE; END IF;
    member_status:=NULL;
    SELECT e.status INTO member_status FROM public.affiliate_membership_events e
     WHERE e.member_id=crule.member_id AND e.created_at<=p_session_created_at ORDER BY e.created_at DESC,e.version DESC LIMIT 1;
    -- 'pending' here only means a co-creator's own partner application awaits the seller: shares keep accruing.
    IF member_status IS NULL OR member_status NOT IN ('approved','pending') THEN CONTINUE; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(crule.member_id::text||upper(li.currency),0));
    SELECT EXISTS(SELECT 1 FROM public.affiliate_memberships am JOIN auth.users u ON u.id=am.user_id
     WHERE am.id=crule.member_id AND (u.id=pt.user_id OR lower(btrim(u.email))=lower(btrim(pt.customer_email)))) INTO self_match;
    base:=li.net_amount;
    earned:=CASE WHEN self_match THEN 0 WHEN crule.percentage_bps IS NOT NULL THEN round(base::numeric*crule.percentage_bps/10000)::bigint ELSE least(base,crule.fixed_minor) END;
    mature:=CASE WHEN li.is_refundable AND li.refund_period_days IS NULL THEN NULL ELSE
     paid+greatest(cprog.hold_days,CASE WHEN li.is_refundable THEN li.refund_period_days+cprog.buffer_days ELSE 0 END)*interval '1 day' END;
    INSERT INTO public.affiliate_commissions(payment_id,line_item_id,member_id,kind,cocreator_rule_id,livemode,session_created_at,paid_at,
     currency,base_minor,accrued_minor,self_referral,is_refundable,refund_period_days,hold_days,buffer_days,eligible_at,observed_refunded_gross,observed_status,dispute_seen)
    VALUES(p_payment,li.id,crule.member_id,'cocreator',crule.id,p_livemode,p_session_created_at,paid,upper(li.currency),base,earned,self_match,
     li.is_refundable,li.refund_period_days,cprog.hold_days,cprog.buffer_days,mature,coalesce(pt.refunded_amount,0)::bigint,pt.status,w.dispute_seen OR pt.status='disputed') RETURNING * INTO c;
    PERFORM public.affiliate_audit('affiliate_commissions',NULL,to_jsonb(c),NULL);
    IF earned>0 THEN
     INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key)
     VALUES(c.member_id,c.id,'accrual',earned,c.currency,'accrual:'||c.id);
     loss:=CASE WHEN base=0 THEN 0 ELSE round(base::numeric*least(pt.amount,greatest(0,coalesce(pt.refunded_amount,0)))/pt.amount)::bigint END;
     target:=CASE WHEN c.dispute_seen THEN 0 ELSE greatest(0,earned-round(earned::numeric*loss/base)::bigint) END;
     IF target<earned THEN
      INSERT INTO public.affiliate_ledger(member_id,commission_id,kind,amount_minor,currency,economic_key)
      VALUES(c.member_id,c.id,'reversal',target-earned,c.currency,'sync:'||c.id||':'||p_generation);
     END IF;
    END IF;
   END LOOP;
  END IF;
 END IF;
 UPDATE public.affiliate_work SET processed_generation=CASE WHEN waiting OR net_missing THEN processed_generation ELSE p_generation END,
  status=CASE WHEN net_missing THEN 'needs_review' WHEN waiting OR requested_generation>p_generation THEN 'pending' ELSE 'done' END,
  next_attempt_at=CASE WHEN waiting THEN now()+interval '1 minute' ELSE now() END,
  lease_token=NULL,leased_until=NULL,last_error_code=CASE WHEN net_missing THEN 'net_unavailable' WHEN waiting THEN 'awaiting_fulfillment' ELSE NULL END,
  attempts=CASE WHEN waiting OR net_missing THEN attempts ELSE 0 END
 WHERE payment_id=p_payment;
 RETURN NOT waiting AND NOT net_missing;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_apply_sync(uuid,uuid,bigint,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_apply_sync(uuid,uuid,bigint,timestamptz,boolean) TO service_role;

-- A co-creator who later applies as a partner keeps the same membership (and creator role); the
-- application waits for the seller like any other ('pending'), so no coupon can be bound until approval.
CREATE OR REPLACE FUNCTION public.affiliate_apply(p_user uuid,p_code text,p_display_name text,p_channel text,p_terms_version text)
RETURNS public.affiliate_memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.affiliate_memberships; prog public.affiliate_programs; old public.affiliate_memberships;
BEGIN
 IF (select auth.role()) IS DISTINCT FROM 'service_role' OR p_user IS NULL
  OR ((select auth.uid()) IS NOT NULL AND (select auth.uid())<>p_user)
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Verified account required' USING ERRCODE='42501'; END IF;
 SELECT * INTO prog FROM public.affiliate_programs FOR SHARE;
 IF NOT prog.enabled OR prog.terms_version IS DISTINCT FROM p_terms_version THEN RAISE EXCEPTION 'Terms changed' USING ERRCODE='PT409'; END IF;
 SELECT * INTO old FROM public.affiliate_memberships WHERE user_id=p_user FOR UPDATE;
 IF old.id IS NOT NULL AND NOT old.is_partner THEN
  UPDATE public.affiliate_memberships SET is_partner=true,status=CASE WHEN old.status='approved' THEN 'pending' ELSE old.status END,
   code=p_code,display_name=p_display_name,channel=p_channel,
   accepted_terms_version=p_terms_version,accepted_at=now(),version=version+1 WHERE id=old.id RETURNING * INTO result;
  INSERT INTO public.affiliate_membership_events(member_id,version,status) VALUES(result.id,result.version,result.status);
  PERFORM public.affiliate_audit('affiliate_memberships',to_jsonb(old),to_jsonb(result),p_user);
  RETURN result;
 END IF;
 INSERT INTO public.affiliate_memberships(user_id,code,display_name,channel,accepted_terms_version,accepted_at)
 VALUES(p_user,p_code,p_display_name,p_channel,p_terms_version,now()) RETURNING * INTO result;
 INSERT INTO public.affiliate_membership_events(member_id,version,status) VALUES(result.id,result.version,result.status);
 PERFORM public.affiliate_audit('affiliate_memberships',NULL,to_jsonb(result),p_user);
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_apply(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_apply(uuid,text,text,text,text) TO service_role;

-- Only partners own coupons.
CREATE OR REPLACE FUNCTION public.affiliate_binding_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM 1 FROM public.coupons WHERE id=NEW.coupon_id FOR UPDATE;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.affiliate_memberships WHERE id=NEW.member_id AND status='approved' AND is_partner AND user_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Approved member required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.affiliate_coupon_bindings b WHERE b.coupon_id=NEW.coupon_id AND b.id<>NEW.id
  AND tstzrange(b.created_at,b.retired_at,'[)') && tstzrange(NEW.created_at,NEW.retired_at,'[)')) THEN
  RAISE EXCEPTION 'Binding periods overlap' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_binding_check() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.affiliate_cocreator_set(p_actor uuid,p_product uuid,p_expected_revision integer,p_email text,
 p_display_name text,p_percentage_bps integer,p_fixed_minor bigint,p_currency text)
RETURNS public.affiliate_cocreator_rules LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.affiliate_cocreator_rules; revision integer; target uuid; m public.affiliate_memberships;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 PERFORM 1 FROM public.products WHERE id=p_product AND product_type='one_time' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'One-time product required' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.affiliate_programs) THEN RAISE EXCEPTION 'Program settings required' USING ERRCODE='22023'; END IF;
 SELECT coalesce(max(r.revision),0) INTO revision FROM public.affiliate_cocreator_rules r WHERE r.product_id=p_product;
 IF revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Revision changed' USING ERRCODE='PT409'; END IF;
 IF p_email IS NOT NULL THEN
  SELECT u.id INTO target FROM auth.users u WHERE lower(btrim(u.email))=lower(btrim(p_email)) AND u.deleted_at IS NULL
   ORDER BY u.created_at LIMIT 1;
  IF target IS NULL THEN RAISE EXCEPTION 'Account required' USING ERRCODE='P0002'; END IF;
  SELECT * INTO m FROM public.affiliate_memberships WHERE user_id=target FOR UPDATE;
  IF m.id IS NULL THEN
   INSERT INTO public.affiliate_memberships(user_id,code,status,display_name,is_partner)
    VALUES(target,'creator-'||replace(target::text,'-',''),'approved',
     left(coalesce(nullif(btrim(p_display_name),''),split_part(btrim(p_email),'@',1)),120),false) RETURNING * INTO m;
   INSERT INTO public.affiliate_membership_events(member_id,version,status) VALUES(m.id,m.version,m.status);
   PERFORM public.affiliate_audit('affiliate_memberships',NULL,to_jsonb(m),p_actor);
  -- The seller's own assignment is the approval of the creator role; a partner application still
  -- awaiting review ('pending') does not block it, a rejected/suspended/terminated membership does.
  ELSIF m.status NOT IN ('approved','pending') THEN RAISE EXCEPTION 'Approved member required' USING ERRCODE='22023';
  END IF;
 ELSIF p_percentage_bps IS NOT NULL OR p_fixed_minor IS NOT NULL OR p_currency IS NOT NULL THEN
  RAISE EXCEPTION 'Person required' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.affiliate_cocreator_rules(product_id,revision,member_id,percentage_bps,fixed_minor,currency)
  VALUES(p_product,revision+1,m.id,p_percentage_bps,p_fixed_minor,p_currency) RETURNING * INTO result;
 PERFORM public.affiliate_audit('affiliate_cocreator_rules',NULL,to_jsonb(result),p_actor);
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_cocreator_set(uuid,uuid,integer,text,text,integer,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_cocreator_set(uuid,uuid,integer,text,text,integer,bigint,text) TO service_role;

CREATE FUNCTION public.affiliate_creator_terms_publish(p_actor uuid,p_expected_version text,p_terms_version text,p_terms jsonb)
RETURNS public.affiliate_creator_terms LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current public.affiliate_creator_terms; result public.affiliate_creator_terms;
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('affiliate_creator_terms',0));
 SELECT * INTO current FROM public.affiliate_creator_terms ORDER BY id DESC LIMIT 1;
 IF current.terms_version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 IF current.terms_version=p_terms_version THEN
  IF current.terms<>p_terms THEN RAISE EXCEPTION 'Terms version changed' USING ERRCODE='PT409'; END IF;
  RETURN current;
 END IF;
 IF EXISTS(SELECT 1 FROM public.affiliate_creator_terms WHERE terms_version=p_terms_version) THEN
  RAISE EXCEPTION 'Terms version changed' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.affiliate_creator_terms(terms_version,terms) VALUES(p_terms_version,p_terms) RETURNING * INTO result;
 PERFORM public.affiliate_audit('affiliate_creator_terms',NULL,to_jsonb(result),p_actor);
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_creator_terms_publish(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_creator_terms_publish(uuid,text,text,jsonb) TO service_role;

CREATE FUNCTION public.affiliate_creator_accept(p_user uuid,p_terms_version text)
RETURNS public.affiliate_memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.affiliate_memberships; result public.affiliate_memberships; t public.affiliate_creator_terms;
BEGIN
 IF (select auth.role()) IS DISTINCT FROM 'service_role' OR p_user IS NULL
  OR ((select auth.uid()) IS NOT NULL AND (select auth.uid())<>p_user) THEN
  RAISE EXCEPTION 'Account required' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM public.affiliate_memberships WHERE user_id=p_user FOR UPDATE;
 IF old.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.affiliate_cocreator_rules WHERE member_id=old.id) THEN
  RAISE EXCEPTION 'Co-creator required' USING ERRCODE='P0002'; END IF;
 SELECT * INTO t FROM public.affiliate_creator_terms ORDER BY id DESC LIMIT 1;
 IF t.id IS NULL OR t.terms_version IS DISTINCT FROM p_terms_version THEN RAISE EXCEPTION 'Terms changed' USING ERRCODE='PT409'; END IF;
 IF old.creator_terms_version=p_terms_version THEN RETURN old; END IF;
 UPDATE public.affiliate_memberships SET creator_terms_version=p_terms_version,creator_accepted_at=now(),version=version+1
  WHERE id=old.id RETURNING * INTO result;
 INSERT INTO public.affiliate_membership_events(member_id,version,status) VALUES(result.id,result.version,result.status);
 PERFORM public.affiliate_audit('affiliate_memberships',to_jsonb(old),to_jsonb(result),p_user);
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_creator_accept(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_creator_accept(uuid,text) TO service_role;

-- One payout eligibility rule for preview, reservation and CSV export. A deduction from a commission
-- that was already paid out always counts, so switching the program off never hides partner debt.
-- Otherwise an entry needs its commission to be ready and its kind's gate open: co-creator shares
-- after the creator terms are accepted, partner shares while the partner program is enabled.
CREATE FUNCTION public.affiliate_entry_eligible(p_kind text,p_amount bigint,p_previously_paid boolean,p_ready boolean,
 p_referral_ok boolean,p_creator_ok boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT (p_amount<0 AND p_previously_paid) OR (p_ready AND CASE WHEN p_kind='cocreator' THEN p_creator_ok ELSE p_referral_ok END)
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_entry_eligible(text,bigint,boolean,boolean,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_entry_eligible(text,bigint,boolean,boolean,boolean,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.affiliate_preview(p_member uuid,p_currency text,p_cutoff timestamptz,p_livemode boolean DEFAULT true)
RETURNS TABLE(member_version text,program_version text,earnings_minor text,debt_offset_minor text,payable_minor text,held_minor text,
 threshold_minor text,sync_required boolean,available boolean,entry_ids uuid[],accrued text,reversed text,paid text,reserved text,balance text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 WITH gate AS (
  SELECT coalesce((SELECT enabled FROM public.affiliate_programs),false) AS referral_ok,
   coalesce((SELECT creator_accepted_at IS NOT NULL FROM public.affiliate_memberships WHERE id=p_member),false) AS creator_ok
 ), facts AS MATERIALIZED (
  SELECT c.id,c.kind,c.eligible_at,c.dispute_seen,c.dispute_reviewed_at,pt.status,
   (c.observed_status<>pt.status OR c.observed_refunded_gross<>coalesce(pt.refunded_amount,0)
    OR coalesce(w.status<>'done' OR w.requested_generation>w.processed_generation,false)) AS dirty,
   EXISTS(SELECT 1 FROM public.affiliate_ledger l WHERE l.commission_id=c.id AND l.kind='accrual' AND l.created_at<=p_cutoff) AS earned,
   EXISTS(SELECT 1 FROM public.affiliate_ledger l JOIN public.affiliate_payout_allocations a ON a.entry_id=l.id AND a.released_at IS NULL
    JOIN public.affiliate_payouts p ON p.id=a.payout_id AND p.status='paid' WHERE l.commission_id=c.id) AS previously_paid
  FROM public.affiliate_commissions c JOIN public.payment_transactions pt ON pt.id=c.payment_id
  LEFT JOIN public.affiliate_work w ON w.payment_id=c.payment_id
  WHERE c.member_id=p_member AND c.currency=p_currency AND c.livemode=p_livemode
 ), entries AS MATERIALIZED (
  SELECT l.id,l.commission_id,l.kind,l.amount_minor,p.status AS allocation_status,
   coalesce(a.entry_id IS NULL AND public.affiliate_entry_eligible(f.kind,l.amount_minor,f.previously_paid,
    f.earned AND f.eligible_at<=p_cutoff AND ((NOT f.dispute_seen AND f.status<>'disputed') OR f.dispute_reviewed_at IS NOT NULL),
    g.referral_ok,g.creator_ok),false) AS selectable
  FROM public.affiliate_ledger l JOIN facts f ON f.id=l.commission_id CROSS JOIN gate g
  LEFT JOIN public.affiliate_payout_allocations a ON a.entry_id=l.id AND a.released_at IS NULL
  LEFT JOIN public.affiliate_payouts p ON p.id=a.payout_id
 ), totals AS (
  SELECT coalesce(sum(amount_minor) FILTER(WHERE selectable AND amount_minor>0),0) AS earnings,
   -coalesce(sum(amount_minor) FILTER(WHERE selectable AND amount_minor<0),0) AS debt,
   coalesce(sum(amount_minor) FILTER(WHERE kind='accrual'),0) AS accrued,
   -coalesce(sum(amount_minor) FILTER(WHERE kind IN ('reversal','restoration')),0) AS reversed,
   coalesce(sum(amount_minor) FILTER(WHERE allocation_status='reserved'),0) AS reserved,
   coalesce(sum(amount_minor),0) AS balance,
   coalesce(array_agg(id ORDER BY id) FILTER(WHERE selectable),'{}'::uuid[]) AS ids
  FROM entries
 ), held AS (
  SELECT coalesce(sum(greatest(amount,0)),0) AS amount FROM (
   SELECT sum(amount_minor) AS amount FROM entries WHERE allocation_status IS NULL AND NOT selectable GROUP BY commission_id
  ) h
 ), settlements AS (
  SELECT -coalesce(sum(l.amount_minor),0) AS amount FROM public.affiliate_ledger l
  JOIN public.affiliate_payouts p ON p.id=l.payout_id WHERE l.member_id=p_member AND l.currency=p_currency AND p.livemode=p_livemode
 ), readiness AS (SELECT coalesce(bool_or(dirty),false) AS dirty FROM facts)
 SELECT m.version::text,p.version::text,t.earnings::text,t.debt::text,(t.earnings-t.debt)::text,h.amount::text,
  p.thresholds->>p_currency,r.dirty,
  m.status='approved' AND m.user_id IS NOT NULL AND NOT r.dirty
   AND p_cutoff IS NOT NULL AND p_cutoff<=now() AND p.thresholds ? p_currency
   AND t.earnings-t.debt>0 AND t.earnings-t.debt>=(p.thresholds->>p_currency)::bigint
   AND NOT EXISTS(SELECT 1 FROM public.affiliate_payouts ap WHERE ap.member_id=p_member AND ap.currency=p_currency AND ap.livemode=p_livemode AND ap.status='reserved'),
  t.ids,t.accrued::text,t.reversed::text,s.amount::text,t.reserved::text,(t.balance-s.amount)::text
 FROM public.affiliate_memberships m CROSS JOIN public.affiliate_programs p CROSS JOIN totals t
 CROSS JOIN held h CROSS JOIN settlements s CROSS JOIN readiness r WHERE m.id=p_member;
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_preview(uuid,text,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_preview(uuid,text,timestamptz,boolean) TO service_role;

-- The program switch now gates partner entries inside affiliate_preview, not the whole payout.
CREATE OR REPLACE FUNCTION public.affiliate_reserve(p_actor uuid,p_member uuid,p_currency text,p_cutoff timestamptz,p_member_version bigint,
 p_program_version bigint,p_payee_reference text,p_livemode boolean DEFAULT true)
RETURNS public.affiliate_payouts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $_$
DECLARE m public.affiliate_memberships; prog public.affiliate_programs; result public.affiliate_payouts; preview record; locked uuid[];
BEGIN
 PERFORM public.affiliate_admin(p_actor);
 SELECT * INTO preview FROM public.affiliate_preview(p_member,p_currency,p_cutoff,p_livemode);
 locked:=public.affiliate_lock_member(p_member,p_currency,ARRAY(
  SELECT DISTINCT c.payment_id FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id
   WHERE l.id=ANY(preview.entry_ids)),p_livemode);

 SELECT * INTO m FROM public.affiliate_memberships WHERE id=p_member FOR SHARE;
 SELECT * INTO prog FROM public.affiliate_programs FOR SHARE;
 IF m.id IS NULL OR m.version IS DISTINCT FROM p_member_version OR prog.version IS DISTINCT FROM p_program_version THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='PT409'; END IF;
 IF p_livemode IS NULL OR m.status<>'approved' OR m.user_id IS NULL OR p_currency !~ '^[A-Z]{3}$'
  OR p_cutoff IS NULL OR p_cutoff>now() OR NOT(prog.thresholds ? p_currency) THEN
  RAISE EXCEPTION 'Payout unavailable' USING ERRCODE='22023'; END IF;
 SELECT * INTO preview FROM public.affiliate_preview(p_member,p_currency,p_cutoff,p_livemode);
 IF preview.sync_required OR EXISTS(SELECT 1 FROM public.affiliate_ledger l JOIN public.affiliate_commissions c ON c.id=l.commission_id
  WHERE l.id=ANY(preview.entry_ids) AND NOT(c.payment_id=ANY(locked))) THEN RAISE EXCEPTION 'Sync required' USING ERRCODE='PT409'; END IF;
 IF NOT preview.available THEN RAISE EXCEPTION 'Threshold not met' USING ERRCODE='22023'; END IF;
 INSERT INTO public.affiliate_payouts(member_id,currency,earnings_minor,status,cutoff,payee_reference,livemode)
  VALUES(p_member,p_currency,preview.payable_minor::bigint,'reserved',p_cutoff,p_payee_reference,p_livemode) RETURNING * INTO result;
 INSERT INTO public.affiliate_payout_allocations(payout_id,entry_id) SELECT result.id,unnest(preview.entry_ids);
 PERFORM public.affiliate_audit('affiliate_payouts',NULL,to_jsonb(result),p_actor);
 RETURN result;
END $_$;
REVOKE EXECUTE ON FUNCTION public.affiliate_reserve(uuid,uuid,text,timestamptz,bigint,bigint,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_reserve(uuid,uuid,text,timestamptz,bigint,bigint,text,boolean) TO service_role;

-- CSV export of a reserved payout: every allocated entry must still pass the shared eligibility rule
-- (a reservation of co-creator shares exports while the partner program is off; partner shares do not).
CREATE FUNCTION public.affiliate_payout_exportable(p_payout uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT coalesce(bool_and(coalesce(public.affiliate_entry_eligible(c.kind,l.amount_minor,
   EXISTS(SELECT 1 FROM public.affiliate_ledger e JOIN public.affiliate_payout_allocations pa ON pa.entry_id=e.id AND pa.released_at IS NULL
    JOIN public.affiliate_payouts pp ON pp.id=pa.payout_id AND pp.status='paid' WHERE e.commission_id=c.id),
   true,coalesce((SELECT enabled FROM public.affiliate_programs),false),m.creator_accepted_at IS NOT NULL),false)),false)
 FROM public.affiliate_payouts p JOIN public.affiliate_memberships m ON m.id=p.member_id
 JOIN public.affiliate_payout_allocations a ON a.payout_id=p.id AND a.released_at IS NULL
 JOIN public.affiliate_ledger l ON l.id=a.entry_id JOIN public.affiliate_commissions c ON c.id=l.commission_id
 WHERE p.id=p_payout;
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_payout_exportable(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_payout_exportable(uuid) TO service_role;

-- Portal rows: product read through the purchased line (co-creator rows have no partner rule).
CREATE OR REPLACE FUNCTION public.affiliate_portal_page(p_member uuid,p_currency text DEFAULT NULL,p_cursor uuid DEFAULT NULL,p_limit integer DEFAULT 25,p_as_of timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; creator_ok boolean;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023'; END IF;
 SELECT coalesce((SELECT creator_accepted_at IS NOT NULL FROM public.affiliate_memberships WHERE id=p_member),false) INTO creator_ok;
 WITH page AS MATERIALIZED (
  SELECT c.* FROM public.affiliate_commissions c WHERE c.member_id=p_member AND (p_currency IS NULL OR c.currency=p_currency)
   AND (p_cursor IS NULL OR (c.paid_at,c.id)<(SELECT own.paid_at,own.id FROM public.affiliate_commissions own
    WHERE own.id=p_cursor AND own.member_id=p_member AND (p_currency IS NULL OR own.currency=p_currency)))
  ORDER BY c.paid_at DESC,c.id DESC LIMIT p_limit+1
 ), rows AS (
  SELECT c.id,c.paid_at,jsonb_build_object('product',coalesce(prod.name,li.product_name),'reference',c.id,'kind',c.kind,'currency',c.currency,'paid_at',c.paid_at,
   'eligible_at',c.eligible_at,'accrued_minor',c.accrued_minor::text,'current_minor',l.current::text,'livemode',c.livemode,
   'terms_required',c.kind='cocreator' AND NOT creator_ok,
   'status',CASE WHEN l.current<=0 THEN 'reversed' WHEN l.reserved THEN 'reserved' WHEN l.paid>=l.current THEN 'paid'
    WHEN c.eligible_at<=p_as_of AND ((NOT c.dispute_seen AND pt.status<>'disputed') OR c.dispute_reviewed_at IS NOT NULL)
     AND (c.kind<>'cocreator' OR creator_ok) THEN 'eligible' ELSE 'held' END,
   'sync_pending',c.observed_status<>pt.status OR c.observed_refunded_gross<>coalesce(pt.refunded_amount,0)
    OR coalesce(w.status<>'done' OR w.requested_generation>w.processed_generation,false),
   'needs_review',coalesce(w.status='needs_review',false) OR (c.dispute_seen AND c.dispute_reviewed_at IS NULL)) AS row
  FROM (SELECT * FROM page ORDER BY paid_at DESC,id DESC LIMIT p_limit) c
  JOIN public.payment_line_items li ON li.id=c.line_item_id LEFT JOIN public.products prod ON prod.id=li.product_id
  JOIN public.payment_transactions pt ON pt.id=c.payment_id LEFT JOIN public.affiliate_work w ON w.payment_id=c.payment_id
  CROSS JOIN LATERAL (
   SELECT coalesce(sum(e.amount_minor),0) AS current,coalesce(bool_or(p.status='reserved'),false) AS reserved,
    coalesce(sum(e.amount_minor) FILTER(WHERE p.status='paid'),0) AS paid
   FROM public.affiliate_ledger e LEFT JOIN public.affiliate_payout_allocations a ON a.entry_id=e.id AND a.released_at IS NULL
   LEFT JOIN public.affiliate_payouts p ON p.id=a.payout_id WHERE e.commission_id=c.id
  ) l
 ) SELECT jsonb_build_object('commissions',coalesce((SELECT jsonb_agg(row ORDER BY paid_at DESC,id DESC) FROM rows),'[]'::jsonb),
  'next_cursor',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT id FROM rows ORDER BY paid_at,id LIMIT 1) ELSE NULL END) INTO result;
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_portal_page(uuid,text,uuid,integer,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_portal_page(uuid,text,uuid,integer,timestamptz) TO service_role;

-- Portal summary adds the partner flag and the co-creator block (current shares + terms state).
CREATE OR REPLACE FUNCTION public.affiliate_portal_summary(p_member uuid,p_as_of timestamptz,p_livemode boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 WITH balances AS (
  SELECT c.currency,v.* FROM (SELECT DISTINCT currency FROM public.affiliate_commissions WHERE member_id=p_member AND livemode=p_livemode) c
  CROSS JOIN LATERAL public.affiliate_preview(p_member,c.currency,p_as_of,p_livemode) v
 ), bindings AS MATERIALIZED (
  SELECT b.coupon_id,c.code,c.is_active,c.allowed_product_ids FROM public.affiliate_coupon_bindings b
  JOIN public.coupons c ON c.id=b.coupon_id WHERE b.member_id=p_member AND b.retired_at IS NULL
 ), rules AS (
  SELECT DISTINCT ON (r.product_id) r.*,p.name FROM public.affiliate_rules r JOIN public.products p ON p.id=r.product_id
  WHERE p.is_active AND p.product_type='one_time' AND EXISTS(SELECT 1 FROM bindings b WHERE b.is_active
   AND (coalesce(jsonb_array_length(b.allowed_product_ids),0)=0 OR b.allowed_product_ids ? r.product_id::text))
  ORDER BY r.product_id,r.revision DESC
 ), creator_rules AS (
  SELECT cr.*,p.name FROM (SELECT DISTINCT ON (r.product_id) r.* FROM public.affiliate_cocreator_rules r
   WHERE r.product_id IN (SELECT product_id FROM public.affiliate_cocreator_rules WHERE member_id=p_member)
   ORDER BY r.product_id,r.revision DESC) cr JOIN public.products p ON p.id=cr.product_id WHERE cr.member_id=p_member
 ), member AS (SELECT * FROM public.affiliate_memberships WHERE id=p_member),
 terms AS (SELECT * FROM public.affiliate_creator_terms ORDER BY id DESC LIMIT 1)
 SELECT jsonb_build_object(
  'is_partner',coalesce((SELECT is_partner FROM member),true),
  'balances',coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'accrued',accrued,'reversed',reversed,'paid',paid,'reserved',reserved,
   'held',held_minor,'eligible',greatest(payable_minor::numeric,0)::text,'debt',greatest(-payable_minor::numeric,0)::text,'balance',balance) ORDER BY currency) FROM balances),'[]'::jsonb),
  'codes',coalesce((SELECT jsonb_agg(jsonb_build_object('code',code,'active',is_active) ORDER BY code) FROM bindings),'[]'::jsonb),
  'rules',coalesce((SELECT jsonb_agg(jsonb_build_object('product',name,'percentage_bps',percentage_bps,'fixed_minor',fixed_minor::text,'currency',currency,'enabled',enabled) ORDER BY name) FROM rules),'[]'::jsonb),
  'creator',jsonb_build_object(
   'active',EXISTS(SELECT 1 FROM public.affiliate_cocreator_rules WHERE member_id=p_member),
   'rules',coalesce((SELECT jsonb_agg(jsonb_build_object('product',name,'percentage_bps',percentage_bps,'fixed_minor',fixed_minor::text,'currency',currency) ORDER BY name) FROM creator_rules),'[]'::jsonb),
   'accepted_version',(SELECT creator_terms_version FROM member),'accepted_at',(SELECT creator_accepted_at FROM member),
   'terms',(SELECT jsonb_build_object('version',terms_version,'en',terms->>'en','pl',terms->>'pl') FROM terms)),
  'sync_pending',EXISTS(SELECT 1 FROM balances WHERE sync_required),
  'needs_review',EXISTS(SELECT 1 FROM public.affiliate_payouts WHERE member_id=p_member AND livemode=p_livemode AND needs_review)
   OR EXISTS(SELECT 1 FROM public.affiliate_commissions c LEFT JOIN public.affiliate_work w ON w.payment_id=c.payment_id
    WHERE c.member_id=p_member AND c.livemode=p_livemode AND (w.status='needs_review' OR (c.dispute_seen AND c.dispute_reviewed_at IS NULL))))
$$;
REVOKE EXECUTE ON FUNCTION public.affiliate_portal_summary(uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_portal_summary(uuid,timestamptz,boolean) TO service_role;

-- commission.* webhooks say which share it is.
CREATE OR REPLACE FUNCTION public.capture_commission_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.affiliate_commissions; pid uuid; event text := CASE NEW.kind WHEN 'accrual' THEN 'accrued' ELSE 'reversed' END;
BEGIN
  IF NEW.kind NOT IN ('accrual','reversal') THEN RETURN NEW; END IF;
  SELECT * INTO c FROM public.affiliate_commissions WHERE id=NEW.commission_id;
  SELECT coalesce(l.product_id,t.product_id) INTO pid FROM public.payment_transactions t
    LEFT JOIN public.payment_line_items l ON l.id=c.line_item_id WHERE t.id=c.payment_id;
  PERFORM public.record_business_event('commission.'||event,pid,jsonb_build_object(
    'amountUnit','minor',
    'commission',jsonb_build_object('id',c.id,'ledgerEntryId',NEW.id,'kind',c.kind,'amount',NEW.amount_minor,'currency',NEW.currency,
      'baseAmount',c.base_minor,'accruedAmount',c.accrued_minor,'paidAt',c.paid_at,'eligibleAt',c.eligible_at,
      'selfReferral',c.self_referral,'livemode',c.livemode),
    'partner',public.business_event_partner(NEW.member_id),
    'order',public.business_event_order(c.payment_id)),
    'commission.'||event||':'||NEW.id);
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.capture_commission_event() FROM PUBLIC,anon,authenticated;

-- Deletion impact counts co-creator rules and every commission on the product's lines.
CREATE OR REPLACE FUNCTION public.product_deletion_impact(p_product_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH orders AS (
    SELECT id FROM public.payment_transactions WHERE product_id = p_product_id
    UNION SELECT transaction_id FROM public.payment_line_items WHERE product_id = p_product_id
  ), counts AS (
    SELECT (SELECT count(*) FROM orders) AS orders,
      (SELECT count(*) FROM public.invoices WHERE transaction_id IN (SELECT id FROM orders)) AS invoices,
      (SELECT count(*) FROM public.issued_licenses WHERE product_id = p_product_id) AS licenses,
      (SELECT count(*) FROM public.user_product_access WHERE product_id = p_product_id)
        + (SELECT count(*) FROM public.guest_purchases WHERE product_id = p_product_id AND claimed_by_user_id IS NULL) AS accesses,
      (SELECT count(*) FROM public.subscriptions WHERE product_id = p_product_id) AS subscriptions,
      (SELECT count(*) FROM public.subscriptions WHERE product_id = p_product_id
        AND status IN ('trialing', 'active', 'past_due', 'incomplete')) AS active_subscriptions,
      (SELECT count(*) FROM public.seat_reservations r JOIN public.product_sessions s ON s.id = r.session_id
        WHERE s.product_id = p_product_id AND coalesce(s.ends_at, s.starts_at) > now()
          AND (r.status = 'confirmed' OR (r.status = 'held' AND (r.expires_at IS NULL OR r.expires_at > now())))) AS future_reservations,
      (SELECT count(*) FROM public.affiliate_rules WHERE product_id = p_product_id)
        + (SELECT count(*) FROM public.affiliate_cocreator_rules WHERE product_id = p_product_id) AS affiliate_rules,
      (SELECT count(*) FROM public.affiliate_commissions c JOIN public.payment_line_items li ON li.id = c.line_item_id
        WHERE li.product_id = p_product_id) AS affiliate_commissions,
      (SELECT count(*) FROM public.bundle_items WHERE component_product_id = p_product_id) AS bundles
  )
  SELECT jsonb_build_object('orders', orders, 'invoices', invoices, 'licenses', licenses, 'accesses', accesses,
    'subscriptions', subscriptions, 'activeSubscriptions', active_subscriptions, 'futureReservations', future_reservations,
    'affiliateRules', affiliate_rules, 'affiliateCommissions', affiliate_commissions, 'bundles', bundles,
    'bundleReferences', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) ORDER BY p.name,p.id),'[]'::jsonb)
      FROM public.bundle_items bi JOIN public.products p ON p.id=bi.bundle_product_id WHERE bi.component_product_id=p_product_id),
    'hasHistory', orders > 0 OR licenses > 0 OR accesses > 0 OR subscriptions > 0 OR affiliate_rules > 0)
  FROM counts;
$$;
REVOKE EXECUTE ON FUNCTION public.product_deletion_impact(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.product_deletion_impact(uuid) TO service_role;

-- ===== Checkout cart versions =====
-- ===== Source: 20261117120000_replace_pending_order.sql =====
-- A cart change on an open Stripe checkout updates the same Checkout Session. A paid
-- payment must always settle, whatever the order of the cart change, the Stripe update and the
-- payment, so every cart the session may carry is kept as a numbered version until the order is
-- paid, and the payment settles against the version Stripe actually charged (session metadata
-- `sellf_cart_version`, written in the same Stripe call as the line items).
--
-- 1. public._price_order_lines: line validation and pricing extracted unchanged from
--    public._place_order_without_event, so placing and updating an order share one rule set.
-- 2. public._place_order_without_event: same behaviour, now pricing through the helper.
-- 3. public.checkout_cart_versions: the carts of one pending order (service role only). Version 1
--    is the cart the order was placed with; a row in state 'updating' younger than 60 seconds is
--    the single in-flight update of that session (a second one is refused, the browser retries).
-- 4. public.begin_pending_order_update / finish_pending_order_update: store the new cart and lock
--    the session before the Stripe call; make it the saved order only after Stripe confirmed it.
--    An unconfirmed or failed update keeps the saved order and every version.
-- 5. public.process_stripe_payment_completion_with_bump: new cart_version_param; the paid version
--    becomes the saved order before the usual amount, coupon and line checks run.
-- @see admin-panel/src/app/api/create-payment-intent/route.ts
-- @see admin-panel/src/lib/stripe/checkout-session-update.ts
-- @see admin-panel/src/lib/orders/place-order.ts

CREATE FUNCTION public._price_order_lines(p_order jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  li public.payment_line_items%ROWTYPE;
  product public.products%ROWTYPE;
  entry jsonb;
  saved_lines jsonb := '[]'::jsonb;
  provider text := coalesce(p_order->>'payment_provider', 'stripe');
  main_id uuid := (p_order->>'product_id')::uuid;
  currency_code text := upper(p_order->>'currency');
  factor numeric := public.currency_minor_factor(currency_code);
  main_count integer := 0;
  charge numeric := 0;
  net_sum numeric := 0;
  tax_sum numeric := 0;
  basis numeric;
  tax numeric;
BEGIN
  IF jsonb_typeof(p_order) IS DISTINCT FROM 'object' OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
    OR octet_length(p_order::text) > 65536 OR octet_length(p_lines::text) > 131072 THEN
    RAISE EXCEPTION 'Invalid order payload' USING ERRCODE = '22023';
  END IF;
  IF provider NOT IN ('stripe','bank_transfer') OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 21 THEN
    RAISE EXCEPTION 'Invalid order provider or line count' USING ERRCODE = '22023';
  END IF;
  -- Validate all bindings and compute the payable amount before storing any rows.
  FOR entry IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid line'; END IF;
    li := jsonb_populate_record(NULL::public.payment_line_items, entry);
    SELECT * INTO product FROM public.products WHERE id = li.product_id AND is_active FOR SHARE;
    IF NOT FOUND OR upper(product.currency) IS DISTINCT FROM currency_code
      OR upper(li.currency) IS DISTINCT FROM currency_code THEN RAISE EXCEPTION 'Invalid line product or currency'; END IF;
    IF li.quantity IS NULL OR li.quantity NOT BETWEEN 1 AND 100
      OR li.unit_price IS NULL OR li.unit_price NOT BETWEEN 0 AND 99999999
      OR li.total_price IS DISTINCT FROM li.unit_price * li.quantity
      OR li.discounted_total IS NULL OR li.discounted_total NOT BETWEEN 0 AND 99999999
      OR li.discounted_total * factor <> round(li.discounted_total * factor)
      OR li.unit_price * factor <> round(li.unit_price * factor)
      OR (li.vat_rate IS NOT NULL AND li.vat_rate NOT BETWEEN 0 AND 100)
      OR (li.tax_behavior IS NOT NULL AND li.tax_behavior NOT IN ('inclusive','exclusive')) THEN
      RAISE EXCEPTION 'Invalid line pricing';
    END IF;
    IF li.item_type = 'main_product' AND li.product_id = main_id AND li.order_bump_id IS NULL THEN
      main_count := main_count + 1;
    ELSIF li.item_type = 'order_bump' AND li.quantity = 1 AND EXISTS (
      SELECT 1 FROM public.order_bumps ob WHERE ob.id = li.order_bump_id
        AND ob.main_product_id = main_id AND ob.bump_product_id = li.product_id AND ob.is_active
    ) THEN NULL;
    ELSE RAISE EXCEPTION 'Invalid order line binding'; END IF;
    basis := round(li.discounted_total * factor);
    tax := CASE WHEN coalesce(li.vat_exempt, false) OR coalesce(li.vat_rate, 0) = 0 OR li.tax_behavior IS NULL THEN 0
      WHEN li.tax_behavior = 'inclusive' THEN round(basis * li.vat_rate / (100 + li.vat_rate))
      ELSE round(basis * li.vat_rate / 100) END;
    charge := charge + basis + CASE WHEN li.tax_behavior = 'exclusive' THEN tax ELSE 0 END;
    net_sum := net_sum + basis - CASE WHEN li.tax_behavior = 'inclusive' THEN tax ELSE 0 END;
    tax_sum := tax_sum + tax;
    li.net_amount := basis - CASE WHEN li.tax_behavior = 'inclusive' THEN tax ELSE 0 END;
    li.tax_amount := tax;
    saved_lines := saved_lines || jsonb_build_array(to_jsonb(li));
  END LOOP;
  IF main_count <> 1 THEN RAISE EXCEPTION 'Exactly one main product is required'; END IF;
  RETURN jsonb_build_object('lines', saved_lines, 'charge', charge, 'net_sum', net_sum, 'tax_sum', tax_sum);
END;
$$;
REVOKE EXECUTE ON FUNCTION public._price_order_lines(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Stores priced lines for an order; line net/tax are kept only for offline (locally taxed) orders.
CREATE FUNCTION public._insert_order_lines(p_transaction_id uuid, p_currency text, p_lines jsonb, p_offline boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  li public.payment_line_items%ROWTYPE;
  entry jsonb;
BEGIN
  FOR entry IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    li := jsonb_populate_record(NULL::public.payment_line_items, entry);
    INSERT INTO public.payment_line_items (
      transaction_id, product_id, item_type, quantity, unit_price, total_price, discounted_total,
      currency, product_name, order_bump_id, access_duration_override, vat_rate, tax_behavior, vat_exempt, net_amount, tax_amount
    ) VALUES (
      p_transaction_id, li.product_id, li.item_type, li.quantity, li.unit_price, li.total_price, li.discounted_total,
      p_currency, li.product_name, li.order_bump_id, li.access_duration_override, li.vat_rate,
      li.tax_behavior, coalesce(li.vat_exempt, false),
      CASE WHEN p_offline THEN li.net_amount END, CASE WHEN p_offline THEN li.tax_amount END
    );
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._insert_order_lines(uuid,text,jsonb,boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._place_order_without_event(p_order jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  priced jsonb;
  provider text := coalesce(p_order->>'payment_provider', 'stripe');
  main_id uuid := (p_order->>'product_id')::uuid;
  currency_code text := upper(p_order->>'currency');
  offline boolean := provider = 'bank_transfer';
  existing_user uuid;
BEGIN
  priced := public._price_order_lines(p_order, p_lines);
  INSERT INTO public.payment_transactions (
    payment_provider, pricing_snapshot_version, product_id, customer_email, user_id,
    session_id, stripe_payment_intent_id, coupon_id, livemode, status, amount, currency,
    order_details, metadata, custom_field_values, expires_at, tax_snapshot_status, net_total, tax_total
  ) VALUES (
    provider, 1, main_id, p_order->>'customer_email', (p_order->>'user_id')::uuid,
    p_order->>'session_id', p_order->>'stripe_payment_intent_id', (p_order->>'coupon_id')::uuid,
    coalesce((p_order->>'livemode')::boolean, false), CASE WHEN offline THEN 'awaiting_payment' ELSE 'pending' END,
    (priced->>'charge')::numeric, currency_code, p_order->'order_details', coalesce(p_order->'metadata','{}'::jsonb),
    coalesce(p_order->'custom_field_values','{}'::jsonb), (p_order->>'expires_at')::timestamptz,
    CASE WHEN offline THEN 'local' ELSE 'none' END,
    CASE WHEN offline THEN (priced->>'net_sum')::numeric END, CASE WHEN offline THEN (priced->>'tax_sum')::numeric END
  ) RETURNING * INTO tx;
  PERFORM public._insert_order_lines(tx.id, currency_code, priced->'lines', offline);
  IF offline AND tx.coupon_id IS NOT NULL THEN
    SELECT id INTO existing_user FROM auth.users WHERE lower(email) = lower(tx.customer_email) AND email_confirmed_at IS NOT NULL;
    PERFORM public._redeem_coupon_for_order(tx.coupon_id, tx.user_id, existing_user, tx.customer_email, tx.id);
  END IF;
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id, 'order_number', tx.order_number, 'amount', tx.amount);
END;
$$;
REVOKE EXECUTE ON FUNCTION public._place_order_without_event(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ===== 3. Cart versions of a pending order =====
CREATE TABLE public.checkout_cart_versions (
  transaction_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 100),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  amount numeric NOT NULL CHECK (amount >= 0),
  coupon_id uuid REFERENCES public.coupons(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL CHECK (state IN ('placed', 'updating', 'unconfirmed', 'applied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, version)
);
CREATE INDEX idx_checkout_cart_versions_coupon ON public.checkout_cart_versions (coupon_id) WHERE coupon_id IS NOT NULL;
ALTER TABLE public.checkout_cart_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.checkout_cart_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Admin read" ON public.checkout_cart_versions
  FOR SELECT TO authenticated USING ((select public.is_admin()));
REVOKE ALL ON public.checkout_cart_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.checkout_cart_versions TO authenticated;
GRANT ALL ON public.checkout_cart_versions TO service_role;

-- Makes a stored version the saved order: its lines, amount, coupon and cart metadata. The buyer's
-- answers (custom field values, buyer details) are not part of a cart; whatever the form saved last
-- stays on the order whichever version is paid.
CREATE FUNCTION public._apply_cart_version(p_transaction_id uuid, p_version integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ver public.checkout_cart_versions%ROWTYPE;
BEGIN
  SELECT * INTO STRICT ver FROM public.checkout_cart_versions
    WHERE transaction_id = p_transaction_id AND version = p_version;
  DELETE FROM public.payment_line_items WHERE transaction_id = p_transaction_id;
  PERFORM public._insert_order_lines(p_transaction_id,
    (SELECT upper(currency) FROM public.payment_transactions WHERE id = p_transaction_id), ver.lines, false);
  UPDATE public.payment_transactions SET
    amount = ver.amount,
    coupon_id = ver.coupon_id,
    metadata = coalesce(metadata, '{}'::jsonb) || ver.metadata,
    updated_at = now()
  WHERE id = p_transaction_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._apply_cart_version(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;

-- ===== 4. Update of an open session: begin before the Stripe call, finish after it =====
CREATE FUNCTION public.begin_pending_order_update(p_order jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  priced jsonb;
  next_version integer;
  base_metadata jsonb;
BEGIN
  IF jsonb_typeof(p_order) IS DISTINCT FROM 'object' OR coalesce(p_order->>'payment_provider', 'stripe') <> 'stripe'
    OR coalesce(p_order->>'session_id', '') = '' THEN
    RAISE EXCEPTION 'Invalid order payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO tx FROM public.payment_transactions WHERE session_id = p_order->>'session_id' FOR UPDATE;
  -- Only an unpaid online order of the same product, buyer and currency; event orders hold seats
  -- for the ordered quantity and get a new session instead.
  IF NOT FOUND OR tx.status <> 'pending' OR tx.payment_provider <> 'stripe'
    OR tx.product_id IS DISTINCT FROM (p_order->>'product_id')::uuid
    OR tx.user_id IS DISTINCT FROM (p_order->>'user_id')::uuid
    OR lower(tx.customer_email) IS DISTINCT FROM lower(trim(p_order->>'customer_email'))
    OR upper(tx.currency) IS DISTINCT FROM upper(p_order->>'currency')
    OR EXISTS (SELECT 1 FROM public.products WHERE id = tx.product_id AND event_mode)
    OR EXISTS (SELECT 1 FROM public.seat_reservations WHERE transaction_id = tx.id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_replaceable');
  END IF;
  IF EXISTS (SELECT 1 FROM public.checkout_cart_versions WHERE transaction_id = tx.id
    AND state = 'updating' AND created_at > now() - interval '60 seconds') THEN
    RETURN jsonb_build_object('success', false, 'error', 'update_in_progress');
  END IF;
  -- An update that never finished: Stripe may or may not carry it, so it stays payable.
  UPDATE public.checkout_cart_versions SET state = 'unconfirmed' WHERE transaction_id = tx.id AND state = 'updating';
  priced := public._price_order_lines(p_order, p_lines);
  IF NOT EXISTS (SELECT 1 FROM public.checkout_cart_versions WHERE transaction_id = tx.id) THEN
    INSERT INTO public.checkout_cart_versions (transaction_id, version, lines, amount, coupon_id, metadata, state)
    SELECT tx.id, 1, coalesce(jsonb_agg(to_jsonb(li)), '[]'::jsonb), tx.amount, tx.coupon_id,
      coalesce(tx.metadata, '{}'::jsonb), 'placed'
    FROM public.payment_line_items li WHERE li.transaction_id = tx.id;
  END IF;
  SELECT max(version) + 1, (array_agg(metadata ORDER BY version))[1] INTO next_version, base_metadata
    FROM public.checkout_cart_versions WHERE transaction_id = tx.id;
  IF next_version > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_replaceable');
  END IF;
  INSERT INTO public.checkout_cart_versions (transaction_id, version, lines, amount, coupon_id, metadata, state)
  VALUES (tx.id, next_version, priced->'lines', (priced->>'charge')::numeric, (p_order->>'coupon_id')::uuid,
    base_metadata || coalesce(p_order->'metadata', '{}'::jsonb), 'updating');
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id, 'version', next_version, 'amount', (priced->>'charge')::numeric);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.begin_pending_order_update(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_pending_order_update(jsonb,jsonb) TO service_role;

-- p_confirmed: Stripe answered with this version's metadata and the cart's subtotal. Only then the
-- version becomes the saved order and the reservation of a coupon it dropped is released (the old
-- cart can no longer be paid). Otherwise the saved order stays and the version stays payable.
CREATE FUNCTION public.finish_pending_order_update(p_session_id text, p_version integer, p_confirmed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tx public.payment_transactions%ROWTYPE;
  ver public.checkout_cart_versions%ROWTYPE;
BEGIN
  SELECT * INTO tx FROM public.payment_transactions WHERE session_id = p_session_id FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO ver FROM public.checkout_cart_versions WHERE transaction_id = tx.id AND version = p_version;
  END IF;
  IF ver.transaction_id IS NULL OR ver.state <> 'updating' THEN
    RETURN jsonb_build_object('success', false, 'error', 'update_not_in_progress');
  END IF;
  IF NOT coalesce(p_confirmed, false) OR tx.status <> 'pending' THEN
    UPDATE public.checkout_cart_versions SET state = 'unconfirmed' WHERE transaction_id = tx.id AND version = p_version;
    RETURN jsonb_build_object('success', false, 'error', 'update_not_confirmed');
  END IF;
  PERFORM public._apply_cart_version(tx.id, p_version);
  UPDATE public.checkout_cart_versions SET state = 'applied' WHERE transaction_id = tx.id AND version = p_version;
  IF tx.coupon_id IS NOT NULL AND tx.coupon_id IS DISTINCT FROM ver.coupon_id THEN
    DELETE FROM public.coupon_reservations
      WHERE coupon_id = tx.coupon_id AND customer_email = lower(trim(tx.customer_email));
  END IF;
  RETURN jsonb_build_object('success', true, 'transaction_id', tx.id, 'version', p_version);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finish_pending_order_update(text,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_pending_order_update(text,integer,boolean) TO service_role;

-- ===== 5. Completion settles the cart version Stripe charged =====
DROP FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric,boolean);
CREATE FUNCTION public.process_stripe_payment_completion_with_bump(
  session_id_param text, product_id_param uuid, customer_email_param text,
  amount_total numeric, currency_param text,
  stripe_payment_intent_id text DEFAULT NULL, user_id_param uuid DEFAULT NULL,
  bump_product_ids_param uuid[] DEFAULT NULL, coupon_id_param uuid DEFAULT NULL,
  amount_subtotal_param numeric DEFAULT NULL,
  allow_inactive_product_param boolean DEFAULT false,
  cart_version_param integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  pi_param text := stripe_payment_intent_id;
  tx public.payment_transactions%ROWTYPE;
  result jsonb;
  full_bumps uuid[];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(coalesce(pi_param, session_id_param)));
  SELECT pt.* INTO tx FROM public.payment_transactions pt
    WHERE pt.session_id = session_id_param OR (pi_param IS NOT NULL AND pt.stripe_payment_intent_id = pi_param)
    ORDER BY (pt.session_id = session_id_param) DESC LIMIT 1 FOR UPDATE;

  IF tx.id IS NOT NULL THEN
    IF tx.payment_provider <> 'stripe'
       OR tx.product_id IS DISTINCT FROM product_id_param
       OR upper(tx.currency) IS DISTINCT FROM upper(currency_param)
       OR (tx.stripe_payment_intent_id IS NOT NULL AND tx.stripe_payment_intent_id IS DISTINCT FROM pi_param)
       OR (tx.session_id LIKE 'cs_%' AND session_id_param LIKE 'cs_%' AND tx.session_id <> session_id_param)
       OR tx.status NOT IN ('pending', 'abandoned', 'completed')
       OR (tx.status = 'completed' AND (tx.amount IS DISTINCT FROM amount_total OR lower(tx.customer_email) IS DISTINCT FROM lower(trim(customer_email_param))))
    THEN
      RETURN jsonb_build_object('success', false, 'error', 'Order details do not match', 'error_kind', 'data');
    END IF;
    IF EXISTS (SELECT 1 FROM public.payment_transactions pt
      WHERE pt.id <> tx.id AND (pt.session_id = session_id_param OR pt.stripe_payment_intent_id = pi_param)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Order records need review', 'error_kind', 'data');
    END IF;
    -- The cart Stripe charged (no version in the session metadata = the cart the order was placed with).
    IF tx.status IN ('pending', 'abandoned') AND EXISTS (SELECT 1 FROM public.checkout_cart_versions v
      WHERE v.transaction_id = tx.id AND v.version = coalesce(cart_version_param, 1)) THEN
      PERFORM public._apply_cart_version(tx.id, coalesce(cart_version_param, 1));
      SELECT pt.* INTO tx FROM public.payment_transactions pt WHERE pt.id = tx.id;
    END IF;
    IF tx.session_id LIKE 'cs_%' THEN session_id_param := tx.session_id; END IF;
    IF jsonb_typeof(tx.metadata->'bump_product_ids_full') = 'array' THEN
      SELECT array_agg(value::uuid) INTO full_bumps
        FROM jsonb_array_elements_text(tx.metadata->'bump_product_ids_full');
      IF coalesce(cardinality(full_bumps), 0) > coalesce(cardinality(bump_product_ids_param), 0) THEN
        bump_product_ids_param := full_bumps;
      END IF;
    END IF;
  END IF;

  -- Attach the order and complete it within one savepoint.
  BEGIN
    IF tx.id IS NOT NULL THEN
      UPDATE public.payment_transactions SET
        stripe_payment_intent_id = coalesce(pi_param, tx.stripe_payment_intent_id),
        session_id = session_id_param,
        status = CASE WHEN status = 'abandoned' THEN 'pending' ELSE status END,
        amount = CASE WHEN status IN ('pending', 'abandoned') THEN amount_total ELSE amount END,
        currency = upper(currency_param)
      WHERE id = tx.id;
      IF tx.session_id <> session_id_param THEN
        UPDATE public.guest_purchases SET session_id = session_id_param
        WHERE session_id = tx.session_id AND product_id = tx.product_id;
      END IF;
    END IF;
    result := public._process_stripe_payment_completion_with_bump_impl(
      session_id_param, product_id_param, lower(trim(customer_email_param)), amount_total,
      currency_param, pi_param, user_id_param, bump_product_ids_param, coupon_id_param, amount_subtotal_param,
      allow_inactive_product_param
    );
    IF NOT coalesce((result->>'success')::boolean, false) THEN
      RAISE EXCEPTION USING MESSAGE = 'Completion not accepted', DETAIL = result::text;
    END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Completion not accepted' THEN
      GET STACKED DIAGNOSTICS result = PG_EXCEPTION_DETAIL;
      RETURN result::jsonb || jsonb_build_object('error_kind', CASE WHEN result->>'error' = 'Rate limit exceeded' OR result->>'code' IN ('40001','40P01','57014') THEN 'transient' ELSE 'data' END);
    END IF;
    RAISE;
  END;

  SELECT pt.* INTO tx FROM public.payment_transactions pt WHERE pt.session_id = session_id_param;
  IF result->>'message' = 'Payment already processed (idempotent)'
     OR result->>'scenario' = 'idempotent_claimed_for_logged_in_user' THEN
    result := result || jsonb_build_object('already_had_access', true);
  END IF;
  RETURN result || jsonb_build_object('transaction_id', tx.id, 'session_id', tx.session_id,
    'bump_product_ids', coalesce(bump_product_ids_param, '{}'::uuid[]),
    'pricing_source', CASE WHEN tx.pricing_snapshot_version IS NULL THEN 'legacy' ELSE 'snapshot' END);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric,boolean,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_stripe_payment_completion_with_bump(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric,boolean,integer) TO service_role;

-- ===== Maintenance mode =====
-- ===== Source: 20261117130000_maintenance_mode.sql =====
-- Maintenance mode ("Przerwa w działaniu"), the database source: the seller switches it on in the
-- panel or through API v1 for a planned break. While on, the shop, checkout, embed and login wall
-- answer 503 with a maintenance page; the admin panel and Stripe webhooks keep working.
-- The second source is a file on the server (<install>/MAINTENANCE), checked before any database
-- query and managed by scripts/upgrade.sh; it is not stored here.
--
-- @see admin-panel/src/lib/maintenance/setting.ts (panel + API v1)
-- @see admin-panel/src/lib/maintenance/state.ts (proxy read through get_maintenance_mode)

CREATE TABLE public.maintenance_mode (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  message text CHECK (message IS NULL OR char_length(message) BETWEEN 1 AND 500),
  expected_end_at timestamptz,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX maintenance_mode_changed_by_idx ON public.maintenance_mode(changed_by);
COMMENT ON TABLE public.maintenance_mode IS 'Singleton: maintenance mode switched from the panel or API v1. Changed only through set_maintenance_mode (audited).';

INSERT INTO public.maintenance_mode DEFAULT VALUES;

ALTER TABLE public.maintenance_mode ENABLE ROW LEVEL SECURITY;
CREATE POLICY maintenance_mode_service ON public.maintenance_mode FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
CREATE POLICY maintenance_mode_admin_read ON public.maintenance_mode FOR SELECT TO authenticated
  USING ((select public.is_admin()));
REVOKE ALL ON public.maintenance_mode FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.maintenance_mode TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.maintenance_mode TO service_role;

-- Public read for the proxy (anon key): only what the maintenance page shows. The message and the
-- expected end are returned only while the mode is on.
CREATE FUNCTION public.get_maintenance_mode()
RETURNS TABLE (enabled boolean, message text, expected_end_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.enabled,
         CASE WHEN m.enabled THEN m.message END,
         CASE WHEN m.enabled THEN m.expected_end_at END
  FROM public.maintenance_mode m
  WHERE m.id;
$$;
REVOKE EXECUTE ON FUNCTION public.get_maintenance_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_maintenance_mode() TO anon, authenticated, service_role;

-- Switch the mode and write the audit entry in ONE transaction: when the audit insert fails
-- (e.g. performed_by is not an auth user) nothing changes and the caller gets the error.
-- Returns the previous state.
CREATE FUNCTION public.set_maintenance_mode(
  p_enabled boolean,
  p_message text,
  p_expected_end_at timestamptz,
  p_performed_by uuid,
  p_details jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.maintenance_mode;
  v_message text := nullif(btrim(p_message), '');
  v_previous jsonb;
  v_next jsonb;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL OR p_performed_by IS NULL
     OR (v_message IS NOT NULL AND char_length(v_message) > 500)
     OR (p_details IS NOT NULL AND jsonb_typeof(p_details) <> 'object') THEN
    RAISE EXCEPTION 'Invalid maintenance mode change' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.maintenance_mode (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_row FROM public.maintenance_mode WHERE id FOR UPDATE;

  v_previous := jsonb_build_object('enabled', v_row.enabled, 'message', v_row.message, 'expected_end_at', v_row.expected_end_at);
  v_next := jsonb_build_object('enabled', p_enabled, 'message', v_message, 'expected_end_at', p_expected_end_at);

  UPDATE public.maintenance_mode
  SET enabled = p_enabled,
      message = v_message,
      expected_end_at = p_expected_end_at,
      changed_at = now(),
      changed_by = p_performed_by
  WHERE id;

  INSERT INTO public.audit_log (table_name, operation, user_id, performed_by, old_values, new_values)
  VALUES ('maintenance_mode', 'UPDATE', p_performed_by, p_performed_by, v_previous, coalesce(p_details, '{}'::jsonb) || v_next);

  RETURN v_previous;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_maintenance_mode(boolean, text, timestamptz, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_maintenance_mode(boolean, text, timestamptz, uuid, jsonb) TO service_role;

-- ===== Free access during maintenance =====
-- Saved requests and paid fulfillment complete during a break.
-- The app also checks the file source before calling this RPC.
CREATE OR REPLACE FUNCTION public.grant_free_product_access(product_slug_param text, access_duration_days_param integer DEFAULT NULL, coupon_code_param text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  previous text := current_setting('sellf.grant_source', true);
  saved_request uuid := nullif(current_setting('sellf.free_grant_context', true), '')::uuid;
  result boolean;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role'
     AND EXISTS (SELECT 1 FROM public.maintenance_mode m WHERE m.id AND m.enabled)
     AND NOT EXISTS (
       SELECT 1 FROM public.free_grant_contexts c
       JOIN public.products p ON p.id = c.product_id
       JOIN auth.users u ON lower(u.email) = c.email
       WHERE c.id = saved_request AND p.slug = product_slug_param AND u.id = (select auth.uid())
         AND c.claimed_at IS NULL AND c.expires_at > now()) THEN
    RAISE EXCEPTION 'Down for maintenance' USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('sellf.grant_source', 'free', true);
  result := public.grant_free_product_access_impl(product_slug_param, access_duration_days_param, coupon_code_param);
  PERFORM set_config('sellf.grant_source', coalesce(previous, ''), true);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_free_product_access(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_free_product_access(text, integer, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.grant_free_product_access_impl(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_free_product_access_impl(text, integer, text) TO service_role;

-- ===== Order entitlements =====
-- ===== Source: 20261117140000_order_entitlement_fixes.sql =====
-- Order component records, coupon reservations, mail queue ordering and subscription state.
--
-- ===== Bundle components granted per order =====
-- An order of a bundle records the components the bundle held at the moment the order grants access
-- (payment completed, or an unpaid bank-transfer order that grants access on placement). That record
-- is the one source of the order's components: the grant itself (also a guest's later claim), a full
-- refund and a dispute all read it, so re-composing or deleting the bundle between placing, paying,
-- claiming and refunding cannot make them differ. Historical orders with components get the
-- current composition as their record; historical empty bundles keep the catalogue fallback.

ALTER TABLE public.payment_transactions ADD COLUMN bundle_components_recorded_at timestamptz;

CREATE TABLE public.order_bundle_components (
  transaction_id uuid NOT NULL REFERENCES public.payment_transactions(id) ON DELETE CASCADE,
  -- No foreign keys to products: the record outlives a deleted product, and a second path from
  -- orders to products would make the API's order -> product embedding ambiguous.
  component_product_id uuid NOT NULL,
  bundle_product_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, component_product_id)
);
CREATE INDEX order_bundle_components_component_idx ON public.order_bundle_components(component_product_id);
COMMENT ON TABLE public.order_bundle_components IS
  'Bundle components an order grants, recorded when the order grants access; grants, refunds and disputes act on this set.';
ALTER TABLE public.order_bundle_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_bundle_components FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_bundle_components TO service_role;
CREATE POLICY order_bundle_components_service ON public.order_bundle_components FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');

-- Records the bundle's current components for an order that has no record yet; a recorded order keeps its set.
CREATE FUNCTION public.snapshot_order_bundle_components(p_transaction_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions;
BEGIN
  SELECT * INTO tx FROM public.payment_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR tx.bundle_components_recorded_at IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = tx.product_id AND is_bundle) THEN
    RETURN;
  END IF;
  INSERT INTO public.order_bundle_components (transaction_id, component_product_id, bundle_product_id)
  SELECT tx.id, b.component_product_id, b.bundle_product_id
  FROM public.bundle_items b WHERE b.bundle_product_id = tx.product_id
  ON CONFLICT DO NOTHING;
  UPDATE public.payment_transactions SET bundle_components_recorded_at = now() WHERE id = tx.id;
END $$;
REVOKE EXECUTE ON FUNCTION public.snapshot_order_bundle_components(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.record_order_bundle_components() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.product_id IS NOT NULL AND (NEW.status = 'completed' OR (NEW.status = 'awaiting_payment'
    AND coalesce((NEW.metadata->>'access_on_placement')::boolean, false))) THEN
    PERFORM public.snapshot_order_bundle_components(NEW.id);
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_order_bundle_components() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER record_order_bundle_components AFTER INSERT OR UPDATE OF status ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.record_order_bundle_components();

DO $$
DECLARE tx record;
BEGIN
  FOR tx IN
    SELECT t.id FROM public.payment_transactions t JOIN public.products p ON p.id = t.product_id AND p.is_bundle
    WHERE (t.status IN ('completed', 'partially_refunded', 'disputed', 'refunded')
      OR (t.status = 'awaiting_payment' AND coalesce((t.metadata->>'access_on_placement')::boolean, false)))
      AND EXISTS (SELECT 1 FROM public.bundle_items b WHERE b.bundle_product_id = t.product_id)
  LOOP
    PERFORM public.snapshot_order_bundle_components(tx.id);
  END LOOP;
END $$;

-- A recorded empty set stays empty. Orders without a record retain the historical catalogue fallback.
CREATE FUNCTION public.order_granted_components(p_transaction_id uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT component_product_id FROM public.order_bundle_components WHERE transaction_id = p_transaction_id
  UNION
  SELECT b.component_product_id FROM public.payment_transactions t
  JOIN public.bundle_items b ON b.bundle_product_id = t.product_id
  WHERE t.id = p_transaction_id
    AND t.bundle_components_recorded_at IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.order_granted_components(uuid) FROM PUBLIC, anon, authenticated;

-- Full refund: removes the bundle-component access this order granted to the buyer, except
-- components the buyer still holds through a real entitlement: another paid order (or an unpaid
-- bank-transfer order that granted access on placement) that includes the component, or another
-- bundle the buyer has live access to.
-- Each order retains its own grant dates independently of the combined access row.
ALTER TABLE public.payment_transactions ADD COLUMN access_terms jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_access_terms_check
  CHECK (jsonb_typeof(access_terms) = 'object') NOT VALID;
ALTER TABLE public.payment_transactions VALIDATE CONSTRAINT payment_transactions_access_terms_check;

ALTER TABLE public.user_product_access ADD COLUMN independent_access jsonb;



CREATE FUNCTION public.retain_independent_access() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('sellf.grant_source', true) = 'manual' THEN
    NEW.grant_source := 'manual';
    NEW.independent_access := jsonb_build_object('expiresAt', NEW.access_expires_at);
  ELSIF NEW.subscription_id IS NULL AND NEW.transfer_transaction_id IS NULL
    AND nullif(current_setting('sellf.paid_order', true), '') IS NULL
    AND nullif(current_setting('sellf.transfer_order', true), '') IS NULL
    AND (current_setting('sellf.grant_source', true) IN ('purchase', 'bundle', 'free')
      OR (TG_OP = 'INSERT' AND NEW.grant_source IN ('free', 'manual'))) THEN
    IF TG_OP = 'INSERT' OR OLD.access_expires_at <= now()
      OR (NEW.access_expires_at IS NULL AND OLD.access_expires_at IS NOT NULL) THEN
      NEW.independent_access := jsonb_build_object('expiresAt', NEW.access_expires_at);
    ELSIF OLD.access_expires_at IS NOT NULL AND NEW.access_expires_at > OLD.access_expires_at THEN
      NEW.independent_access := jsonb_build_object('expiresAt',
        CASE WHEN OLD.independent_access IS NOT NULL AND OLD.independent_access->>'expiresAt' IS NULL THEN NULL
          ELSE greatest(now(), (OLD.independent_access->>'expiresAt')::timestamptz)
            + (NEW.access_expires_at - OLD.access_expires_at) END);
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.grant_source IN ('free', 'manual') AND OLD.independent_access IS NULL THEN
    NEW.independent_access := jsonb_build_object('expiresAt', OLD.access_expires_at);
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.retain_independent_access() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER z_retain_independent_access BEFORE INSERT OR UPDATE ON public.user_product_access
FOR EACH ROW EXECUTE FUNCTION public.retain_independent_access();

CREATE FUNCTION public.record_order_access_term(p_user_id uuid, p_product_id uuid, p_duration integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  txid uuid;
  term_key text := p_user_id::text || ':' || p_product_id::text;
  restored jsonb := nullif(current_setting('sellf.event_context', true), '')::jsonb->'guest_dispute_terms'->p_product_id::text;
  term jsonb;
BEGIN
  SELECT t.id INTO txid FROM public.payment_transactions t
  WHERE t.id::text = coalesce(nullif(current_setting('sellf.transfer_order', true), ''), nullif(current_setting('sellf.paid_order', true), ''))
    AND (t.user_id = p_user_id OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id AND lower(u.email) = lower(t.customer_email))
      OR EXISTS (SELECT 1 FROM public.guest_purchases g WHERE g.transaction_id = t.id AND g.claimed_by_user_id = p_user_id))
    AND (t.product_id = p_product_id OR EXISTS (SELECT 1 FROM public.payment_line_items l WHERE l.transaction_id = t.id AND l.product_id = p_product_id)
      OR p_product_id IN (SELECT public.order_granted_components(t.id)))
    AND EXISTS (SELECT 1 FROM public.user_product_access a WHERE a.user_id = p_user_id AND a.product_id = p_product_id
      AND (t.status <> 'awaiting_payment' OR a.transfer_transaction_id = t.id))
  LIMIT 1;
  IF txid IS NULL THEN RETURN; END IF;
  SELECT CASE WHEN bool_or(duration IS NULL) THEN NULL ELSE max(duration) END INTO p_duration
  FROM (
    SELECT p_duration AS duration
    UNION ALL
    SELECT nullif(l.access_duration_override, 0) FROM public.payment_line_items l
      WHERE l.transaction_id = txid AND l.product_id = p_product_id AND l.access_duration_override IS NOT NULL
    UNION ALL
    SELECT p.auto_grant_duration_days FROM public.products p
      WHERE p.id = p_product_id AND p.id IN (SELECT public.order_granted_components(txid))
  ) periods;
  term := coalesce(restored, jsonb_build_object('grantedAt', now(), 'expiresAt',
    CASE WHEN p_duration IS NULL THEN NULL ELSE now() + make_interval(days => p_duration) END))
    || (SELECT jsonb_build_object('grantVersion', a.version, 'grantExpiresAt', a.access_expires_at)
      FROM public.user_product_access a WHERE a.user_id = p_user_id AND a.product_id = p_product_id);
  UPDATE public.payment_transactions SET access_terms = access_terms || jsonb_build_object(term_key,
    coalesce(access_terms->term_key, term) || (term - 'grantedAt' - 'expiresAt')) WHERE id = txid;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_order_access_term(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_order_access_term(uuid, uuid, integer) TO service_role;

CREATE FUNCTION public.order_access_expiry(p_transaction_id uuid, p_user_id uuid, p_product_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN t.access_terms ? (p_user_id::text || ':' || p_product_id::text)
    THEN (t.access_terms->(p_user_id::text || ':' || p_product_id::text)->>'expiresAt')::timestamptz
    ELSE CASE WHEN nullif(coalesce(l.access_duration_override, p.auto_grant_duration_days), 0) IS NULL THEN NULL
      ELSE coalesce(g.claimed_at, CASE WHEN coalesce((t.metadata->>'access_on_placement')::boolean, false) THEN t.created_at ELSE t.paid_at END, t.created_at)
        + make_interval(days => coalesce(l.access_duration_override, p.auto_grant_duration_days)) END END
  FROM public.payment_transactions t JOIN public.products p ON p.id = p_product_id
  LEFT JOIN LATERAL (SELECT li.access_duration_override FROM public.payment_line_items li
    WHERE li.transaction_id = t.id AND li.product_id = p_product_id AND li.item_type = 'order_bump' LIMIT 1) l ON true
  LEFT JOIN LATERAL (SELECT gp.claimed_at FROM public.guest_purchases gp
    WHERE gp.claimed_by_user_id = p_user_id AND (gp.transaction_id = t.id OR (gp.transaction_id IS NULL AND gp.session_id = t.session_id))
    ORDER BY gp.claimed_at LIMIT 1) g ON true
  WHERE t.id = p_transaction_id;
$$;
REVOKE EXECUTE ON FUNCTION public.order_access_expiry(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_access_expiry(uuid, uuid, uuid) TO service_role;

-- Preserve known legacy periods.
UPDATE public.user_product_access SET independent_access = jsonb_build_object('expiresAt', access_expires_at)
WHERE grant_source IN ('manual', 'free')
  OR (grant_source = 'unknown' AND subscription_id IS NULL AND transfer_transaction_id IS NULL);
WITH eligible AS MATERIALIZED (
  SELECT id, user_id, product_id, session_id, bundle_components_recorded_at
  FROM public.payment_transactions
  WHERE subscription_id IS NULL AND (status IN ('completed', 'partially_refunded')
    OR (status = 'awaiting_payment' AND coalesce((metadata->>'access_on_placement')::boolean, false)))
), buyers AS (
  SELECT id, user_id FROM eligible WHERE user_id IS NOT NULL
  UNION
  SELECT t.id, g.claimed_by_user_id FROM eligible t
  JOIN public.guest_purchases g ON g.transaction_id = t.id WHERE g.claimed_by_user_id IS NOT NULL
  UNION
  SELECT t.id, g.claimed_by_user_id FROM eligible t
  JOIN public.guest_purchases g ON g.session_id = t.session_id
  WHERE g.transaction_id IS NULL AND g.claimed_by_user_id IS NOT NULL
), products AS (
  SELECT id, product_id FROM eligible WHERE product_id IS NOT NULL
  UNION
  SELECT t.id, l.product_id FROM eligible t JOIN public.payment_line_items l ON l.transaction_id = t.id
  UNION
  SELECT t.id, c.component_product_id FROM eligible t JOIN public.order_bundle_components c ON c.transaction_id = t.id
  UNION
  SELECT t.id, b.component_product_id FROM eligible t JOIN public.bundle_items b ON b.bundle_product_id = t.product_id
  WHERE t.bundle_components_recorded_at IS NULL
), known AS (
  SELECT t.id, jsonb_object_agg(a.user_id::text || ':' || a.product_id::text,
    jsonb_build_object('grantedAt', a.access_granted_at, 'expiresAt', a.access_expires_at,
      'grantVersion', a.version, 'grantExpiresAt', a.access_expires_at)) AS terms
  FROM eligible t JOIN buyers u ON u.id = t.id JOIN products p ON p.id = t.id
  JOIN public.user_product_access a ON a.user_id = u.user_id AND a.product_id = p.product_id
  WHERE a.subscription_id IS NULL AND (a.transfer_transaction_id IS NULL OR a.transfer_transaction_id = t.id)
  GROUP BY t.id
)
UPDATE public.payment_transactions t SET access_terms = known.terms || t.access_terms
FROM known WHERE t.id = known.id;
-- End legacy period preservation.

DO $$
DECLARE definition text; fn text; record_call text;
BEGIN
  FOR fn, record_call IN VALUES
    ('public.grant_product_access_service_role(uuid,uuid,integer,integer)',
      'PERFORM public.record_order_access_term(user_id_param, product_id_param, (SELECT CASE WHEN override_duration_days_param IS NULL THEN auto_grant_duration_days ELSE nullif(override_duration_days_param, 0) END FROM public.products WHERE id = product_id_param));'),
    ('public.grant_bundle_component_access(uuid,uuid,integer)',
      'PERFORM public.record_order_access_term(user_id_param, product_id_param, (SELECT auto_grant_duration_days FROM public.products WHERE id = product_id_param));')
  LOOP
    definition := pg_get_functiondef(fn::regprocedure);
    IF strpos(definition, 'RETURN result;') = 0 THEN RAISE EXCEPTION 'Unexpected access wrapper'; END IF;
    definition := regexp_replace(definition, E'BEGIN\n', E'BEGIN\n' || $guard$  IF EXISTS (SELECT 1 FROM public.payment_transactions t
    WHERE t.id::text = nullif(current_setting('sellf.transfer_payment', true), '')
      AND t.access_terms ? (user_id_param::text || ':' || product_id_param::text)) THEN
    RETURN jsonb_build_object('success', true, 'operation', 'existing_transfer');
  END IF;
$guard$);
    EXECUTE replace(definition, 'RETURN result;', 'IF (result->>''success'')::boolean THEN ' || record_call || ' END IF; RETURN result;');
  END LOOP;
END $$;

CREATE FUNCTION public.revoke_order_product_access(p_transaction_id uuid, p_user_id uuid, p_product_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.payment_transactions; current_access public.user_product_access;
  remaining integer; permanent boolean; expires timestamptz; removed integer; suspended boolean; pending_disputes text[]; next_version integer;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.payment_transactions WHERE id = p_transaction_id;
  IF NOT FOUND OR p_user_id IS NULL THEN RETURN false; END IF;
  PERFORM 1 FROM public.payment_disputes d
  WHERE NOT d.closed AND EXISTS (SELECT 1 FROM jsonb_array_elements(d.account_access) item
    WHERE item->>'user_id' = p_user_id::text AND item->>'product_id' = p_product_id::text)
  ORDER BY d.stripe_dispute_id FOR UPDATE;
  SELECT * INTO current_access FROM public.user_product_access WHERE user_id = p_user_id AND product_id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT array_agg(d.stripe_dispute_id) INTO pending_disputes FROM public.payment_disputes d
  WHERE NOT d.closed AND d.status <> 'won' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(d.account_access) item WHERE item->>'id' = current_access.id::text
      AND (d.suspended_at = current_access.access_expires_at
        OR ((item->>'retainedVersion')::integer = current_access.version
          AND current_access.access_expires_at IS NOT DISTINCT FROM (item->>'retainedExpiresAt')::timestamptz)
        OR EXISTS (SELECT 1 FROM public.payment_transactions o
          WHERE (o.access_terms->(p_user_id::text || ':' || p_product_id::text)->>'grantVersion')::integer = current_access.version
            AND (o.access_terms->(p_user_id::text || ':' || p_product_id::text)->>'grantedAt')::timestamptz = current_access.access_granted_at
            AND current_access.access_expires_at IS NOT DISTINCT FROM
              (o.access_terms->(p_user_id::text || ':' || p_product_id::text)->>'grantExpiresAt')::timestamptz)));
  suspended := coalesce(cardinality(pending_disputes), 0) > 0;
  WITH sources AS (
    SELECT (current_access.independent_access->>'expiresAt')::timestamptz AS ends_at
    WHERE current_access.independent_access IS NOT NULL
    UNION ALL
    SELECT public.order_access_expiry(o.id, p_user_id, p_product_id) AS ends_at
    FROM public.payment_transactions o
    WHERE o.id <> t.id AND o.subscription_id IS NULL
      AND (o.status IN ('completed', 'partially_refunded')
        OR (o.status = 'awaiting_payment' AND coalesce((o.metadata->>'access_on_placement')::boolean, false)
          AND (o.access_terms ? (p_user_id::text || ':' || p_product_id::text) OR current_access.transfer_transaction_id = o.id)))
      AND (o.amount = 0 OR coalesce(o.refunded_amount, 0) < o.amount)
      AND (o.user_id = p_user_id OR EXISTS (
        SELECT 1 FROM public.guest_purchases g WHERE g.claimed_by_user_id = p_user_id
          AND (g.transaction_id = o.id OR (g.transaction_id IS NULL AND g.session_id = o.session_id))))
      AND (o.product_id = p_product_id
        OR EXISTS (SELECT 1 FROM public.payment_line_items l WHERE l.transaction_id = o.id AND l.product_id = p_product_id)
        OR p_product_id IN (SELECT public.order_granted_components(o.id)))
    UNION ALL
    SELECT CASE WHEN s.status = 'canceled' THEN s.paid_access_expires_at ELSE NULL END
    FROM public.subscriptions s WHERE s.user_id = p_user_id AND s.product_id = p_product_id
      AND s.id IS DISTINCT FROM t.subscription_id
      AND ((s.status IN ('active', 'trialing', 'past_due') AND (s.current_period_end IS NULL OR s.current_period_end > now()))
        OR (s.status = 'canceled' AND s.paid_access_expires_at > now()))
    UNION ALL
    SELECT least(other.access_expires_at, CASE WHEN component.auto_grant_duration_days IS NULL THEN NULL
      ELSE other.access_granted_at + make_interval(days => component.auto_grant_duration_days) END)
    FROM public.user_product_access other
    JOIN public.bundle_items b ON b.bundle_product_id = other.product_id
    JOIN public.products component ON component.id = b.component_product_id
    WHERE other.user_id = p_user_id AND other.product_id IS DISTINCT FROM t.product_id
      AND b.component_product_id = p_product_id
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_transactions o WHERE o.product_id = other.product_id
          AND (o.status IN ('completed', 'partially_refunded', 'disputed')
            OR (o.status = 'awaiting_payment' AND coalesce((o.metadata->>'access_on_placement')::boolean, false)))
          AND (o.user_id = p_user_id OR EXISTS (
            SELECT 1 FROM public.guest_purchases g WHERE g.claimed_by_user_id = p_user_id
              AND (g.transaction_id = o.id OR (g.transaction_id IS NULL AND g.session_id = o.session_id)))))
  )
  SELECT count(*), bool_or(ends_at IS NULL), max(ends_at) INTO remaining, permanent, expires
  FROM sources WHERE ends_at IS NULL OR ends_at > now();
  IF remaining > 0 THEN
    expires := CASE WHEN permanent THEN NULL ELSE expires END;
    IF NOT suspended THEN expires := least(current_access.access_expires_at, expires); END IF;
  ELSIF suspended THEN
    SELECT max(greatest(current_access.access_granted_at, d.suspended_at)) INTO expires
    FROM public.payment_disputes d JOIN public.payment_transactions o ON o.id = d.transaction_id
    WHERE d.stripe_dispute_id = ANY(pending_disputes) AND d.transaction_id <> t.id AND o.status = 'disputed';
  END IF;
  IF remaining > 0 OR expires IS NOT NULL THEN
    next_version := current_access.version + CASE WHEN current_access.access_expires_at IS DISTINCT FROM expires THEN 1 ELSE 0 END;
    UPDATE public.user_product_access SET access_expires_at = expires, expiry_notified_at = NULL, version = next_version,
      subscription_id = CASE WHEN subscription_id = t.subscription_id THEN NULL ELSE subscription_id END,
      transfer_transaction_id = CASE WHEN transfer_transaction_id = t.id THEN NULL ELSE transfer_transaction_id END
    WHERE user_id = p_user_id AND product_id = p_product_id
      AND (access_expires_at IS DISTINCT FROM expires OR subscription_id = t.subscription_id OR transfer_transaction_id = t.id);
    IF suspended THEN
      UPDATE public.payment_disputes d SET account_access = (
        SELECT jsonb_agg(CASE WHEN item->>'id' = current_access.id::text THEN
          jsonb_set(item, '{access_expires_at}', coalesce(to_jsonb(least((item->>'access_expires_at')::timestamptz,
            public.order_access_expiry(d.transaction_id, p_user_id, p_product_id))), 'null'::jsonb))
            || jsonb_build_object('retainedVersion', next_version, 'retainedExpiresAt', expires, 'retainedDuration', current_access.access_duration_days) ELSE item END)
        FROM jsonb_array_elements(d.account_access) item)
      WHERE d.stripe_dispute_id = ANY(pending_disputes);
    END IF;
    RETURN false;
  END IF;
  DELETE FROM public.user_product_access WHERE user_id = p_user_id AND product_id = p_product_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed > 0;
END $$;
REVOKE EXECUTE ON FUNCTION public.revoke_order_product_access(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_order_product_access(uuid, uuid, uuid) TO service_role;

CREATE FUNCTION public.revoke_order_bundle_components(p_transaction_id uuid, p_user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.payment_transactions; removed integer := 0; candidate uuid;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.payment_transactions WHERE id = p_transaction_id;
  IF NOT FOUND OR p_user_id IS NULL THEN RETURN 0; END IF;
  FOR candidate IN
    SELECT a.product_id FROM public.user_product_access a
  WHERE a.user_id = p_user_id
    AND a.product_id IN (SELECT public.order_granted_components(t.id))
    AND a.product_id IS DISTINCT FROM t.product_id
    AND a.subscription_id IS NULL
  ORDER BY a.product_id
  LOOP
    IF public.revoke_order_product_access(t.id, p_user_id, candidate) THEN removed := removed + 1; END IF;
  END LOOP;
  RETURN removed;
END $$;
REVOKE EXECUTE ON FUNCTION public.revoke_order_bundle_components(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_order_bundle_components(uuid, uuid) TO service_role;

CREATE FUNCTION public.reconcile_refunded_subscription_access(p_transaction_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.user_product_access;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  FOR a IN SELECT access.* FROM public.user_product_access access
    JOIN public.payment_transactions t ON t.subscription_id = access.subscription_id
    WHERE t.id = p_transaction_id ORDER BY access.id
  LOOP
    PERFORM public.revoke_order_product_access(p_transaction_id, a.user_id, a.product_id);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.reconcile_refunded_subscription_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_refunded_subscription_access(uuid) TO service_role;

DO $$
DECLARE fn text; definition text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.end_refunded_subscription()', 'public.end_refunded_subscription_access()'] LOOP
    definition := pg_get_functiondef(fn::regprocedure);
    IF definition !~ 'DELETE FROM public.user_product_access WHERE subscription_id=' THEN
      RAISE EXCEPTION 'Unexpected subscription access definition';
    END IF;
    EXECUTE regexp_replace(definition, 'DELETE FROM public.user_product_access WHERE subscription_id=[^;]+;',
      'PERFORM public.reconcile_refunded_subscription_access(NEW.id);');
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.release_transfer_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE buyer uuid; product uuid;
BEGIN
  IF (NEW.status = 'cancelled' AND OLD.status = 'awaiting_payment')
    OR (NEW.status = 'refunded' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    IF NEW.status = 'refunded' OR OLD.access_terms <> '{}'::jsonb
      OR EXISTS (SELECT 1 FROM public.user_product_access WHERE transfer_transaction_id = NEW.id) THEN
    FOR buyer IN
      SELECT NEW.user_id WHERE NEW.user_id IS NOT NULL
      UNION SELECT claimed_by_user_id FROM public.guest_purchases
        WHERE transaction_id = NEW.id AND claimed_by_user_id IS NOT NULL
      ORDER BY 1
    LOOP
      FOR product IN
        SELECT NEW.product_id WHERE NEW.product_id IS NOT NULL
        UNION SELECT product_id FROM public.payment_line_items WHERE transaction_id = NEW.id
        UNION SELECT public.order_granted_components(NEW.id)
        ORDER BY 1
      LOOP
        IF NEW.status = 'refunded' OR OLD.access_terms ? (buyer::text || ':' || product::text)
          OR EXISTS (SELECT 1 FROM public.user_product_access a WHERE a.user_id = buyer
            AND a.product_id = product AND a.transfer_transaction_id = NEW.id) THEN
          PERFORM public.revoke_order_product_access(NEW.id, buyer, product);
        END IF;
      END LOOP;
    END LOOP;
    END IF;
    DELETE FROM public.guest_purchases WHERE transaction_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

-- The grant primitive takes the order it grants for: a bundle bought in that order grants the
-- components recorded for the order (recording them first if needed), so the grant and a later
-- refund or dispute act on the same set. Without an order (free and manual grants) it grants the
-- bundle's current composition, as before.
DROP FUNCTION public.grant_product_and_bundle_components(uuid, uuid, integer);
CREATE FUNCTION public.grant_product_and_bundle_components(
  user_id_param uuid,
  product_id_param uuid,
  override_duration_days_param integer DEFAULT NULL,
  transaction_id_param uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  previous_paid_order text := current_setting('sellf.paid_order', true);
  is_bundle_var boolean;
  order_scoped boolean;
  comp_rec record;
  comp_result jsonb;
  granted integer := 0;
BEGIN
  PERFORM set_config('sellf.paid_order', coalesce(transaction_id_param::text, ''), true);
  PERFORM public.grant_product_access_service_role(
    user_id_param, product_id_param, override_duration_days_param => override_duration_days_param
  );
  granted := granted + 1;

  SELECT is_bundle INTO is_bundle_var FROM public.products WHERE id = product_id_param;
  IF is_bundle_var IS TRUE THEN
    order_scoped := transaction_id_param IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.payment_transactions WHERE id = transaction_id_param AND product_id = product_id_param);
    IF order_scoped THEN PERFORM public.snapshot_order_bundle_components(transaction_id_param); END IF;
    FOR comp_rec IN
      SELECT c.component_product_id FROM (
        SELECT g AS component_product_id FROM public.order_granted_components(transaction_id_param) g WHERE order_scoped
        UNION ALL
        SELECT b.component_product_id FROM public.bundle_items b WHERE NOT order_scoped AND b.bundle_product_id = product_id_param
      ) c
      LEFT JOIN public.bundle_items d ON d.bundle_product_id = product_id_param AND d.component_product_id = c.component_product_id
      ORDER BY d.display_order NULLS LAST
    LOOP
      BEGIN
        -- Grants the component regardless of is_active (an inactive component is a SUCCESS).
        comp_result := public.grant_bundle_component_access(user_id_param, comp_rec.component_product_id);
        IF COALESCE((comp_result->>'success')::boolean, false) THEN
          granted := granted + 1;
        ELSE
          BEGIN
            PERFORM public.log_admin_action(
              'bundle_component_grant_failure', 'bundle_items', product_id_param::text,
              jsonb_build_object('severity', 'ERROR', 'user_id', user_id_param,
                'component_product_id', comp_rec.component_product_id,
                'error', comp_result->>'error',
                'function_name', 'grant_product_and_bundle_components')
            );
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- One bad component must not block the rest of the bundle; logging can never escape this loop.
        BEGIN
          PERFORM public.log_admin_action(
            'bundle_component_grant_failure', 'bundle_items', product_id_param::text,
            jsonb_build_object('severity', 'ERROR', 'user_id', user_id_param,
              'component_product_id', comp_rec.component_product_id,
              'error_code', SQLSTATE, 'error_message', SQLERRM,
              'function_name', 'grant_product_and_bundle_components')
          );
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END;
    END LOOP;
  END IF;

  PERFORM set_config('sellf.paid_order', coalesce(previous_paid_order, ''), true);
  RETURN jsonb_build_object('success', true, 'granted', granted);
END $$;
REVOKE EXECUTE ON FUNCTION public.grant_product_and_bundle_components(uuid, uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_product_and_bundle_components(uuid, uuid, integer, uuid) TO service_role;

-- A paid order can be claimed after the offer is withdrawn; new grants still require an active offer.
DO $$
DECLARE definition text; original text := 'WHERE id = product_id_param AND is_active = true;';
BEGIN
  definition := pg_get_functiondef('public.grant_product_access_service_role_impl(uuid,uuid,integer,integer)'::regprocedure);
  IF (length(definition) - length(replace(definition, original, ''))) / length(original) <> 1 THEN
    RAISE EXCEPTION 'Unexpected product grant definition';
  END IF;
  EXECUTE replace(definition, original, $clause$
    WHERE id = product_id_param AND (is_active = true OR EXISTS (
      SELECT 1 FROM public.payment_transactions t JOIN auth.users u ON u.id = user_id_param
      WHERE t.id::text IN (current_setting('sellf.paid_order', true), current_setting('sellf.transfer_order', true))
        AND (t.product_id = product_id_param OR EXISTS (SELECT 1 FROM public.payment_line_items l
          WHERE l.transaction_id = t.id AND l.product_id = product_id_param))
        AND t.status IN ('completed', 'partially_refunded')
        AND (t.amount = 0 OR coalesce(t.refunded_amount, 0) < t.amount)
        AND (t.user_id = user_id_param OR (t.user_id IS NULL AND lower(t.customer_email) = lower(u.email)))
    ));$clause$);
END $$;

-- Order completion, a guest's claim and the repeated-verification claim pass their order to the
-- grant primitive. The current definitions are patched in place, so changes made by other
-- migrations survive.
DO $$
DECLARE definition text; fn text; old_call text; new_call text;
BEGIN
  FOR fn, old_call, new_call IN VALUES
    ('public._order_grant_and_record(uuid,uuid,uuid,uuid,uuid,text)',
      'grant_product_and_bundle_components(p_user_id,tx.product_id);',
      E'grant_product_and_bundle_components(p_user_id,tx.product_id,NULL,tx.id);\n    PERFORM set_config(\'sellf.paid_order\',tx.id::text,true);'),
    ('public._claim_guest_purchases_before_disputes(uuid)',
      'grant_product_and_bundle_components(p_user_id,claim.product_id);',
      'grant_product_and_bundle_components(p_user_id,claim.product_id,NULL,claim.transaction_id);'),
    ('public._process_stripe_payment_completion_with_bump_impl(text,uuid,text,numeric,text,text,uuid,uuid[],uuid,numeric,boolean)',
      'grant_product_and_bundle_components(current_user_id, product_id_param);',
      E'grant_product_and_bundle_components(current_user_id, product_id_param, NULL, existing_transaction_id);\n            PERFORM set_config(\'sellf.paid_order\',existing_transaction_id::text,true);')
  LOOP
    definition := pg_get_functiondef(fn::regprocedure);
    IF (length(definition) - length(replace(definition, old_call, ''))) / length(old_call) <> 1 THEN
      RAISE EXCEPTION 'Unexpected definition of %', fn;
    END IF;
    EXECUTE replace(definition, old_call, new_call);
  END LOOP;

  -- Dispute terms a newly claimable order supersedes: the components that order grants.
  definition := pg_get_functiondef('public.claim_guest_purchases_for_user(uuid)'::regprocedure);
  old_call := 'OR EXISTS(SELECT 1 FROM public.bundle_items b WHERE b.bundle_product_id=g.product_id AND b.component_product_id=p.id)';
  IF (length(definition) - length(replace(definition, old_call, ''))) / length(old_call) <> 1 THEN
    RAISE EXCEPTION 'Unexpected guest claim definition';
  END IF;
  EXECUTE replace(definition, old_call,
    E'OR EXISTS(SELECT 1 FROM public.payment_transactions o WHERE (o.id=g.transaction_id OR (g.transaction_id IS NULL AND o.session_id=g.session_id))\n      AND o.product_id=g.product_id AND p.id IN (SELECT public.order_granted_components(o.id)))\n    OR (NOT EXISTS(SELECT 1 FROM public.payment_transactions o WHERE o.id=g.transaction_id OR (g.transaction_id IS NULL AND o.session_id=g.session_id))\n      AND EXISTS(SELECT 1 FROM public.bundle_items b WHERE b.bundle_product_id=g.product_id AND b.component_product_id=p.id))');
END $$;

CREATE FUNCTION public.settle_transfer_product_access(p_transaction_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tx public.payment_transactions; recipient record;
  previous_payment text := current_setting('sellf.transfer_payment', true);
  previous_order text := current_setting('sellf.paid_order', true);
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT tx FROM public.payment_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF tx.status <> 'completed' OR tx.payment_provider <> 'bank_transfer' THEN RETURN; END IF;
  PERFORM set_config('sellf.transfer_payment', tx.id::text, true);
  PERFORM set_config('sellf.paid_order', tx.id::text, true);
  FOR recipient IN
    SELECT tx.user_id AS buyer, tx.product_id AS product, NULL::integer AS duration
    UNION
    SELECT tx.user_id, l.product_id, l.access_duration_override FROM public.payment_line_items l
      WHERE l.transaction_id = tx.id AND l.item_type = 'order_bump'
    UNION
    SELECT g.claimed_by_user_id, g.product_id, l.access_duration_override FROM public.guest_purchases g
      LEFT JOIN public.payment_line_items l ON l.transaction_id = tx.id AND l.product_id = g.product_id AND l.item_type = 'order_bump'
      WHERE g.transaction_id = tx.id AND g.claimed_by_user_id IS NOT NULL
    ORDER BY 1, 2, 3
  LOOP
    IF recipient.buyer IS NOT NULL THEN
      PERFORM public.grant_product_and_bundle_components(recipient.buyer, recipient.product, recipient.duration, tx.id);
    END IF;
  END LOOP;
  PERFORM set_config('sellf.transfer_payment', coalesce(previous_payment, ''), true);
  PERFORM set_config('sellf.paid_order', coalesce(previous_order, ''), true);
END $$;
REVOKE EXECUTE ON FUNCTION public.settle_transfer_product_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_transfer_product_access(uuid) TO service_role;

DO $$
DECLARE definition text; previous text := 'RETURN jsonb_build_object(''success'',true,''access_granted'',true); END IF;';
BEGIN
  definition := pg_get_functiondef('public._order_grant_and_record(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure);
  IF strpos(definition, previous) = 0 THEN RAISE EXCEPTION 'Unexpected placement payment definition'; END IF;
  EXECUTE replace(definition, previous, 'PERFORM public.settle_transfer_product_access(tx.id); ' || previous);
END $$;

-- Sale counters acquire product rows in the same order for every cart.
DO $$
DECLARE definition text;
  old_loop text := 'FROM public.payment_line_items WHERE transaction_id=tx.id LOOP';
BEGIN
  definition := pg_get_functiondef('public._order_grant_and_record(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure);
  IF (length(definition) - length(replace(definition, old_loop, ''))) / length(old_loop) <> 1 THEN
    RAISE EXCEPTION 'Unexpected sale fulfillment definition';
  END IF;
  EXECUTE replace(definition, old_loop, 'FROM public.payment_line_items WHERE transaction_id=tx.id ORDER BY product_id LOOP');
END $$;




-- ===== Disputes act on the components the order granted =====
-- Same function as in 20261110235906; only the bundle product set changes: the main bundle's
-- components come from the order's record (order_granted_components) instead of the bundle's
-- current composition.
CREATE OR REPLACE FUNCTION public.apply_payment_dispute_before_guest_claim(p_transaction_id uuid, p_dispute_id text, p_status text, p_closed boolean, p_reason text, p_amount integer, p_currency text, p_created timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  t public.payment_transactions;
  d public.payment_disputes;
  original jsonb; item jsonb; result jsonb; product_ids uuid[]; buyer_ids uuid[];
  stamp timestamptz := now();
  restored_access jsonb := '[]'; term record; restored_until timestamptz;
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
  SELECT * INTO d FROM public.payment_disputes WHERE stripe_dispute_id=p_dispute_id FOR UPDATE;
  IF FOUND THEN
    IF d.transaction_id<>t.id THEN RAISE EXCEPTION 'Dispute binding differs'; END IF;
    IF d.closed AND (NOT p_closed OR d.status<>p_status) THEN RETURN NULL; END IF;
    IF d.status=p_status AND d.closed=p_closed THEN RETURN d.payload; END IF;
  ELSE
    SELECT array_agg(DISTINCT id) INTO product_ids FROM (
      SELECT t.product_id id UNION SELECT product_id FROM public.payment_line_items WHERE transaction_id=t.id
      UNION SELECT public.order_granted_components(t.id)
      UNION SELECT b.component_product_id FROM public.bundle_items b JOIN public.payment_line_items l
        ON l.product_id=b.bundle_product_id WHERE l.transaction_id=t.id AND l.product_id IS DISTINCT FROM t.product_id
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
      FOR license IN SELECT l.id FROM public.issued_licenses l WHERE l.order_id=ANY(public.license_order_references(t)) AND l.revoked_at IS NULL ORDER BY l.id FOR UPDATE
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
      PERFORM l.id FROM public.issued_licenses l WHERE l.order_id=ANY(public.license_order_references(t)) ORDER BY l.id FOR UPDATE;
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
          UPDATE public.user_product_access a SET access_expires_at=CASE WHEN item ? 'retainedVersion' THEN
              CASE WHEN a.access_expires_at IS NULL OR item->>'access_expires_at' IS NULL THEN NULL
                ELSE greatest(a.access_expires_at, (item->>'access_expires_at')::timestamptz) END
              ELSE (item->>'access_expires_at')::timestamptz END,
            expiry_notified_at=(item->>'expiry_notified_at')::timestamptz
            WHERE id=(item->>'id')::uuid AND (access_expires_at=d.suspended_at
              OR (version=(item->>'retainedVersion')::integer
                AND access_expires_at IS NOT DISTINCT FROM (item->>'retainedExpiresAt')::timestamptz))
              AND user_id=(item->>'user_id')::uuid AND product_id=(item->>'product_id')::uuid
              AND subscription_id IS NOT DISTINCT FROM (item->>'subscription_id')::uuid
              AND access_duration_days IS NOT DISTINCT FROM CASE WHEN item ? 'retainedVersion'
                THEN (item->>'retainedDuration')::integer ELSE (item->>'access_duration_days')::integer END
            RETURNING a.access_expires_at INTO restored_until;
          GET DIAGNOSTICS changed=ROW_COUNT; restored := restored OR changed>0;
          IF changed>0 THEN restored_access:=restored_access||jsonb_build_array(jsonb_build_object(
            'productId',item->'product_id','userId',item->'user_id','grantedAt',item->'access_granted_at','expiresAt',restored_until)); END IF;
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
REVOKE EXECUTE ON FUNCTION public.apply_payment_dispute_before_guest_claim(uuid,text,text,boolean,text,integer,text,timestamptz) FROM PUBLIC, anon, authenticated, service_role;


-- ===== Coupon checks hold a limited slot only when the payment starts =====
-- verify_coupon gains reserve_param (default true): storefront preview checks pass false, so only
-- the server paths that create or update a payment session reserve a slot. The function is called
-- by the server only (service role); the storefront roles lose EXECUTE.
DROP FUNCTION public.verify_coupon(text, uuid, text, text);
DROP FUNCTION public._reserve_coupon(uuid, uuid, text, text);

CREATE FUNCTION public._reserve_coupon(coupon_id_param uuid, product_id_param uuid, customer_email_param text, currency_param text, reserve_param boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  coupon_record RECORD;
  user_usage_count INTEGER; reserved_count INTEGER; available_slots INTEGER;
  existing_reservation_id UUID;
  clean_email TEXT;
BEGIN
  IF customer_email_param IS NOT NULL THEN
    clean_email := lower(trim(customer_email_param));
    IF clean_email ~ '[^[:print:]]' THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Invalid email format');
    END IF;
    IF clean_email = '' OR clean_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Invalid email');
    END IF;
  ELSE
    clean_email := NULL;
  END IF;
  SELECT * INTO coupon_record
  FROM public.coupons
  WHERE id = coupon_id_param
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid code');
  END IF;
  DELETE FROM public.coupon_reservations
  WHERE coupon_id = coupon_id_param AND expires_at < NOW();
  IF coupon_record.discount_type IN ('fixed', 'set_price') AND coupon_record.currency IS NOT NULL AND upper(coupon_record.currency) != upper(currency_param) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Code invalid for this currency');
  END IF;
  IF jsonb_array_length(coupon_record.allowed_product_ids) > 0 THEN
    IF NOT (coupon_record.allowed_product_ids @> to_jsonb(product_id_param)) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code not valid for this product');
    END IF;
  END IF;
  IF jsonb_array_length(coupon_record.allowed_emails) > 0 THEN
    IF clean_email IS NULL OR NOT (coupon_record.allowed_emails @> to_jsonb(clean_email)) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code not authorized for this email');
    END IF;
  END IF;
  IF clean_email IS NOT NULL THEN
    SELECT COUNT(*) INTO user_usage_count
    FROM public.coupon_redemptions
    WHERE coupon_id = coupon_record.id AND customer_email = clean_email;
    IF user_usage_count >= coupon_record.usage_limit_per_user THEN
      RETURN jsonb_build_object('valid', false, 'error', 'You have already used this code');
    END IF;
  END IF;
  IF clean_email IS NOT NULL THEN
    SELECT id INTO existing_reservation_id
    FROM public.coupon_reservations
    WHERE coupon_id = coupon_record.id
      AND customer_email = clean_email
      AND expires_at > NOW();
    IF existing_reservation_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'valid', true, 'id', coupon_record.id,
        'code', coupon_record.code, 'discount_type', coupon_record.discount_type,
        'discount_value', coupon_record.discount_value, 'exclude_order_bumps', coupon_record.exclude_order_bumps,
        'allowed_product_ids', coupon_record.allowed_product_ids, 'already_reserved', true,
        'reservation_id', existing_reservation_id
      );
    END IF;
  END IF;
  IF coupon_record.usage_limit_global IS NOT NULL THEN
    SELECT COUNT(*) INTO reserved_count
    FROM public.coupon_reservations
    WHERE coupon_id = coupon_record.id AND expires_at > NOW();
    available_slots := coupon_record.usage_limit_global
                     - coupon_record.current_usage_count
                     - reserved_count;
    IF available_slots <= 0 THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Code usage limit reached');
    END IF;
  END IF;
  IF clean_email IS NOT NULL AND reserve_param THEN
    INSERT INTO public.coupon_reservations (coupon_id, customer_email, expires_at)
    VALUES (coupon_record.id, clean_email, NOW() + INTERVAL '15 minutes')
    ON CONFLICT (coupon_id, customer_email) DO UPDATE
    SET expires_at = NOW() + INTERVAL '15 minutes',
        reserved_at = NOW();
  END IF;
  RETURN jsonb_build_object(
    'valid', true, 'id', coupon_record.id,
    'code', coupon_record.code, 'discount_type', coupon_record.discount_type,
    'discount_value', coupon_record.discount_value, 'exclude_order_bumps', coupon_record.exclude_order_bumps,
    'allowed_product_ids', coupon_record.allowed_product_ids, 'reserved', reserve_param,
    'expires_in_minutes', CASE WHEN reserve_param THEN 15 END
  );
END;
$_$;
REVOKE EXECUTE ON FUNCTION public._reserve_coupon(uuid, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reserve_coupon(uuid, uuid, text, text, boolean) TO service_role;

CREATE FUNCTION public.verify_coupon(code_param text, product_id_param uuid, customer_email_param text DEFAULT NULL::text, currency_param text DEFAULT 'USD'::text, reserve_param boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  coupon_record public.coupons%ROWTYPE;
  clean_email text := lower(trim(customer_email_param));
BEGIN
  IF code_param IS NOT NULL AND length(code_param) > 0 THEN
    IF NOT public.check_rate_limit(
      'verify_coupon', 5, 60,
      'code:' || lower(left(code_param, 80)) || ':' ||
        COALESCE((select auth.uid())::text, clean_email, 'anonymous')
    ) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Too many attempts. Please try again later.');
    END IF;
  END IF;
  IF NOT public.check_rate_limit('verify_coupon', 100, 60) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Too many attempts. Please try again later.');
  END IF;
  SELECT * INTO coupon_record
  FROM public.coupons
  WHERE code = code_param AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid code');
  END IF;
  IF coupon_record.expires_at IS NOT NULL AND coupon_record.expires_at < NOW() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Code expired');
  END IF;
  IF coupon_record.starts_at > NOW() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Code not active yet');
  END IF;
  RETURN public._reserve_coupon(coupon_record.id, product_id_param, customer_email_param, currency_param, reserve_param);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verify_coupon(text, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_coupon(text, uuid, text, text, boolean) TO service_role;

-- ===== Mail retry queue: license mails first, a re-sent link keeps its attempts =====
-- Refused license mails are claimed ahead of post-payment links. Re-sending a post-payment link
-- whose retries ran out puts it back with its attempt count and a fresh wait, so it is not due at
-- once with a full set of attempts; a repeated license grant still starts over (unchanged).
CREATE OR REPLACE FUNCTION public.claim_auth_mail_retries(p_limit integer DEFAULT 20)
RETURNS SETOF public.auth_mail_retries LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- A purged license mail was never delivered: dropping its receipt lets a repeated grant send it again.
  WITH purged AS (
    DELETE FROM public.auth_mail_retries WHERE given_up_at < now() - interval '7 days' RETURNING license_mail_key
  )
  DELETE FROM public.license_mail_receipts r USING purged p WHERE r.mail_key = p.license_mail_key;
  RETURN QUERY
  UPDATE public.auth_mail_retries r SET attempts = r.attempts + 1, next_attempt_at = now() + interval '10 minutes'
  WHERE r.id IN (SELECT q.id FROM public.auth_mail_retries q WHERE q.given_up_at IS NULL AND q.next_attempt_at <= now()
    ORDER BY (q.kind = 'license') DESC, q.next_attempt_at LIMIT least(greatest(coalesce(p_limit, 20), 1), 100) FOR UPDATE SKIP LOCKED)
  RETURNING r.*;
END $$;
REVOKE EXECUTE ON FUNCTION public.claim_auth_mail_retries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_auth_mail_retries(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_auth_mail_retry(p_email text, p_redirect_to text, p_data jsonb, p_kind text, p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.auth_mail_retries(email, redirect_to, data, kind, next_attempt_at, last_error)
  VALUES (lower(btrim(p_email)), p_redirect_to, coalesce(p_data, '{}'::jsonb), p_kind, now() + interval '2 minutes', left(p_error, 40))
  ON CONFLICT (email, redirect_to) DO UPDATE SET data = CASE WHEN public.auth_mail_retries.kind='license' AND EXCLUDED.kind='post_checkout' THEN public.auth_mail_retries.data ELSE EXCLUDED.data END,
    kind = CASE WHEN public.auth_mail_retries.kind='license' THEN 'license' ELSE EXCLUDED.kind END, last_error = EXCLUDED.last_error,
    given_up_at = NULL,
    attempts = CASE WHEN public.auth_mail_retries.given_up_at IS NULL THEN public.auth_mail_retries.attempts
      WHEN public.auth_mail_retries.kind = 'post_checkout' AND EXCLUDED.kind = 'post_checkout' THEN public.auth_mail_retries.attempts
      ELSE 0 END,
    next_attempt_at = CASE WHEN public.auth_mail_retries.given_up_at IS NULL THEN public.auth_mail_retries.next_attempt_at
      ELSE greatest(public.auth_mail_retries.next_attempt_at, EXCLUDED.next_attempt_at) END;
$$;
REVOKE EXECUTE ON FUNCTION public.queue_auth_mail_retry(text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_auth_mail_retry(text, text, jsonb, text, text) TO service_role;

-- ===== An ended subscription stays ended =====
-- Stripe never reopens a canceled or expired subscription. A subscription event handled
-- concurrently with the cancellation may still carry an older, active snapshot: it must not
-- reopen the stored row, and it must not grant access through the ended subscription.
CREATE FUNCTION public.keep_ended_subscription_ended() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status IN ('canceled', 'incomplete_expired') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.keep_ended_subscription_ended() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER keep_ended_subscription_ended BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.keep_ended_subscription_ended();

CREATE FUNCTION public.refuse_access_from_ended_subscription() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.subscription_id IS NOT NULL AND NEW.access_expires_at IS NULL
    AND (TG_OP = 'INSERT' OR OLD.subscription_id IS DISTINCT FROM NEW.subscription_id)
    AND EXISTS (SELECT 1 FROM public.subscriptions s
      WHERE s.id = NEW.subscription_id AND s.status IN ('canceled', 'incomplete_expired')) THEN
    IF TG_OP = 'INSERT' THEN RETURN NULL; END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.refuse_access_from_ended_subscription() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER refuse_access_from_ended_subscription BEFORE INSERT OR UPDATE OF subscription_id, access_expires_at
  ON public.user_product_access FOR EACH ROW EXECUTE FUNCTION public.refuse_access_from_ended_subscription();


-- ===== Bundle composition =====
CREATE OR REPLACE FUNCTION public.validate_bundle_item() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  parent public.products;
  component public.products;
BEGIN
  PERFORM 1 FROM public.products WHERE id IN (NEW.bundle_product_id, NEW.component_product_id) ORDER BY id FOR SHARE;
  SELECT * INTO parent FROM public.products WHERE id = NEW.bundle_product_id;
  SELECT * INTO component FROM public.products WHERE id = NEW.component_product_id;
  IF parent.is_bundle IS NOT TRUE OR component.id IS NULL OR component.is_bundle
    OR component.product_type <> 'one_time' THEN
    RAISE EXCEPTION 'Invalid bundle component' USING ERRCODE = '23514';
  END IF;
  IF component.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Archived products cannot be bundle components' USING ERRCODE = '23514', DETAIL = 'bundle_component_archived';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.validate_bundle_item() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_bundle_item() TO service_role;

CREATE FUNCTION public.keep_bundle_component_available() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.bundle_items WHERE component_product_id = NEW.id) THEN
    RAISE EXCEPTION 'Product belongs to bundles' USING ERRCODE = '2BP01';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.keep_bundle_component_available() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.keep_bundle_component_available() TO service_role;
CREATE TRIGGER keep_bundle_component_available BEFORE UPDATE OF archived_at ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.keep_bundle_component_available();

CREATE FUNCTION public.replace_bundle_items(p_bundle_id uuid, p_component_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.products WHERE id = p_bundle_id FOR NO KEY UPDATE;
  PERFORM 1 FROM public.products WHERE id = ANY(p_component_ids) ORDER BY id FOR SHARE;
  DELETE FROM public.bundle_items WHERE bundle_product_id = p_bundle_id;
  INSERT INTO public.bundle_items(bundle_product_id, component_product_id, display_order)
  SELECT p_bundle_id, component, ordinality - 1
  FROM unnest(p_component_ids) WITH ORDINALITY AS c(component, ordinality);
END $$;
REVOKE EXECUTE ON FUNCTION public.replace_bundle_items(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_bundle_items(uuid, uuid[]) TO service_role;


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
    'tier',tier,'license_domain',p_license.license_domain,'issuance_source',p_license.issuance_source,
    'issued_at',p_license.issued_at,'expires_at',p_license.expires_at,'revoked_at',p_license.revoked_at,'products',product,
    'customer_locale',p_license.customer_locale,'sellf_order_id',tx.id,'order_number',tx.order_number,
    'revocation_reason',CASE WHEN p_license.revoked_at IS NULL THEN NULL
      WHEN p_license.revoked_by_dispute_id IS NOT NULL THEN 'dispute'
      ELSE p_license.revocation_reason END);
END $$;
