

-- ===== REPORT (aggregates only, no personal data) =====
CREATE FUNCTION public.get_attribution_report(
  p_from timestamptz, p_to timestamptz, p_touch text DEFAULT 'last',
  p_group_by text[] DEFAULT NULL, p_product uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  dims constant text[] := ARRAY['channel','source','medium','campaign','content','term','referrer_host','landing_path',
    'product','country','device_class','affiliate','kind','day'];
  g text[] := coalesce(p_group_by, ARRAY['channel','source','medium','campaign','content']);
  first_touch boolean := p_touch = 'first';
  result jsonb;
BEGIN
  IF NOT ((select auth.role()) = 'service_role' OR (select public.is_admin())) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_touch NOT IN ('first','last')
     OR cardinality(g) > 8 OR NOT (g <@ dims) THEN
    RAISE EXCEPTION 'Invalid report parameters' USING ERRCODE = '22023';
  END IF;
  WITH base AS (
    SELECT pa.*, pr.slug AS product_slug, am.code AS affiliate_code,
      upper(coalesce(pt.currency, pr.currency)) AS cur,
      public.currency_minor_factor(upper(coalesce(pt.currency, pr.currency))) AS factor,
      coalesce(pt.amount, 0) AS gross_minor,
      CASE WHEN pt.status = 'disputed' THEN coalesce(pt.amount, 0) ELSE coalesce(pt.refunded_amount, 0) END AS refunded_minor,
      coalesce(pt.user_id::text, lower(pt.customer_email), pa.user_id::text) AS customer_key,
      (first_touch AND coalesce(pa.first_source, pa.first_medium, pa.first_campaign, pa.first_referrer_host, pa.first_landing_path) IS NOT NULL) AS use_first
    FROM public.purchase_attribution pa
    LEFT JOIN public.payment_transactions pt ON pt.id = pa.transaction_id
    LEFT JOIN public.products pr ON pr.id = pa.product_id
    LEFT JOIN public.affiliate_memberships am ON am.id = pa.affiliate_member_id
    WHERE pa.created_at >= p_from AND pa.created_at < p_to
      AND (pa.kind = 'free' OR pt.status IN ('completed','partially_refunded','refunded','disputed'))
      AND (p_product IS NULL OR pa.product_id = p_product)
  ), keyed AS (
    SELECT b.*,
      CASE WHEN 'channel' = ANY(g) THEN CASE WHEN first_touch THEN coalesce(b.first_channel, b.channel) ELSE b.channel END END AS k_channel,
      CASE WHEN 'source' = ANY(g) THEN CASE WHEN b.use_first THEN b.first_source ELSE b.last_source END END AS k_source,
      CASE WHEN 'medium' = ANY(g) THEN CASE WHEN b.use_first THEN b.first_medium ELSE b.last_medium END END AS k_medium,
      CASE WHEN 'campaign' = ANY(g) THEN CASE WHEN b.use_first THEN b.first_campaign ELSE b.last_campaign END END AS k_campaign,
      CASE WHEN 'content' = ANY(g) THEN CASE WHEN b.use_first THEN b.first_content ELSE b.last_content END END AS k_content,
      CASE WHEN 'term' = ANY(g) THEN CASE WHEN b.use_first THEN b.first_term ELSE b.last_term END END AS k_term,
      CASE WHEN 'referrer_host' = ANY(g) THEN CASE WHEN b.use_first THEN b.first_referrer_host ELSE b.last_referrer_host END END AS k_referrer_host,
      CASE WHEN 'landing_path' = ANY(g) THEN CASE WHEN b.use_first THEN b.first_landing_path ELSE b.last_landing_path END END AS k_landing_path,
      CASE WHEN 'product' = ANY(g) THEN b.product_slug END AS k_product,
      CASE WHEN 'country' = ANY(g) THEN b.country END AS k_country,
      CASE WHEN 'device_class' = ANY(g) THEN b.device_class END AS k_device_class,
      CASE WHEN 'affiliate' = ANY(g) THEN b.affiliate_code END AS k_affiliate,
      CASE WHEN 'kind' = ANY(g) THEN b.kind END AS k_kind,
      CASE WHEN 'day' = ANY(g) THEN to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') END AS k_day
    FROM base b
  ), agg AS (
    SELECT k_channel, k_source, k_medium, k_campaign, k_content, k_term, k_referrer_host, k_landing_path, k_product,
      k_country, k_device_class, k_affiliate, k_kind, k_day, cur,
      count(*) AS orders,
      count(*) FILTER (WHERE kind = 'free') AS free_orders,
      count(DISTINCT customer_key) AS customers,
      sum(gross_minor / factor) AS gross,
      sum(refunded_minor / factor) AS refunded,
      sum((gross_minor - refunded_minor) / factor) AS net,
      avg(extract(epoch FROM (created_at - first_seen_at)) / 86400.0) FILTER (WHERE first_seen_at IS NOT NULL AND first_seen_at <= created_at) AS avg_days
    FROM keyed
    GROUP BY k_channel, k_source, k_medium, k_campaign, k_content, k_term, k_referrer_host, k_landing_path, k_product,
      k_country, k_device_class, k_affiliate, k_kind, k_day, cur
  )
  SELECT coalesce(jsonb_agg(
    (jsonb_build_object('channel', k_channel, 'source', k_source, 'medium', k_medium, 'campaign', k_campaign, 'content', k_content,
      'term', k_term, 'referrer_host', k_referrer_host, 'landing_path', k_landing_path, 'product', k_product, 'country', k_country,
      'device_class', k_device_class, 'affiliate', k_affiliate, 'kind', k_kind, 'day', k_day)
      - ARRAY(SELECT d FROM unnest(dims) d WHERE NOT d = ANY(g)))
    || jsonb_build_object('currency', cur, 'orders', orders, 'paid_orders', orders - free_orders, 'free_orders', free_orders,
      'customers', customers, 'gross', round(gross, 2), 'refunded', round(refunded, 2), 'net', round(net, 2),
      'net_per_customer', CASE WHEN customers > 0 THEN round(net / customers, 2) ELSE 0 END,
      'avg_days_to_purchase', round(avg_days::numeric, 1))
    ORDER BY net DESC, orders DESC), '[]'::jsonb)
  INTO result FROM agg;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_attribution_report(timestamptz,timestamptz,text,text[],uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attribution_report(timestamptz,timestamptz,text,text[],uuid) TO authenticated, service_role;

-- ===== Source: 20261104000000_attribution_snapshot_cost.sql =====
-- Purchase attribution snapshot: cheaper per order (bulk INSERT of orders was ~7x slower with it).
-- Profiled with track_functions: attribution_text() took ~60% of the snapshot cost: 17 calls per order
-- (each a real call: SET search_path, required by the security advisor, blocks inlining), even for
-- orders with no stored attribution. insert_purchase_attribution() now reads each field once and
-- only from the parts of the payload that exist.
-- attribution_time() entered an EXCEPTION block (one subtransaction) on every call, three times per
-- order even when the payload had no timestamp. It now returns early for anything that is not a
-- string and only guards the cast itself. Measured: supabase/tests/purchase-attribution-snapshot.sql.
-- @see 20261103120000_purchase_attribution.sql

CREATE OR REPLACE FUNCTION public.attribution_time(p jsonb, k text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p->k) IS DISTINCT FROM 'string' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN (p->>k)::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END $$;
REVOKE ALL ON FUNCTION public.attribution_time(jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attribution_time(jsonb,text) TO service_role;


CREATE OR REPLACE FUNCTION public.insert_purchase_attribution(
  p_tx uuid, p_product uuid, p_user uuid, p_kind text, p_payload jsonb, p_coupon uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l jsonb := CASE WHEN jsonb_typeof(p_payload->'last') = 'object' THEN p_payload->'last' END;
  f jsonb := CASE WHEN jsonb_typeof(p_payload->'first') = 'object' THEN p_payload->'first' END;
  c jsonb := CASE WHEN jsonb_typeof(p_payload->'click') = 'object' THEN p_payload->'click' END;
  consent text := CASE WHEN p_payload->>'consent' IN ('analytics','marketing') THEN p_payload->>'consent' ELSE 'none' END;
  click_type text;
  click_value text;
  ls text; lm text; lc text; lco text; lt text; lid text; lrh text; llp text; lat timestamptz;
  fs text; fm text; fc text; fco text; ft text; fid text; frh text; flp text; fat timestamptz;
  ch text;
  fch text;
  member uuid;
  retention integer;
  sessions integer;
BEGIN
  IF c IS NOT NULL AND consent = 'marketing' THEN
    click_type := public.attribution_text(c, 'type', 20);
    IF click_type !~ '^[a-z_]{2,20}$' THEN click_type := NULL; END IF;
    click_value := public.attribution_text(c, 'value', 255);
  END IF;
  IF l IS NOT NULL THEN
    ls := lower(public.attribution_text(l,'source',200)); lm := lower(public.attribution_text(l,'medium',200));
    lc := public.attribution_text(l,'campaign',200); lco := public.attribution_text(l,'content',200);
    lt := public.attribution_text(l,'term',200); lid := public.attribution_text(l,'id',200);
    lrh := lower(public.attribution_text(l,'referrer_host',253)); llp := public.attribution_text(l,'landing_path',300);
    lat := public.attribution_time(l,'at');
  END IF;
  IF f IS NOT NULL THEN
    fs := lower(public.attribution_text(f,'source',200)); fm := lower(public.attribution_text(f,'medium',200));
    fc := public.attribution_text(f,'campaign',200); fco := public.attribution_text(f,'content',200);
    ft := public.attribution_text(f,'term',200); fid := public.attribution_text(f,'id',200);
    frh := lower(public.attribution_text(f,'referrer_host',253)); flp := public.attribution_text(f,'landing_path',300);
    fat := public.attribution_time(f,'at');
  END IF;
  IF p_payload IS NULL THEN
    ch := 'unknown';
  ELSE
    ch := public.classify_attribution_channel(ls, lm, lc, lrh, click_type);
    IF f IS NOT NULL THEN
      fch := public.classify_attribution_channel(fs, fm, fc, frh, NULL);
    END IF;
  END IF;
  IF p_coupon IS NOT NULL THEN
    SELECT b.member_id INTO member FROM public.affiliate_coupon_bindings b WHERE b.coupon_id = p_coupon AND b.retired_at IS NULL;
    IF member IS NOT NULL THEN ch := 'affiliate'; END IF;
  END IF;
  IF click_value IS NOT NULL THEN
    SELECT s.click_id_retention_days INTO retention FROM public.attribution_settings s WHERE s.id = 1;
  END IF;
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
    ls, lm, lc, lco, lt, lid, lrh, llp, lat,
    fs, fm, fc, fco, ft, fid, frh, flp, fat,
    sessions, CASE WHEN p_payload IS NOT NULL THEN public.attribution_time(p_payload,'first_seen_at') END,
    click_type, click_value, CASE WHEN click_value IS NOT NULL THEN now() + make_interval(days => coalesce(retention, 30)) END,
    CASE WHEN p_payload->>'device_class' IN ('desktop','mobile','tablet','bot') THEN p_payload->>'device_class' ELSE 'unknown' END,
    CASE WHEN p_payload->>'country' ~ '^[A-Z]{2}$' THEN p_payload->>'country' END
  ) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.insert_purchase_attribution(uuid,uuid,uuid,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_purchase_attribution(uuid,uuid,uuid,text,jsonb,uuid) TO service_role;

-- ===== Source: 20261104010000_attribution_snapshot_statement_trigger.sql =====
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

-- ===== Source: 20261105180000_attribution_touch_channels.sql =====
DO $$
BEGIN
  LOCK TABLE public.attribution_channel_rules, public.purchase_attribution IN SHARE ROW EXCLUSIVE MODE;
  -- Preserve historical classifications that no longer match the seller's current rules.
  CREATE TEMP TABLE attribution_channel_corrections ON COMMIT DROP AS
    SELECT id, channel FROM public.purchase_attribution
    WHERE channel IN ('paid_search','paid_social') AND affiliate_member_id IS NULL
      AND channel = public.classify_attribution_channel(last_source,last_medium,last_campaign,last_referrer_host,click_id_type);

  -- Explicit campaign labels precede fallback click identifiers.
  UPDATE public.attribution_channel_rules SET priority = 750
  WHERE is_default AND field = 'click_id_type' AND priority = 200;
  UPDATE public.attribution_channel_rules SET priority = 760
  WHERE is_default AND field = 'click_id_type' AND priority = 300;

  ALTER TABLE public.purchase_attribution DISABLE TRIGGER purchase_attribution_immutable;
  UPDATE public.purchase_attribution p
  SET channel = public.classify_attribution_channel(p.last_source,p.last_medium,p.last_campaign,p.last_referrer_host,p.click_id_type)
  FROM attribution_channel_corrections c
  WHERE p.id = c.id AND p.channel = c.channel
    AND p.channel IS DISTINCT FROM public.classify_attribution_channel(p.last_source,p.last_medium,p.last_campaign,p.last_referrer_host,p.click_id_type);
  ALTER TABLE public.purchase_attribution ENABLE TRIGGER purchase_attribution_immutable;
END;
$$;

-- Sellf 2026.11.0: buyer mail.
-- Source sections retain their SQL and relative order within this area.

-- ===== Source: 20261028141621_playerstack_leads.sql =====
-- PlayerStack lead intake and canonical product consent settings.
ALTER TABLE public.products
  ADD COLUMN lead_consent_required boolean NOT NULL DEFAULT false,
  ADD COLUMN lead_consent_version text NOT NULL DEFAULT '1' CHECK (lead_consent_version ~ '^[a-zA-Z0-9._-]{1,60}$'),
  ADD COLUMN lead_consent_text_pl text NOT NULL DEFAULT 'Chcę otrzymywać wiadomości o nowych materiałach i produktach. Mogę wypisać się w każdej chwili.' CHECK (length(btrim(lead_consent_text_pl)) BETWEEN 1 AND 500),
  ADD COLUMN lead_consent_text_en text NOT NULL DEFAULT 'I want to receive news about new materials and products. I can unsubscribe at any time.' CHECK (length(btrim(lead_consent_text_en)) BETWEEN 1 AND 500);

CREATE TABLE public.lead_nonces (
  nonce_hash text PRIMARY KEY CHECK (nonce_hash ~ '^[a-f0-9]{64}$'),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (length(origin) <= 2048),
  signature text NOT NULL CHECK (length(signature) <= 256),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX lead_nonces_product_idx ON public.lead_nonces(product_id);
CREATE INDEX lead_nonces_expiry_idx ON public.lead_nonces(expires_at);
ALTER TABLE public.lead_nonces ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_nonces_service ON public.lead_nonces FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
REVOKE ALL ON public.lead_nonces FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_nonces TO service_role;

CREATE TABLE public.lead_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_slug text,
  source text NOT NULL CHECK (length(source) <= 2048 AND source LIKE 'https://%'),
  marketing_consent boolean NOT NULL DEFAULT false,
  consent_version text CHECK (length(consent_version) BETWEEN 1 AND 64),
  consent_text text CHECK (length(consent_text) BETWEEN 1 AND 500),
  client_consent_text text CHECK (length(client_consent_text) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day',
  CHECK (NOT marketing_consent OR (consent_version IS NOT NULL AND consent_text IS NOT NULL))
);
CREATE INDEX lead_submissions_product_idx ON public.lead_submissions(product_id);
CREATE INDEX lead_submissions_email_idx ON public.lead_submissions(email);
CREATE INDEX lead_submissions_expiry_idx ON public.lead_submissions(expires_at) WHERE confirmed_at IS NULL;
ALTER TABLE public.lead_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_submissions_service ON public.lead_submissions FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
REVOKE ALL ON public.lead_submissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_submissions TO service_role;

CREATE FUNCTION public.confirm_lead_submission(p_token_hash text, p_email text)
RETURNS SETOF public.lead_submissions LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.lead_submissions SET confirmed_at = coalesce(confirmed_at, now())
  WHERE token_hash = p_token_hash AND email = p_email AND expires_at > now()
    AND (select auth.role()) = 'service_role'
  RETURNING *;
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_lead_submission(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_lead_submission(text, text) TO service_role;

SELECT cron.schedule('cleanup-lead-intake', '17 * * * *', $cron$
  DELETE FROM public.lead_nonces WHERE expires_at < now();
  DELETE FROM public.lead_submissions WHERE confirmed_at IS NULL AND expires_at < now();
$cron$);

CREATE FUNCTION public.validate_lead_consent_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.lead_consent_text_pl, NEW.lead_consent_text_en) IS DISTINCT FROM
     (OLD.lead_consent_text_pl, OLD.lead_consent_text_en)
     AND NEW.lead_consent_version = OLD.lead_consent_version THEN
    RAISE EXCEPTION 'A wording change requires a new consent version' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lead_submissions s WHERE s.product_id=NEW.id AND s.marketing_consent
    AND ((s.consent_version=NEW.lead_consent_version||':pl' AND s.consent_text<>NEW.lead_consent_text_pl)
      OR (s.consent_version=NEW.lead_consent_version||':en' AND s.consent_text<>NEW.lead_consent_text_en))) THEN
    RAISE EXCEPTION 'Consent version already has different wording' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.validate_lead_consent_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_lead_consent_version() TO service_role;
CREATE TRIGGER validate_lead_consent_version BEFORE UPDATE OF lead_consent_version, lead_consent_text_pl, lead_consent_text_en
  ON public.products FOR EACH ROW EXECUTE FUNCTION public.validate_lead_consent_version();

-- ===== Source: 20261104020000_auth_mail_retries.sql =====
-- Durable retry for purchase mails delivered through Supabase Auth (W147-8, W147-9).
-- The post-payment login link and the free-license key mail both go out as auth OTP mails. When
-- the auth mailer refuses (hourly send limit, per-user cooldown, transient failure) the buyer used to
-- get nothing and nothing retried. A refused send is parked here and the minute cron retries it
-- with backoff; the row is deleted once delivered. One pending row per (email, redirect), so a page
-- reload cannot multiply mails. Service role only: rows can carry a license key until delivered.

CREATE TABLE public.auth_mail_retries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  redirect_to text NOT NULL CHECK (length(redirect_to) BETWEEN 1 AND 2048),
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 8192),
  kind text NOT NULL CHECK (kind IN ('post_checkout', 'license')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 40),
  given_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, redirect_to)
);
CREATE INDEX auth_mail_retries_due ON public.auth_mail_retries (next_attempt_at) WHERE given_up_at IS NULL;
ALTER TABLE public.auth_mail_retries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.auth_mail_retries FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.auth_mail_retries FROM anon, authenticated;
GRANT ALL ON public.auth_mail_retries TO service_role;

-- Parks a refused mail. A repeat for the same destination refreshes the payload but keeps the
-- attempt count and does not pull the next attempt earlier.
CREATE FUNCTION public.queue_auth_mail_retry(p_email text, p_redirect_to text, p_data jsonb, p_kind text, p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.auth_mail_retries(email, redirect_to, data, kind, next_attempt_at, last_error)
  VALUES (lower(btrim(p_email)), p_redirect_to, coalesce(p_data, '{}'::jsonb), p_kind, now() + interval '2 minutes', left(p_error, 40))
  ON CONFLICT (email, redirect_to) DO UPDATE SET data = EXCLUDED.data, last_error = EXCLUDED.last_error,
    given_up_at = NULL, attempts = CASE WHEN public.auth_mail_retries.given_up_at IS NULL THEN public.auth_mail_retries.attempts ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.queue_auth_mail_retry(text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_auth_mail_retry(text,text,jsonb,text,text) TO service_role;

-- Claims due rows for one worker: bumps attempts and leases them for 10 minutes, so a parallel
-- cron run skips them (SKIP LOCKED) and a crashed run retries later. Old given-up rows are purged.
CREATE FUNCTION public.claim_auth_mail_retries(p_limit integer DEFAULT 20)
RETURNS SETOF public.auth_mail_retries LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.auth_mail_retries WHERE given_up_at < now() - interval '7 days';
  RETURN QUERY
  UPDATE public.auth_mail_retries r SET attempts = r.attempts + 1, next_attempt_at = now() + interval '10 minutes'
  WHERE r.id IN (SELECT q.id FROM public.auth_mail_retries q WHERE q.given_up_at IS NULL AND q.next_attempt_at <= now()
    ORDER BY q.next_attempt_at LIMIT least(greatest(coalesce(p_limit, 20), 1), 100) FOR UPDATE SKIP LOCKED)
  RETURNING r.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_auth_mail_retries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_auth_mail_retries(integer) TO service_role;

-- ===== Source: 20261105030000_order_search_rpc.sql =====
-- Literal searches retain the table result shape for filters, embeds and pagination.
CREATE FUNCTION public.search_payment_transactions(p_search text, p_include_identifiers boolean DEFAULT true)
RETURNS SETOF public.payment_transactions
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_search IS NULL OR length(p_search) > 200 THEN
    RAISE EXCEPTION 'Search must contain at most 200 characters' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT t.* FROM public.payment_transactions t
  WHERE strpos(lower(t.customer_email), lower(p_search)) > 0
    OR (p_include_identifiers AND (strpos(lower(t.session_id), lower(p_search)) > 0
      OR strpos(lower(t.stripe_payment_intent_id), lower(p_search)) > 0))
    OR (trim(p_search) ~ '^#?[0-9]{1,15}$' AND t.order_number::text = ltrim(trim(p_search), '#0'))
    OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = t.product_id
      AND (strpos(lower(p.name), lower(p_search)) > 0 OR strpos(lower(p.slug), lower(p_search)) > 0));
END;
$$;

CREATE FUNCTION public.search_order_accesses(p_search text)
RETURNS SETOF public.user_product_access
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_search IS NULL OR length(p_search) > 200 THEN
    RAISE EXCEPTION 'Search must contain at most 200 characters' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT a.* FROM public.user_product_access a
  WHERE EXISTS (SELECT 1 FROM public.user_access_stats u WHERE u.user_id = a.user_id AND strpos(lower(u.email), lower(p_search)) > 0)
    OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = a.product_id
      AND (strpos(lower(p.name), lower(p_search)) > 0 OR strpos(lower(p.slug), lower(p_search)) > 0));
END;
$$;

CREATE FUNCTION public.search_order_leads(p_search text)
RETURNS SETOF public.lead_submissions
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_search IS NULL OR length(p_search) > 200 THEN
    RAISE EXCEPTION 'Search must contain at most 200 characters' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT l.* FROM public.lead_submissions l
  WHERE strpos(lower(l.email), lower(p_search)) > 0
    OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = l.product_id
      AND (strpos(lower(p.name), lower(p_search)) > 0 OR strpos(lower(p.slug), lower(p_search)) > 0));
