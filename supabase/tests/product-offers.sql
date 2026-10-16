\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE commercial_before AS SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) AS digest FROM public.products p;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
 RAISE NOTICE 'PASS: %', label;
END; $$;
CREATE FUNCTION pg_temp.denied(statement text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END; $$;
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM pg_class WHERE oid IN ('public.product_offer_config'::regclass,'public.product_offer_history'::regclass) AND relrowsecurity), 'RLS enabled');
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM public.product_offer_config), 'three per-product examples');
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM public.product_offer_history h JOIN public.product_offer_config c USING(product_id,revision) WHERE h.draft IS NOT DISTINCT FROM c.draft AND h.published IS NOT DISTINCT FROM c.published), 'bootstrap pairs agree');
SET LOCAL ROLE anon;
SELECT pg_temp.assert_true(pg_temp.denied('SELECT draft FROM public.product_offer_config'), 'anon draft denied');
SELECT pg_temp.assert_true(pg_temp.denied('SELECT * FROM public.product_offer_history'), 'anon history denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"bbbbbbbb-0000-4000-a000-000000000000"}',true);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.product_offer_config), 'member config absent');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.product_offer_history), 'member history absent');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"dddddddd-0000-4000-a000-000000000000"}',true);
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM public.product_offer_config), 'admin config reads');
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM public.product_offer_history), 'admin history reads');
RESET ROLE;
DO $$
DECLARE r text; t text; p text; expected boolean;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH t IN ARRAY ARRAY['product_offer_config','product_offer_history'] LOOP
   FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    expected := (r='authenticated' AND p='SELECT') OR (r='service_role' AND (p IN ('SELECT','INSERT') OR (t='product_offer_config' AND p='UPDATE')));
    PERFORM pg_temp.assert_true(has_table_privilege(r,'public.'||t,p)=expected,r||' '||t||' '||p);
   END LOOP;
  END LOOP;
 END LOOP;
END; $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.denied('UPDATE public.product_offer_config SET draft = null'), 'admin direct update denied');
SELECT pg_temp.assert_true(pg_temp.denied('DELETE FROM public.product_offer_history'), 'admin direct history delete denied');
SELECT pg_temp.assert_true(pg_temp.denied('SELECT public.product_offer_config_valid(''{}''::jsonb)'), 'private validator');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$
DECLARE base jsonb := '{"format":1,"enabled":true,"templateId":"offer-default","settings":{"density":"comfortable"},"content":{},"tokens":null}';
 value jsonb; items jsonb; item jsonb; pid uuid; other uuid; t text; col text; n int; delta int;
