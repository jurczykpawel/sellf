-- Purchase attribution snapshot: one set-based statement per INSERT instead of per-row work.
-- Measured (track_functions, 100k-row INSERT, quiet machine): the per-row trigger took 3.9 s of 9.2 s;
-- under release-gate load the checkout-funnel fixture hit the 60 s statement timeout.
-- Now: INSERT fires a statement trigger over the transition table. Plain paid orders (no subscription,
-- no coupon, no stored checkout attribution) get the 'unknown' snapshot in one INSERT ... SELECT;
-- orders with something to classify still go through the row path. Status changes (UPDATE OF status)
-- keep the row trigger, because transition tables cannot be combined with a column list.
-- Fail-safe unchanged: attribution never breaks a payment (the bulk insert falls back to the row path,
-- and the row path swallows its own errors).
-- @see 20261103120000_purchase_attribution.sql, 20261104000000_attribution_snapshot_cost.sql

-- ===== ROW PATH (one order) =====
CREATE FUNCTION public.snapshot_purchase_attribution_row(n public.payment_transactions) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  payload jsonb;
  prior public.purchase_attribution%ROWTYPE;
  sub_stripe text;
  sub_ref text;
  coupon uuid;
BEGIN
  IF n.status NOT IN ('completed','awaiting_payment','partially_refunded','refunded','disputed') THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_attribution WHERE transaction_id = n.id) THEN RETURN; END IF;
  BEGIN
    IF n.subscription_id IS NOT NULL THEN
      SELECT pa.* INTO prior FROM public.purchase_attribution pa
        JOIN public.payment_transactions pt ON pt.id = pa.transaction_id
        WHERE pt.subscription_id = n.subscription_id AND pt.id <> n.id ORDER BY pa.created_at LIMIT 1;
      IF prior.id IS NOT NULL THEN
        INSERT INTO public.purchase_attribution
          SELECT (jsonb_populate_record(NULL::public.purchase_attribution, to_jsonb(prior) || jsonb_build_object(
            'id', gen_random_uuid(), 'transaction_id', n.id, 'kind', 'renewal',
            'click_id', NULL, 'click_id_expires_at', NULL, 'created_at', now()))).*
          ON CONFLICT DO NOTHING;
        RETURN;
      END IF;
      SELECT s.stripe_subscription_id, s.metadata->>'sf_attr_ref' INTO sub_stripe, sub_ref
        FROM public.subscriptions s WHERE s.id = n.subscription_id;
    END IF;
    SELECT ca.payload INTO payload FROM public.checkout_attribution ca
      WHERE ca.ref IN (n.session_id, n.stripe_payment_intent_id, n.id::text, n.metadata->>'sf_attr_ref', sub_stripe, sub_ref)
      ORDER BY ca.created_at DESC LIMIT 1;
    -- to_jsonb: also runs against historical table shapes without coupon_id (order-schema backfill test).
    coupon := CASE WHEN to_jsonb(n)->>'coupon_id' IS NOT NULL THEN (to_jsonb(n)->>'coupon_id')::uuid END;
    IF coupon IS NULL AND n.metadata->>'coupon_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      coupon := (n.metadata->>'coupon_id')::uuid;
    END IF;
    PERFORM public.insert_purchase_attribution(n.id, n.product_id, n.user_id,
      CASE WHEN n.subscription_id IS NOT NULL THEN 'subscription'
           WHEN n.payment_provider = 'bank_transfer' THEN 'bank_transfer' ELSE 'payment' END,
      payload, coupon);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'purchase attribution snapshot skipped for %: %', n.id, SQLERRM;
  END;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_purchase_attribution_row(public.payment_transactions) FROM PUBLIC, anon, authenticated;

-- ===== STATUS CHANGE (row trigger) =====
CREATE OR REPLACE FUNCTION public.snapshot_purchase_attribution() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.snapshot_purchase_attribution_row(NEW);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_purchase_attribution() FROM PUBLIC, anon, authenticated;

-- ===== INSERT (statement trigger) =====
CREATE FUNCTION public.snapshot_purchase_attribution_inserted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.payment_transactions;
  plain text;
BEGIN
  -- "Plain": nothing to classify, so the snapshot is the fixed 'unknown' row. coupon_id is checked
  -- only when the column exists (historical table shapes replayed by the order-schema backfill test).
  plain := format($p$t.subscription_id IS NULL AND t.metadata->>'coupon_id' IS NULL %s
    AND NOT EXISTS (SELECT 1 FROM public.checkout_attribution ca
      WHERE ca.ref IN (t.session_id, t.stripe_payment_intent_id, t.id::text, t.metadata->>'sf_attr_ref'))$p$,
    CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.payment_transactions'::regclass
      AND attname = 'coupon_id' AND NOT attisdropped) THEN 'AND t.coupon_id IS NULL' ELSE '' END);

  FOR r IN EXECUTE format($q$SELECT t.* FROM new_rows t
    WHERE t.status IN ('completed','awaiting_payment','partially_refunded','refunded','disputed') AND NOT (%s)$q$, plain)
  LOOP
    PERFORM public.snapshot_purchase_attribution_row(r);
  END LOOP;

  BEGIN
    EXECUTE format($q$INSERT INTO public.purchase_attribution(transaction_id, product_id, user_id, kind, channel, mode, consent, device_class)
      SELECT t.id, t.product_id, t.user_id,
        CASE WHEN t.payment_provider = 'bank_transfer' THEN 'bank_transfer' ELSE 'payment' END,
        'unknown', 'none', 'none', 'unknown'
      FROM new_rows t
      WHERE t.status IN ('completed','awaiting_payment','partially_refunded','refunded','disputed') AND %s
      ON CONFLICT DO NOTHING$q$, plain);
  EXCEPTION WHEN OTHERS THEN
    -- Attribution must never break a payment: retry order by order (each swallows its own error).
    RAISE WARNING 'bulk purchase attribution snapshot failed, retrying per order: %', SQLERRM;
    FOR r IN SELECT t.* FROM new_rows t LOOP
      PERFORM public.snapshot_purchase_attribution_row(r);
    END LOOP;
  END;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'purchase attribution snapshot skipped for this statement: %', SQLERRM;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_purchase_attribution_inserted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER snapshot_purchase_attribution ON public.payment_transactions;
CREATE TRIGGER snapshot_purchase_attribution AFTER UPDATE OF status ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_purchase_attribution();
CREATE TRIGGER snapshot_purchase_attribution_inserted AFTER INSERT ON public.payment_transactions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.snapshot_purchase_attribution_inserted();