END;
$$;

REVOKE ALL ON FUNCTION public.search_payment_transactions(text,boolean), public.search_order_accesses(text), public.search_order_leads(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_payment_transactions(text,boolean), public.search_order_accesses(text), public.search_order_leads(text) TO service_role;

-- ===== Source: 20261105190000_buyer_mail_details.sql =====
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
    OR length(p_data->>'cancel_reason_text')>2000 OR length(p_data->>'license_expires_text')>100
    OR length(p_data->>'license_expires_at')>50
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
    -'mail_kind'-'pay_url'-'release_text'-'participants_url'-'license_key'-'payment_received')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date',
      'event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text','transfer',p_data->'transfer',
      'purchase_product',p_data->>'purchase_product','purchase_amount',p_data->>'purchase_amount',
      'mail_kind',p_data->>'mail_kind','pay_url',p_data->>'pay_url','release_text',p_data->>'release_text',
      'participants_url',p_data->>'participants_url','license_key',p_data->>'license_key',
      'payment_received',p_data->>'payment_received',
      'cancel_reason_text',p_data->>'cancel_reason_text','license_expires_at',p_data->>'license_expires_at',
      'license_expires_text',p_data->>'license_expires_text',
      'locale',coalesce(p_data->>'locale','en')))
    WHERE lower(email)=lower(p_email);
