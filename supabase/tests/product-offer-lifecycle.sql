\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; RAISE NOTICE 'PASS: %',label; END; $$;
CREATE TEMP TABLE commercial_before AS SELECT jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.products p),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.user_product_access a)) AS state;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.mutate_product_offer(uuid,bigint,text,jsonb,bigint,uuid,text,uuid)','EXECUTE'),'anon denied');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.mutate_product_offer(uuid,bigint,text,jsonb,bigint,uuid,text,uuid)','EXECUTE'),'session direct RPC denied');
SELECT pg_temp.assert_true(has_function_privilege('service_role','public.mutate_product_offer(uuid,bigint,text,jsonb,bigint,uuid,text,uuid)','EXECUTE'),'service RPC');
SELECT pg_temp.assert_true((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.mutate_product_offer(uuid,bigint,text,jsonb,bigint,uuid,text,uuid)'::regprocedure),'RPC settings');
INSERT INTO public.api_keys(id,name,key_prefix,key_hash,admin_user_id,scopes)
 SELECT 'aaaaaaaa-1111-4111-a111-111111111111','Offer fixture','sf_test_tpl1','offer-lifecycle-fixture',id,'["products:write"]' FROM public.admin_users WHERE user_id='dddddddd-0000-4000-a000-000000000000';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$
DECLARE pid uuid; other uuid; r jsonb; base jsonb := '{"format":1,"enabled":true,"templateId":"offer-default","settings":{"density":"comfortable"},"content":{},"tokens":null}'; actor uuid := 'dddddddd-0000-4000-a000-000000000000';
BEGIN
 SELECT id INTO pid FROM public.products WHERE is_active AND is_listed AND id NOT IN (SELECT product_id FROM public.product_offer_config) ORDER BY id LIMIT 1;
 SELECT product_id INTO other FROM public.product_offer_config ORDER BY product_id LIMIT 1;
 PERFORM pg_temp.assert_true(pid IS NOT NULL,'uninitialized product available');
 r := public.mutate_product_offer(pid,0,'draft',base,null,null,'session');
 PERFORM pg_temp.assert_true(r->>'code'='FORBIDDEN','actor required');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.product_offer_config WHERE product_id=pid),'denied does not initialize');
 r := public.mutate_product_offer(pid,0,'draft',base,null,actor,'api_key','aaaaaaaa-1111-4111-a111-111111111111');
 PERFORM pg_temp.assert_true(r->>'code'='FORBIDDEN','product-only key denied');
 r := public.mutate_product_offer(pid,9007199254740992,'draft',base,null,actor,'session');
 PERFORM pg_temp.assert_true(r->>'code'='LIMIT','revision limit');
 r := public.mutate_product_offer(pid,0,'draft',base||'{"price":10}',null,actor,'session');
 PERFORM pg_temp.assert_true(r->>'code'='INVALID','invalid config');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.product_offer_config WHERE product_id=pid),'invalid does not initialize');
 UPDATE public.api_keys SET scopes='["templates:write"]' WHERE key_hash='offer-lifecycle-fixture';
 r := public.mutate_product_offer(pid,0,'draft',base,null,actor,'api_key','aaaaaaaa-1111-4111-a111-111111111111');
 PERFORM pg_temp.assert_true(r @> '{"success":true,"revision":1}','first draft');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM public.product_offer_history WHERE product_id=pid),'baseline plus first draft history');
 PERFORM pg_temp.assert_true((SELECT published IS NULL FROM public.product_offer_config WHERE product_id=pid),'draft never opts in');
 r := public.mutate_product_offer(pid,0,'draft',base,null,actor,'session');
 PERFORM pg_temp.assert_true(r @> '{"code":"CONFLICT","currentRevision":1}','stale first edit');
 r := public.mutate_product_offer(pid,1,'publish',null,null,actor,'api_key','aaaaaaaa-1111-4111-a111-111111111111');
 PERFORM pg_temp.assert_true(r->>'code'='FORBIDDEN','write scope cannot activate');
 r := public.mutate_product_offer(pid,1,'publish',base,null,actor,'session');
 PERFORM pg_temp.assert_true(r->>'code'='INVALID','publish accepts no config');
 r := public.mutate_product_offer(pid,1,'publish',null,null,actor,'session');
 PERFORM pg_temp.assert_true(r @> '{"success":true,"revision":2}','publish stored draft');
 PERFORM pg_temp.assert_true((SELECT published=base AND draft IS NULL FROM public.product_offer_config WHERE product_id=pid),'stored publication');
 r := public.mutate_product_offer(pid,2,'publish',null,null,actor,'session');
 PERFORM pg_temp.assert_true(r->>'code'='INVALID','publish requires draft');
 r := public.mutate_product_offer(pid,2,'rollback',null,0,actor,'session');
 PERFORM pg_temp.assert_true(r @> '{"success":true,"revision":3}','rollback to null opt-out');
 PERFORM pg_temp.assert_true((SELECT published IS NULL FROM public.product_offer_config WHERE product_id=pid),'null restored');
 r := public.mutate_product_offer(other,0,'rollback',null,2,actor,'session');
 PERFORM pg_temp.assert_true(r->>'code'='NOT_FOUND','history product scope');
 r := public.mutate_product_offer(pid,3,'rollback',null,2,actor,'session');
 PERFORM pg_temp.assert_true(r @> '{"success":true,"revision":4}','rollback appends');
 PERFORM pg_temp.assert_true((SELECT restored_from=2 FROM public.product_offer_history WHERE product_id=pid AND revision=4),'restore reference');
 PERFORM pg_temp.assert_true((SELECT count(*)=4 FROM public.audit_log WHERE table_name='product_offer_config' AND new_values->>'productId'=pid::text),'one audit per change');