BEGIN
 SELECT product_id INTO pid FROM public.product_offer_config ORDER BY product_id LIMIT 1;
 SELECT product_id INTO other FROM public.product_offer_config WHERE product_id<>pid ORDER BY product_id LIMIT 1;
 PERFORM pg_temp.assert_true(public.product_offer_config_valid(base), 'enabled config valid');
 PERFORM pg_temp.assert_true(public.product_offer_config_valid(jsonb_set(base,'{enabled}','false')), 'disabled config valid');
 FOREACH value IN ARRAY ARRAY[base||'{"price":10}',base||'{"content_config":{}}',jsonb_set(base,'{settings}','{"heroProduct":"11111111-1111-4111-a111-111111111111"}'),jsonb_set(base,'{content}','{"home.hero":{}}'),jsonb_set(base,'{content}','{"offer.faq":{"sourceLocale":"en","en":{"kind":"faq","items":[{"id":"q","question":"Q","answer":"A"},{"id":"q","question":"Q","answer":"A"}]}}}')] LOOP
  PERFORM pg_temp.assert_true(NOT public.product_offer_config_valid(value), 'invalid shape refused');
 END LOOP;
 INSERT INTO public.product_offer_history(product_id,revision,operation,draft,published) VALUES(pid,1,'draft',base,null);
 INSERT INTO public.product_offer_history(product_id,revision,operation,draft,published) VALUES(other,1,'draft',null,null);
 PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM public.product_offer_history WHERE revision=1), 'independent product revisions');
 FOREACH t IN ARRAY ARRAY['product_offer_config','product_offer_history'] LOOP
  FOREACH col IN ARRAY ARRAY['draft','published'] LOOP
   FOREACH n IN ARRAY ARRAY[102399,102400,102401] LOOP
    SELECT jsonb_agg(jsonb_build_object('id','q'||i,'question','Q','answer',repeat('ą',3000))) INTO items FROM generate_series(1,20) i;
    value := jsonb_set(base,'{content}',jsonb_build_object('offer.faq',jsonb_build_object('sourceLocale','en','en',jsonb_build_object('kind','faq','items',items))));
    delta := octet_length(value::text)-n;
    FOR i IN 0..19 LOOP
     item := value #> ARRAY['content','offer.faq','en','items',i::text];
     IF delta<=0 THEN EXIT; END IF;
     value := jsonb_set(value,ARRAY['content','offer.faq','en','items',i::text,'answer'],to_jsonb(repeat('ą',3000-LEAST(3000,(delta+1)/2))));
     delta := octet_length(value::text)-n;
    END LOOP;
    IF delta=-1 THEN value := jsonb_set(value,'{content,offer.faq,en,items,0,answer}',to_jsonb((value#>>'{content,offer.faq,en,items,0,answer}')||'x')); END IF;
    PERFORM pg_temp.assert_true(octet_length(value::text)=n,'exact UTF-8 size '||n);
    BEGIN
     IF t='product_offer_config' THEN
      EXECUTE format('UPDATE public.%I SET %I=$1 WHERE product_id=$2',t,col) USING value,pid;
     ELSE
      EXECUTE format('INSERT INTO public.%I(product_id,revision,operation,%I) VALUES($2,$3,''draft'',$1)',t,col) USING value,pid,n+CASE WHEN col='draft' THEN 0 ELSE 10 END;
     END IF;
     PERFORM pg_temp.assert_true(n<=102400,t||'.'||col||' accepts '||n);
    EXCEPTION WHEN check_violation THEN PERFORM pg_temp.assert_true(n>102400,t||'.'||col||' rejects '||n); END;
   END LOOP;
  END LOOP;
 END LOOP;
 UPDATE public.product_offer_config SET draft=null,published=null,revision=9007199254740991 WHERE product_id=pid;
 BEGIN UPDATE public.product_offer_config SET revision=9007199254740992 WHERE product_id=pid; RAISE EXCEPTION 'revision accepted'; EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: revision range'; END;
 BEGIN INSERT INTO public.product_offer_history(product_id,revision,operation,restored_from) VALUES(other,2,'rollback',102399); RAISE EXCEPTION 'cross product restore accepted'; EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'PASS: restore product scope'; END;
 INSERT INTO public.product_offer_history(product_id,revision,operation) VALUES(pid,9007199254740991,'draft');
 BEGIN INSERT INTO public.product_offer_history(product_id,revision,operation) VALUES(pid,9007199254740992,'draft'); RAISE EXCEPTION 'history revision accepted'; EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: history revision range'; END;
 BEGIN UPDATE public.product_offer_config SET published=base||'{"price":10}' WHERE product_id=pid; RAISE EXCEPTION 'commercial config accepted'; EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: config fields enforced'; END;
 BEGIN INSERT INTO public.product_offer_history(product_id,revision,operation,draft) VALUES(pid,42,'draft',base||'{"price":10}'); RAISE EXCEPTION 'commercial history accepted'; EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: history fields enforced'; END;
 PERFORM pg_temp.assert_true(pg_temp.denied('UPDATE public.product_offer_history SET draft=null'), 'service history update denied');
 PERFORM pg_temp.assert_true(pg_temp.denied('DELETE FROM public.product_offer_config'), 'service config delete denied');
END; $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT digest = (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) FROM public.products p) FROM commercial_before), 'all commercial fields unchanged');
SELECT pg_temp.assert_true((SELECT array_agg(column_name::text ORDER BY ordinal_position) = ARRAY['product_id','revision','operation','draft','published','actor_id','created_at','restored_from'] FROM information_schema.columns WHERE table_schema='public' AND table_name='product_offer_history'), 'history presentation columns only');
-- Product retirement removes only that product's presentation records.
DELETE FROM public.products WHERE id=(SELECT product_id FROM public.product_offer_config ORDER BY product_id LIMIT 1);
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.product_offer_config), 'product removal cascades');
ROLLBACK;
