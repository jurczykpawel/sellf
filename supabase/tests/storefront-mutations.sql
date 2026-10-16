\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.commerce() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.products p),
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.user_product_access a),
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.integrations_config c));
$$;
CREATE TEMP TABLE storefront_commerce_before AS SELECT pg_temp.commerce() AS state;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
CREATE FUNCTION pg_temp.state() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array((SELECT to_jsonb(c) FROM public.storefront_config c),
    (SELECT jsonb_agg(h ORDER BY revision) FROM public.storefront_config_history h),
    (SELECT jsonb_agg(a ORDER BY id) FROM public.audit_log a WHERE table_name = 'storefront_config'));
$$;
CREATE FUNCTION pg_temp.mutate(rev bigint DEFAULT 0, op text DEFAULT 'draft', config jsonb DEFAULT NULL,
  restored bigint DEFAULT NULL, actor uuid DEFAULT 'dddddddd-0000-4000-a000-000000000000',
  method text DEFAULT 'session', key uuid DEFAULT NULL, source jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.mutate_storefront_config(rev, op, config, restored, actor, method, key, source);
$$;
CREATE FUNCTION pg_temp.reject(args jsonb, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_state jsonb := pg_temp.state(); response jsonb;
BEGIN
  response := pg_temp.mutate(COALESCE((args->>'rev')::bigint,0), COALESCE(args->>'op','draft'),
    CASE WHEN args->>'op' IN ('publish','rollback') THEN args->'config' ELSE COALESCE(args->'config',(SELECT published FROM public.storefront_config)) END, (args->>'restored')::bigint,
    CASE WHEN args ? 'actor' THEN (args->>'actor')::uuid ELSE 'dddddddd-0000-4000-a000-000000000000'::uuid END,
    CASE WHEN args ? 'method' THEN args->>'method' ELSE 'session' END, (args->>'key')::uuid, args->'source');
  PERFORM pg_temp.assert_true(response->>'code' = expected, expected || ' mutation result');
  PERFORM pg_temp.assert_true(before_state = pg_temp.state(), 'rejected operation retains all records');
END;
$$;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.storefront_config_valid(jsonb)','EXECUTE'), 'storefront validator is private');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.mutate_storefront_config(bigint,text,jsonb,bigint,uuid,text,uuid,jsonb)','EXECUTE'), 'anon RPC denied');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.mutate_storefront_config(bigint,text,jsonb,bigint,uuid,text,uuid,jsonb)','EXECUTE'), 'member and admin RPC denied');
SELECT pg_temp.assert_true(has_function_privilege('service_role','public.mutate_storefront_config(bigint,text,jsonb,bigint,uuid,text,uuid,jsonb)','EXECUTE'), 'service RPC granted');
SELECT pg_temp.assert_true((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.mutate_storefront_config(bigint,text,jsonb,bigint,uuid,text,uuid,jsonb)'::regprocedure), 'RPC function settings');
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"dddddddd-0000-4000-a000-000000000000"}', true);
SELECT pg_temp.reject('{}', 'FORBIDDEN');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.assert_true(auth.uid() IS NULL, 'service has no caller UID');
SELECT pg_temp.reject('{"actor":null}', 'FORBIDDEN');
SELECT pg_temp.reject('{"actor":"bbbbbbbb-0000-4000-a000-000000000000"}', 'FORBIDDEN');
SELECT pg_temp.reject('{"actor":"aaaaaaaa-9999-4999-a999-999999999999"}', 'FORBIDDEN');
SELECT pg_temp.reject('{"method":null}', 'FORBIDDEN');
SELECT pg_temp.reject('{"method":"other"}', 'FORBIDDEN');
SELECT pg_temp.reject('{"method":"api_key"}', 'FORBIDDEN');
SELECT pg_temp.reject('{"method":"session","key":"aaaaaaaa-1111-4111-a111-111111111111"}', 'FORBIDDEN');

INSERT INTO public.api_keys(id,name,key_prefix,key_hash,admin_user_id,scopes)
SELECT 'aaaaaaaa-1111-4111-a111-111111111111', 'Template editor', 'sf_test_tpl1', 'phase1-template-test', id, '["templates:write"]'
FROM public.admin_users WHERE user_id='dddddddd-0000-4000-a000-000000000000';
SELECT pg_temp.reject('{"method":"api_key","key":"aaaaaaaa-2222-4222-a222-222222222222"}', 'FORBIDDEN');
INSERT INTO public.admin_users(user_id) VALUES ('bbbbbbbb-0000-4000-a000-000000000000');
UPDATE public.api_keys SET admin_user_id=(SELECT id FROM public.admin_users WHERE user_id='bbbbbbbb-0000-4000-a000-000000000000') WHERE key_hash='phase1-template-test';
SELECT pg_temp.reject('{"method":"api_key","key":"aaaaaaaa-1111-4111-a111-111111111111"}', 'FORBIDDEN');
UPDATE public.api_keys SET admin_user_id=(SELECT id FROM public.admin_users WHERE user_id='dddddddd-0000-4000-a000-000000000000') WHERE key_hash='phase1-template-test';
UPDATE public.api_keys SET scopes='["products:write"]' WHERE key_hash='phase1-template-test';
SELECT pg_temp.reject('{"method":"api_key","key":"aaaaaaaa-1111-4111-a111-111111111111"}', 'FORBIDDEN');
UPDATE public.api_keys SET scopes='["templates:write"]', is_active=false, revoked_at=now(), rotation_grace_until=now()+interval '1 hour' WHERE key_hash='phase1-template-test';
SELECT pg_temp.reject('{"method":"api_key","key":"aaaaaaaa-1111-4111-a111-111111111111"}', 'FORBIDDEN');
UPDATE public.api_keys SET is_active=true, revoked_at=null, expires_at=now()-interval '1 hour' WHERE key_hash='phase1-template-test';
SELECT pg_temp.reject('{"method":"api_key","key":"aaaaaaaa-1111-4111-a111-111111111111"}', 'FORBIDDEN');
UPDATE public.api_keys SET expires_at=null,is_active=false,rotation_grace_until=null WHERE key_hash='phase1-template-test';
SELECT pg_temp.reject('{"method":"api_key","key":"aaaaaaaa-1111-4111-a111-111111111111"}', 'FORBIDDEN');
UPDATE public.api_keys SET is_active=true WHERE key_hash='phase1-template-test';
DO $$ BEGIN
  DELETE FROM public.admin_users WHERE user_id='dddddddd-0000-4000-a000-000000000000';
  PERFORM pg_temp.reject('{}','FORBIDDEN');
  RAISE no_data_found;
EXCEPTION WHEN no_data_found THEN NULL; END; $$;

SELECT pg_temp.assert_true(public.mutate_storefront_config(0,'draft',null)->>'code'='FORBIDDEN', 'missing actor denied');
SELECT pg_temp.assert_true(pg_temp.mutate(null)->>'code'='LIMIT', 'null revision denied');
SELECT pg_temp.reject('{"rev":-1}', 'LIMIT');
SELECT pg_temp.reject('{"rev":9007199254740992}', 'LIMIT');
SELECT pg_temp.reject('{"rev":1}', 'CONFLICT');
SELECT pg_temp.reject('{"op":"other"}', 'INVALID');
SELECT pg_temp.reject('{"op":"publish"}', 'INVALID');
SELECT pg_temp.reject('{"restored":0}', 'INVALID');
SELECT pg_temp.reject('{"op":"rollback","restored":99}', 'NOT_FOUND');
SELECT pg_temp.reject('{"config":{}}', 'INVALID');
DO $$
DECLARE invalid jsonb;
BEGIN
  FOR invalid IN SELECT value FROM jsonb_array_elements('[
    {"tokens":{"format":1,"light":{"accent":"red"}}},
    {"overridesByTemplate":{"d":{"hidden":["catalogue"]}}},
    {"overridesByTemplate":{"d":{"order":["hero","hero","start","catalogue","faq","closing"]}}},
    {"content":{"home.hero":{"sourceLocale":"en","pl":{"kind":"hero","eyebrow":"","heading":"","body":"","steps":[]}}}},
    {"content":{"home.faq":{"sourceLocale":"en","en":{"kind":"faq","items":[{"id":"one","question":"Q","answer":"A"},{"id":"one","question":"Q","answer":"A"}]}}}},
    {"content":{"home.closing":{"sourceLocale":"en","en":{"kind":"cta","heading":"<p>Text</p>","body":""}}}},
    {"settingsByTemplate":{"d":{"heroProduct":"invalid"}}}
  ]'::jsonb) LOOP
    PERFORM pg_temp.reject(jsonb_build_object('config',(SELECT published FROM public.storefront_config)||invalid),'INVALID');
  END LOOP;
END;
$$;
SELECT pg_temp.reject(jsonb_build_object('config', (SELECT published || '{"extra":true}' FROM public.storefront_config)), 'INVALID');
SELECT pg_temp.reject(jsonb_build_object('config', to_jsonb(repeat('ą',51200))), 'LIMIT');
SELECT pg_temp.assert_true(pg_temp.mutate(0,'draft',(SELECT published FROM public.storefront_config))->>'revision' = '1', 'session draft advances revision');
SELECT pg_temp.assert_true((SELECT updated_by='dddddddd-0000-4000-a000-000000000000' AND draft=published FROM public.storefront_config), 'session attribution and draft');
SELECT pg_temp.assert_true((SELECT actor_id='dddddddd-0000-4000-a000-000000000000' FROM public.storefront_config_history WHERE revision=1), 'session history attribution');
SELECT pg_temp.reject('{"rev":0}', 'CONFLICT');
SELECT pg_temp.reject('{"rev":1,"op":"publish","method":"api_key","key":"aaaaaaaa-1111-4111-a111-111111111111"}', 'FORBIDDEN');
SELECT pg_temp.assert_true(pg_temp.mutate(1,'reset',(SELECT draft FROM public.storefront_config),null,'dddddddd-0000-4000-a000-000000000000','api_key','aaaaaaaa-1111-4111-a111-111111111111')->>'revision' = '2', 'key draft operation');
SELECT pg_temp.assert_true((SELECT new_values->>'actor_method'='api_key' AND new_values->>'actor_api_key_id'='aaaaaaaa-1111-4111-a111-111111111111' AND performed_by='dddddddd-0000-4000-a000-000000000000' AND NOT new_values ? 'content' FROM public.audit_log WHERE table_name='storefront_config' AND new_values->>'revision'='2'), 'key audit metadata');
UPDATE public.api_keys SET scopes='["templates:activate"]' WHERE key_hash='phase1-template-test';
SELECT pg_temp.reject('{"rev":2,"method":"api_key","key":"aaaaaaaa-1111-4111-a111-111111111111"}', 'FORBIDDEN');
SELECT pg_temp.assert_true(pg_temp.mutate(2,'publish',null,null,'dddddddd-0000-4000-a000-000000000000','api_key','aaaaaaaa-1111-4111-a111-111111111111')->>'revision' = '3', 'key publishes stored draft');
SELECT pg_temp.assert_true((SELECT draft IS NULL FROM public.storefront_config), 'publish clears draft');
SELECT pg_temp.assert_true(pg_temp.mutate(3,'rollback',null,0)->>'revision' = '4', 'rollback appends revision');
SELECT pg_temp.assert_true((SELECT restored_from=0 AND draft IS NULL FROM public.storefront_config_history WHERE revision=4), 'rollback history pair');
INSERT INTO public.storefront_config_history(revision,operation,published) VALUES (99,'draft','{}');
SELECT pg_temp.reject('{"rev":4,"op":"rollback","restored":99}', 'INVALID');
UPDATE public.storefront_config SET draft='{}';
SELECT pg_temp.reject('{"rev":4,"op":"publish"}', 'INVALID');
UPDATE public.storefront_config SET draft=null;

DO $$
DECLARE payload jsonb; base_bytes integer; remaining integer; target integer; locale text; item integer; response jsonb;
BEGIN
  FOREACH target IN ARRAY ARRAY[102399,102400,102401] LOOP
    payload := (SELECT published FROM public.storefront_config) || jsonb_build_object('content', jsonb_build_object('home.faq', jsonb_build_object(
      'sourceLocale','en','en',jsonb_build_object('kind','faq','items',(SELECT jsonb_agg(jsonb_build_object('id','item-'||i,'question','Q','answer','')) FROM generate_series(1,20) i)),
      'pl',jsonb_build_object('kind','faq','items',(SELECT jsonb_agg(jsonb_build_object('id','item-'||i,'question','Q','answer','')) FROM generate_series(1,20) i)))));
    base_bytes := public.storefront_config_stored_bytes(payload); remaining := target-base_bytes;
    FOREACH locale IN ARRAY ARRAY['en','pl'] LOOP
      FOR item IN 0..19 LOOP
        payload := jsonb_set(payload, ARRAY['content','home.faq',locale,'items',item::text,'answer'], to_jsonb(repeat('ą',LEAST(remaining,4000)/2)||repeat('x',LEAST(remaining,4000)%2)));
        remaining := remaining-LEAST(remaining,4000);
      END LOOP;
    END LOOP;
    PERFORM pg_temp.assert_true(public.storefront_config_stored_bytes(payload)=target, 'mutation stored boundary '||target);
    IF target > 102400 THEN
      PERFORM pg_temp.reject(jsonb_build_object('rev',(SELECT revision FROM public.storefront_config),'config',payload),'LIMIT');
    ELSE
      response := pg_temp.mutate((SELECT revision FROM public.storefront_config),'draft',payload);
      PERFORM pg_temp.assert_true(response->>'success'='true','bounded config accepted');
    END IF;
  END LOOP;
END;
$$;
SELECT pg_temp.reject(jsonb_build_object('rev',(SELECT revision FROM public.storefront_config),'op','legacy-import'), 'INVALID');
SELECT pg_temp.reject(jsonb_build_object('rev',(SELECT revision FROM public.storefront_config),'source',jsonb_build_object('sha256',repeat('a',64),'byteLength',1)), 'INVALID');
DO $$
DECLARE source jsonb := jsonb_build_object('sha256',repeat('a',64),'byteLength',123); response jsonb; rev bigint;
BEGIN
  rev := (SELECT revision FROM public.storefront_config);
  PERFORM pg_temp.reject(jsonb_build_object('rev',rev,'op','legacy-import','source',source||'{"extra":true}'), 'INVALID');
  PERFORM pg_temp.reject(jsonb_build_object('rev',rev,'op','legacy-import','source',source||'{"byteLength":102401}'), 'INVALID');
  PERFORM pg_temp.reject(jsonb_build_object('rev',rev,'op','legacy-import','source',source||'{"sha256":"short"}'), 'INVALID');
  response := pg_temp.mutate(rev,'legacy-import',(SELECT published FROM public.storefront_config), source=>source);
  PERFORM pg_temp.assert_true(response->>'success'='true', 'legacy import advances revision');
  PERFORM pg_temp.assert_true((SELECT operation='legacy-import' FROM public.storefront_config_history WHERE revision=rev+1), 'legacy import retains history');
  PERFORM pg_temp.assert_true((SELECT new_values->'legacySource'=source FROM public.audit_log WHERE table_name='storefront_config' AND new_values->>'revision'=(rev+1)::text), 'legacy import retains source metadata in the same revision');
END;
$$;
CREATE FUNCTION pg_temp.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit unavailable'; END; $$;
CREATE TRIGGER test_storefront_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_audit();
SELECT pg_temp.reject(jsonb_build_object('rev',(SELECT revision FROM public.storefront_config)), 'UNAVAILABLE');
SELECT pg_temp.reject(jsonb_build_object('rev',(SELECT revision FROM public.storefront_config),'op','legacy-import',
  'source',jsonb_build_object('sha256',repeat('a',64),'byteLength',123)), 'UNAVAILABLE');
DROP TRIGGER test_storefront_audit ON public.audit_log;
UPDATE public.storefront_config SET revision=9007199254740991;
SELECT pg_temp.reject('{"rev":9007199254740991}', 'LIMIT');
SELECT pg_temp.assert_true((SELECT state = pg_temp.commerce() FROM storefront_commerce_before), 'lifecycle retains products access and platform configuration');
ROLLBACK;
