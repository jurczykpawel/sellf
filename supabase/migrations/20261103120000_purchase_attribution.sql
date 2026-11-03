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