END; $$;
RESET ROLE;
CREATE FUNCTION pg_temp.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.table_name='product_offer_config' THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER offer_test_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_audit();
CREATE TEMP TABLE offer_before AS SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(c) ORDER BY product_id) FROM public.product_offer_config c),(SELECT jsonb_agg(to_jsonb(h) ORDER BY product_id,revision) FROM public.product_offer_history h)) AS state;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$ DECLARE pid uuid; rev bigint; r jsonb; BEGIN
 SELECT product_id,revision INTO pid,rev FROM public.product_offer_config ORDER BY revision DESC LIMIT 1;
 r := public.mutate_product_offer(pid,rev,'reset','{"format":1,"enabled":false,"templateId":"offer-default","settings":{"density":"comfortable"},"content":{},"tokens":null}',null,'dddddddd-0000-4000-a000-000000000000','session');
 PERFORM pg_temp.assert_true(r->>'code'='UNAVAILABLE','audit failure reported');
 SELECT id INTO pid FROM public.products WHERE id NOT IN (SELECT product_id FROM public.product_offer_config) LIMIT 1;
 r := public.mutate_product_offer(pid,0,'draft','{"format":1,"enabled":false,"templateId":"offer-default","settings":{"density":"comfortable"},"content":{},"tokens":null}',null,'dddddddd-0000-4000-a000-000000000000','session');
 PERFORM pg_temp.assert_true(r->>'code'='UNAVAILABLE' AND NOT EXISTS(SELECT 1 FROM public.product_offer_config WHERE product_id=pid),'audit failure preserves absent state');
END; $$;
RESET ROLE;
SELECT pg_temp.assert_true((SELECT state FROM offer_before)=jsonb_build_array((SELECT jsonb_agg(to_jsonb(c) ORDER BY product_id) FROM public.product_offer_config c),(SELECT jsonb_agg(to_jsonb(h) ORDER BY product_id,revision) FROM public.product_offer_history h)),'audit failure preserves state and history');
SELECT pg_temp.assert_true((SELECT state FROM commercial_before)=jsonb_build_array((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.products p),(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.user_product_access a)),'commercial state unchanged');
ROLLBACK;
