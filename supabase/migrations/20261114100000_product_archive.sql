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
