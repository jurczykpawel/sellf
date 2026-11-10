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