END $$;
REVOKE ALL ON FUNCTION public.prepare_event_mail(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_mail(text,jsonb) TO service_role;

-- ===== Source: 20261106100000_buyer_email_channel.sql =====
ALTER TABLE public.shop_config ADD COLUMN supabase_buyer_emails boolean NOT NULL DEFAULT false;
-- Existing shops keep their mail channel during upgrade. Fresh installations have no shop row yet.
UPDATE public.shop_config SET supabase_buyer_emails = true WHERE NOT supabase_buyer_emails;
-- An existing installation may have sold products before saving shop settings.
INSERT INTO public.shop_config(supabase_buyer_emails)
  SELECT true WHERE NOT EXISTS (SELECT 1 FROM public.shop_config)
    AND (EXISTS (SELECT 1 FROM public.products) OR EXISTS (SELECT 1 FROM auth.users));

CREATE OR REPLACE FUNCTION public.enqueue_webhook_delivery(
  p_id uuid, p_endpoint_id uuid, p_event_type text, p_payload jsonb,
  p_delivery_key text, p_max_attempts integer DEFAULT 5
) RETURNS SETOF public.webhook_logs
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.webhook_logs(
    id, endpoint_id, event_type, payload, delivery_key, status,
    attempt_count, max_attempts, next_retry_at
  ) VALUES (
    p_id, p_endpoint_id, p_event_type, CASE WHEN jsonb_typeof(p_payload) = 'array' THEN p_payload
      ELSE p_payload || jsonb_build_object('id', p_id) END,
    p_delivery_key, 'pending_retry', 0, p_max_attempts, now() + interval '60 seconds'
  ) ON CONFLICT DO NOTHING
  RETURNING *;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_webhook_delivery(uuid,uuid,text,jsonb,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_webhook_delivery(uuid,uuid,text,jsonb,text,integer) TO service_role;

-- ===== Source: 20261106110000_lead_checkout_locale.sql =====
ALTER TABLE public.lead_submissions
  ADD COLUMN locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('pl', 'en'));

UPDATE public.lead_submissions l SET locale = 'pl'
WHERE l.consent_version LIKE '%:pl'
   OR (l.consent_version IS NULL AND EXISTS (
     SELECT 1 FROM auth.users u WHERE u.email = l.email AND u.raw_user_meta_data->>'locale' = 'pl'
   ));

-- ===== Source: 20261109100000_purchase_license_mail.sql =====
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
    -'mail_kind'-'pay_url'-'release_text'-'participants_url'-'license_keys'-'license_key'-'payment_received')
    ||jsonb_strip_nulls(jsonb_build_object('event_date',p_data->>'event_date',
      'event_online_url',p_data->>'event_online_url','transfer_text',p_data->>'transfer_text','transfer',p_data->'transfer',
      'purchase_product',p_data->>'purchase_product','purchase_amount',p_data->>'purchase_amount',
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

ALTER TABLE public.auth_mail_retries DROP CONSTRAINT auth_mail_retries_data_check;
ALTER TABLE public.auth_mail_retries ADD CONSTRAINT auth_mail_retries_data_check
  CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 73728);

CREATE OR REPLACE FUNCTION public.license_mail_is_current(p_email text, p_keys jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT jsonb_typeof(p_keys)='array' AND jsonb_array_length(p_keys)>0
AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(p_keys) k(token)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.issued_licenses l
    WHERE l.license_key=k.token AND lower(l.email)=lower(p_email)
      AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at>now())
      AND (l.issuance_source IN ('manual','api') OR
        EXISTS (SELECT 1 FROM public.payment_transactions t
          JOIN public.subscriptions s ON s.id=t.subscription_id
          JOIN auth.users u ON u.id=s.user_id AND u.email_confirmed_at IS NULL
          WHERE lower(u.email)=lower(p_email) AND s.product_id=l.product_id
            AND t.status IN ('completed','partially_refunded') AND l.order_id=t.stripe_invoice_id
            AND ((s.status IN ('active','trialing','past_due') AND s.current_period_end>now())
              OR (s.status='canceled' AND s.paid_access_invoice_id=t.stripe_invoice_id
                AND s.paid_access_expires_at>now() AND coalesce(t.refunded_amount,0)=0))) OR
        EXISTS (SELECT 1 FROM public.user_product_access a JOIN auth.users u ON u.id=a.user_id
          WHERE lower(u.email)=lower(p_email) AND a.product_id=l.product_id
            AND (a.access_expires_at IS NULL OR a.access_expires_at>now())) OR
        EXISTS (SELECT 1 FROM public.guest_purchases g
          JOIN public.payment_transactions t ON t.id=g.transaction_id OR (g.transaction_id IS NULL AND t.session_id=g.session_id)
          WHERE lower(g.customer_email)=lower(p_email) AND g.product_id=l.product_id
            AND g.claimed_by_user_id IS NULL AND t.status IN ('completed','partially_refunded')
            AND l.order_id IN (t.id::text,t.session_id,t.stripe_payment_intent_id,t.stripe_invoice_id)))
  )
);
$$;
REVOKE ALL ON FUNCTION public.license_mail_is_current(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.license_mail_is_current(text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_auth_mail_retry(p_email text, p_redirect_to text, p_data jsonb, p_kind text, p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.auth_mail_retries(email, redirect_to, data, kind, next_attempt_at, last_error)
  VALUES (lower(btrim(p_email)), p_redirect_to, coalesce(p_data, '{}'::jsonb), p_kind, now() + interval '2 minutes', left(p_error, 40))
  ON CONFLICT (email, redirect_to) DO UPDATE SET data = CASE WHEN public.auth_mail_retries.kind='license' AND EXCLUDED.kind='post_checkout' THEN public.auth_mail_retries.data ELSE EXCLUDED.data END,
    kind = CASE WHEN public.auth_mail_retries.kind='license' THEN 'license' ELSE EXCLUDED.kind END, last_error = EXCLUDED.last_error,
    given_up_at = NULL, attempts = CASE WHEN public.auth_mail_retries.given_up_at IS NULL THEN public.auth_mail_retries.attempts ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.queue_auth_mail_retry(text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_auth_mail_retry(text,text,jsonb,text,text) TO service_role;

CREATE TABLE public.license_mail_receipts (
  mail_key text PRIMARY KEY CHECK (mail_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.license_mail_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.license_mail_receipts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.license_mail_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.license_mail_receipts TO service_role;
ALTER TABLE public.auth_mail_retries ADD COLUMN license_mail_key text
  REFERENCES public.license_mail_receipts(mail_key);

CREATE FUNCTION public.claim_license_mail(p_key text,p_email text,p_redirect_to text,p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE retry_id uuid;
BEGIN
  INSERT INTO public.license_mail_receipts(mail_key) VALUES(p_key) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.auth_mail_retries(email,redirect_to,data,kind,next_attempt_at,last_error,license_mail_key)
    VALUES(lower(btrim(p_email)),p_redirect_to,p_data,'license',now()+interval '10 minutes','send_failed',p_key)
    RETURNING id INTO retry_id;
  RETURN retry_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_license_mail(text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_license_mail(text,text,text,jsonb) TO service_role;

CREATE FUNCTION public.finish_license_mail(p_retry_id uuid,p_completed boolean,p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_completed THEN
    DELETE FROM public.auth_mail_retries WHERE id=p_retry_id;
  ELSE
    UPDATE public.auth_mail_retries SET next_attempt_at=now()+interval '2 minutes',last_error=left(p_error,40)
      WHERE id=p_retry_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.finish_license_mail(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_license_mail(uuid,boolean,text) TO service_role;

-- Sellf 2026.11.0: analytics.
-- Source sections retain their SQL and relative order within this area.

-- ===== Source: 20261026090000_dashboard_chart_sums.sql =====
-- Dashboard charts: daily chart sums every completed payment per currency and day;
-- hourly chart buckets hours (and the target day) in the caller's timezone.

CREATE OR REPLACE FUNCTION public.get_sales_chart_data(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_product_id UUID DEFAULT NULL
)
RETURNS TABLE (
  date TEXT,
  amount_by_currency JSONB,
  orders INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    per_currency.day,
    COALESCE(jsonb_object_agg(per_currency.currency, per_currency.total), '{}'::jsonb),
    SUM(per_currency.orders)::INTEGER
  FROM (
    SELECT
      TO_CHAR(pt.created_at, 'YYYY-MM-DD') AS day,
      pt.currency,
      SUM(pt.amount) AS total,
      COUNT(*) AS orders
    FROM public.payment_transactions pt
    WHERE pt.status = 'completed'
      AND pt.created_at >= p_start_date
      AND pt.created_at <= p_end_date
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY 1, 2
  ) per_currency
  GROUP BY per_currency.day
  ORDER BY per_currency.day ASC;
END;
$$;

-- New signature (adds p_timezone): drop the old one so only one overload is exposed.
DROP FUNCTION IF EXISTS public.get_hourly_revenue_stats(DATE, UUID);

CREATE OR REPLACE FUNCTION public.get_hourly_revenue_stats(
  p_target_date DATE DEFAULT CURRENT_DATE,
  p_product_id UUID DEFAULT NULL,
  p_timezone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
  hour INTEGER,
  amount_by_currency JSONB,
  orders INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_timezone TEXT;
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(
    (SELECT tz.name FROM pg_catalog.pg_timezone_names tz WHERE tz.name = p_timezone),
    'UTC'
  ) INTO v_timezone;

  RETURN QUERY
  WITH hours AS (
    SELECT generate_series(0, 23) AS h
  ),
  sales AS (
    SELECT
      EXTRACT(HOUR FROM pt.created_at AT TIME ZONE v_timezone)::INTEGER AS sale_hour,
      pt.currency,
      SUM(pt.amount) AS total_amount,
      COUNT(*) AS total_orders
    FROM public.payment_transactions pt
    WHERE pt.status = 'completed'
      AND (pt.created_at AT TIME ZONE v_timezone)::DATE = p_target_date
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY 1, 2
  ),
  aggregated_sales AS (
    SELECT
      sale_hour,
      jsonb_object_agg(currency, total_amount) AS amount_by_currency,
      SUM(total_orders)::INTEGER AS total_orders
    FROM sales
    GROUP BY sale_hour
  )
  SELECT
    hours.h,
    COALESCE(aggregated_sales.amount_by_currency, '{}'::jsonb),
    COALESCE(aggregated_sales.total_orders, 0)::INTEGER
  FROM hours
  LEFT JOIN aggregated_sales ON hours.h = aggregated_sales.sale_hour
  ORDER BY hours.h ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_hourly_revenue_stats(DATE, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hourly_revenue_stats(DATE, UUID, TEXT) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_hourly_revenue_stats(DATE, UUID, TEXT)
  IS E'@graphql({"include": false})';

-- ===== Source: 20261103190000_checkout_funnel_other_bucket.sql =====
-- Checkout funnel: count attempts in other statuses (awaiting_payment bank transfers, cancelled)
-- as 'other' so recorded attempts = paid + pending + abandoned + other.
-- Related: supabase/tests/checkout-funnel.sql
CREATE OR REPLACE FUNCTION public.get_checkout_funnel(
  p_days integer DEFAULT 30,
  p_product_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
     AND NOT COALESCE((SELECT public.is_admin()), false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'Invalid funnel period' USING ERRCODE = '22023';
  END IF;

  WITH buckets AS (
    SELECT pt.product_id,
      CASE
        WHEN pt.status IN ('completed', 'refunded', 'partially_refunded', 'disputed') THEN 'paid'
        WHEN pt.status IN ('pending', 'abandoned') THEN pt.status
        ELSE 'other'
      END AS bucket,
      count(*) AS attempts
    FROM public.payment_transactions pt
    WHERE pt.created_at >= now() - make_interval(days => p_days)
      AND pt.created_at <= now()
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY pt.product_id, bucket
  ), per_product AS (
    SELECT product_id, sum(attempts) AS started,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'paid'), 0) AS paid,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'pending'), 0) AS pending,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'abandoned'), 0) AS abandoned,
      COALESCE(sum(attempts) FILTER (WHERE bucket = 'other'), 0) AS other
    FROM buckets
    GROUP BY product_id
  ), top_products AS (
    SELECT * FROM per_product ORDER BY started DESC, product_id LIMIT 100
  )
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_build_object(
      'started', COALESCE(sum(started), 0), 'paid', COALESCE(sum(paid), 0),
      'pending', COALESCE(sum(pending), 0), 'abandoned', COALESCE(sum(abandoned), 0),
      'other', COALESCE(sum(other), 0)
    ) FROM per_product),
    'products', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'productId', t.product_id, 'name', p.name,
      'started', t.started, 'paid', t.paid, 'pending', t.pending, 'abandoned', t.abandoned, 'other', t.other
    ) ORDER BY t.started DESC, t.product_id), '[]'::jsonb)
    FROM top_products t LEFT JOIN public.products p ON p.id = t.product_id)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_checkout_funnel(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_checkout_funnel(integer, uuid) TO service_role;

-- ===== Source: 20261103193000_tutorial_progress.sql =====
-- Guided tutorials: which tutorial each user has already been shown (auto-start happens once per user).
-- @see admin-panel/src/lib/tutorials/registry.ts, admin-panel/src/lib/actions/tutorial-progress.ts

CREATE TABLE public.tutorial_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tutorial_id text NOT NULL CHECK (tutorial_id ~ '^[a-z][a-z0-9-]{1,63}$'),
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tutorial_id)
);

ALTER TABLE public.tutorial_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.tutorial_progress
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users read own tutorial progress" ON public.tutorial_progress
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "Users record own tutorial progress" ON public.tutorial_progress
  FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));

REVOKE ALL ON public.tutorial_progress FROM anon, authenticated;
GRANT SELECT, INSERT ON public.tutorial_progress TO authenticated;
GRANT ALL ON public.tutorial_progress TO service_role;

-- ===== Source: 20261103200000_sales_chart_timezone.sql =====
-- Daily dashboard chart groups days in the caller's timezone (W78): a purchase just after
-- local midnight belongs to the local day, as in the hourly chart and the payments list.
-- Unknown timezone names fall back to UTC (same rule as get_hourly_revenue_stats).

-- New signature (adds p_timezone): drop the old one so only one overload is exposed.
DROP FUNCTION IF EXISTS public.get_sales_chart_data(TIMESTAMPTZ, TIMESTAMPTZ, UUID);

CREATE OR REPLACE FUNCTION public.get_sales_chart_data(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_product_id UUID DEFAULT NULL,
  p_timezone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
  date TEXT,
  amount_by_currency JSONB,
  orders INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_timezone TEXT;
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(
    (SELECT tz.name FROM pg_catalog.pg_timezone_names tz WHERE tz.name = p_timezone),
    'UTC'
  ) INTO v_timezone;

  RETURN QUERY
  SELECT
    per_currency.day,
    COALESCE(jsonb_object_agg(per_currency.currency, per_currency.total), '{}'::jsonb),
    SUM(per_currency.orders)::INTEGER
  FROM (
    SELECT
      TO_CHAR(pt.created_at AT TIME ZONE v_timezone, 'YYYY-MM-DD') AS day,
      pt.currency,
      SUM(pt.amount) AS total,
      COUNT(*) AS orders
    FROM public.payment_transactions pt
    WHERE pt.status = 'completed'
      AND pt.created_at >= p_start_date
      AND pt.created_at <= p_end_date
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY 1, 2
  ) per_currency
  GROUP BY per_currency.day
  ORDER BY per_currency.day ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_sales_chart_data(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_chart_data(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_sales_chart_data(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT)
  IS E'@graphql({"include": false})';

-- ===== Source: 20261108165000_retained_payment_revenue.sql =====
CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  total_users INTEGER;
  total_products INTEGER;
  total_revenue NUMERIC;
  active_users_7d INTEGER;
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO total_users FROM auth.users;
  SELECT COUNT(*) INTO total_products FROM public.products WHERE is_active = true;
  SELECT COALESCE(SUM(GREATEST(amount - COALESCE(refunded_amount, 0), 0)), 0) INTO total_revenue
  FROM public.payment_transactions WHERE status IN ('completed', 'partially_refunded');

  SELECT COUNT(DISTINCT user_id) INTO active_users_7d
  FROM public.user_product_access
  WHERE created_at > NOW() - INTERVAL '7 days';

  RETURN jsonb_build_object(
    'totalProducts', total_products,
    'totalUsers', total_users,
    'totalAccess', (SELECT COUNT(*) FROM public.user_product_access),
    'activeUsers', active_users_7d,
    'totalRevenue', total_revenue
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_detailed_revenue_stats(
  p_product_id UUID DEFAULT NULL,
  p_goal_start_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_revenue_by_currency JSONB;
  v_today_revenue_by_currency JSONB;
  v_today_orders INTEGER;
  v_last_order_at TIMESTAMPTZ;
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(jsonb_object_agg(currency, total), '{}'::jsonb)
  INTO v_total_revenue_by_currency
  FROM (
    SELECT pt.currency, SUM(GREATEST(pt.amount - COALESCE(pt.refunded_amount, 0), 0)) as total
    FROM public.payment_transactions pt
    WHERE pt.status IN ('completed', 'partially_refunded')
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
      AND (p_goal_start_date IS NULL OR pt.created_at >= p_goal_start_date)
    GROUP BY pt.currency
  ) sub;

  SELECT
    COALESCE(jsonb_object_agg(currency, total), '{}'::jsonb),
    COALESCE(SUM(order_count), 0)::INTEGER
  INTO v_today_revenue_by_currency, v_today_orders
  FROM (
    SELECT pt.currency, SUM(GREATEST(pt.amount - COALESCE(pt.refunded_amount, 0), 0)) as total, COUNT(*) as order_count
    FROM public.payment_transactions pt
    WHERE pt.status IN ('completed', 'partially_refunded')
      AND pt.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY pt.currency
  ) sub;

  SELECT pt.created_at INTO v_last_order_at
  FROM public.payment_transactions pt
  WHERE pt.status IN ('completed', 'partially_refunded')
    AND (p_product_id IS NULL OR pt.product_id = p_product_id)
  ORDER BY pt.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'totalRevenue', v_total_revenue_by_currency,
    'todayRevenue', v_today_revenue_by_currency,
    'todayOrders', v_today_orders,
    'lastOrderAt', v_last_order_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_detailed_revenue_stats(UUID, TIMESTAMPTZ) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_sales_chart_data(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_product_id UUID DEFAULT NULL,
  p_timezone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
  date TEXT,
  amount_by_currency JSONB,
  orders INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_timezone TEXT;
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(
    (SELECT tz.name FROM pg_catalog.pg_timezone_names tz WHERE tz.name = p_timezone),
    'UTC'
  ) INTO v_timezone;

  RETURN QUERY
  SELECT
    per_currency.day,
    COALESCE(jsonb_object_agg(per_currency.currency, per_currency.total), '{}'::jsonb),
    SUM(per_currency.orders)::INTEGER
  FROM (
    SELECT
      TO_CHAR(pt.created_at AT TIME ZONE v_timezone, 'YYYY-MM-DD') AS day,
      pt.currency,
      SUM(GREATEST(pt.amount - COALESCE(pt.refunded_amount, 0), 0)) AS total,
      COUNT(*) AS orders
    FROM public.payment_transactions pt
    WHERE pt.status IN ('completed', 'partially_refunded')
      AND pt.created_at >= p_start_date
      AND pt.created_at <= p_end_date
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY 1, 2
  ) per_currency
  GROUP BY per_currency.day
  ORDER BY per_currency.day ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_sales_chart_data(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_chart_data(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_sales_chart_data(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT)
  IS E'@graphql({"include": false})';

CREATE OR REPLACE FUNCTION public.get_hourly_revenue_stats(
  p_target_date DATE DEFAULT CURRENT_DATE,
  p_product_id UUID DEFAULT NULL,
  p_timezone TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
  hour INTEGER,
  amount_by_currency JSONB,
  orders INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_timezone TEXT;
BEGIN
  IF NOT ( select public.is_admin() ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COALESCE(
    (SELECT tz.name FROM pg_catalog.pg_timezone_names tz WHERE tz.name = p_timezone),
    'UTC'
  ) INTO v_timezone;

  RETURN QUERY
  WITH hours AS (
    SELECT generate_series(0, 23) AS h
  ),
  sales AS (
    SELECT
      EXTRACT(HOUR FROM pt.created_at AT TIME ZONE v_timezone)::INTEGER AS sale_hour,
      pt.currency,
      SUM(GREATEST(pt.amount - COALESCE(pt.refunded_amount, 0), 0)) AS total_amount,
      COUNT(*) AS total_orders
    FROM public.payment_transactions pt
    WHERE pt.status IN ('completed', 'partially_refunded')
      AND (pt.created_at AT TIME ZONE v_timezone)::DATE = p_target_date
      AND (p_product_id IS NULL OR pt.product_id = p_product_id)
    GROUP BY 1, 2
  ),
  aggregated_sales AS (
    SELECT
      sale_hour,
      jsonb_object_agg(currency, total_amount) AS amount_by_currency,
      SUM(total_orders)::INTEGER AS total_orders
    FROM sales
    GROUP BY sale_hour
  )
  SELECT
    hours.h,
    COALESCE(aggregated_sales.amount_by_currency, '{}'::jsonb),
    COALESCE(aggregated_sales.total_orders, 0)::INTEGER
  FROM hours
  LEFT JOIN aggregated_sales ON hours.h = aggregated_sales.sale_hour
  ORDER BY hours.h ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_hourly_revenue_stats(DATE, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hourly_revenue_stats(DATE, UUID, TEXT) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_hourly_revenue_stats(DATE, UUID, TEXT)
  IS E'@graphql({"include": false})';

REVOKE ALL ON FUNCTION public.get_dashboard_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_detailed_revenue_stats(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_detailed_revenue_stats(UUID, TIMESTAMPTZ) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_payment_summary(p_today_start timestamptz, p_month_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_today_start IS NULL OR p_month_start IS NULL THEN RAISE EXCEPTION 'Date boundaries are required'; END IF;
  WITH amounts AS (
    SELECT upper(currency) AS currency, status, created_at, coalesce(refunded_amount, 0) AS refunded,
      CASE WHEN status IN ('completed', 'partially_refunded') THEN greatest(amount - coalesce(refunded_amount, 0), 0) ELSE 0 END AS retained,
      status IN ('completed', 'partially_refunded') AS paid
    FROM public.payment_transactions
  ), currencies AS (
    SELECT currency,
      count(*) FILTER (WHERE paid) AS transactions,
      count(*) FILTER (WHERE paid AND created_at >= p_today_start) AS today_transactions,
      count(*) FILTER (WHERE paid AND created_at >= p_month_start) AS month_transactions,
      coalesce(sum(retained), 0) AS revenue,
      coalesce(sum(retained) FILTER (WHERE created_at >= p_today_start), 0) AS today,
      coalesce(sum(retained) FILTER (WHERE created_at >= p_month_start), 0) AS month,
      coalesce(sum(refunded) FILTER (WHERE refunded > 0), 0) AS refunds,
      count(*) FILTER (WHERE status = 'pending') AS pending
    FROM amounts GROUP BY currency
  )
  SELECT jsonb_build_object(
    'total_transactions', coalesce(sum(transactions), 0),
    'total_revenue', coalesce(sum(revenue), 0),
    'today_revenue', coalesce(sum(today), 0),
    'this_month_revenue', coalesce(sum(month), 0),
    'refunded_amount', coalesce(sum(refunds), 0),
    'pending_count', coalesce(sum(pending), 0),
    'total_revenue_by_currency', coalesce(jsonb_object_agg(currency, revenue) FILTER (WHERE transactions > 0), '{}'::jsonb),
    'today_revenue_by_currency', coalesce(jsonb_object_agg(currency, today) FILTER (WHERE today_transactions > 0), '{}'::jsonb),
    'this_month_revenue_by_currency', coalesce(jsonb_object_agg(currency, month) FILTER (WHERE month_transactions > 0), '{}'::jsonb),
    'refunded_amount_by_currency', coalesce(jsonb_object_agg(currency, refunds) FILTER (WHERE refunds > 0), '{}'::jsonb),
    'by_currency', coalesce(jsonb_object_agg(currency, jsonb_build_object('total_revenue', revenue, 'transaction_count', transactions)) FILTER (WHERE transactions > 0), '{}'::jsonb)
  ) INTO result FROM currencies;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_payment_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_summary(timestamptz, timestamptz) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_payment_summary(timestamptz, timestamptz) IS E'@graphql({"include": false})';

CREATE OR REPLACE FUNCTION public.get_revenue_groups(p_start timestamptz DEFAULT NULL, p_end timestamptz DEFAULT NULL, p_product_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT (SELECT public.is_admin()) THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(groups)), '[]'::jsonb) INTO result FROM (
    SELECT product_id, upper(currency) AS currency, status,
      date_trunc('day', created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS created_at,
      sum(CASE WHEN status = 'refunded' THEN 0 ELSE greatest(amount - coalesce(refunded_amount, 0), 0) END) AS amount,
      sum(coalesce(refunded_amount, 0)) AS refunded_amount, count(*) AS transaction_count
    FROM public.payment_transactions
    WHERE status IN ('completed', 'partially_refunded', 'refunded')
      AND (p_start IS NULL OR created_at >= p_start)
      AND (p_end IS NULL OR created_at <= p_end)
      AND (p_product_id IS NULL OR product_id = p_product_id)
    GROUP BY product_id, upper(currency), status, date_trunc('day', created_at AT TIME ZONE 'UTC')
  ) groups;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_revenue_groups(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_groups(timestamptz, timestamptz, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_revenue_groups(timestamptz, timestamptz, uuid) IS E'@graphql({"include": false})';
