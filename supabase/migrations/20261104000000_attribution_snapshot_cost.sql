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
