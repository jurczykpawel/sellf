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
