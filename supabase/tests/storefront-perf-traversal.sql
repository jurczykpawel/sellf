\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE reached(id uuid PRIMARY KEY);
CREATE TEMP TABLE page_times(ms double precision);
DO $$
DECLARE
  batch jsonb[]; item jsonb; stamp timestamptz; last_id uuid;
  expected integer; started timestamptz;
BEGIN
  SELECT count(*) INTO expected FROM public.products;
  LOOP
    started:=clock_timestamp();
    SELECT array_agg(value) INTO batch FROM public.storefront_catalogue_page(
      '{"search":"Performance course","categoryIds":["20000000-0000-4000-8000-000000000001"],"pageSize":24}',stamp,last_id,null) value;
    INSERT INTO page_times VALUES (extract(epoch FROM clock_timestamp()-started)*1000);
    IF coalesce(cardinality(batch),0)=0 THEN EXIT; END IF;
    IF cardinality(batch)>25 THEN RAISE EXCEPTION 'Unbounded page'; END IF;
    FOR i IN 1..least(24,cardinality(batch)) LOOP
      item:=batch[i]; INSERT INTO reached VALUES ((item->>'id')::uuid);
    END LOOP;
    stamp:=(item->>'created_at')::timestamptz; last_id:=(item->>'id')::uuid;
    EXIT WHEN cardinality(batch)<=24;
  END LOOP;
  IF (SELECT count(*) FROM reached)<>expected THEN RAISE EXCEPTION 'Incomplete traversal'; END IF;
END; $$;
SELECT count(*) products FROM reached;
SELECT count(*) pages, sum(ms) total_ms, percentile_disc(.75) WITHIN GROUP (ORDER BY ms) p75_ms, max(ms) max_ms FROM page_times;
ROLLBACK;
