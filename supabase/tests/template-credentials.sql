\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
CREATE FUNCTION pg_temp.state() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array((SELECT jsonb_agg(c ORDER BY template_id) FROM public.template_credentials c),
    (SELECT jsonb_agg(a ORDER BY id) FROM public.audit_log a WHERE table_name='template_credentials'));
$$;
CREATE FUNCTION pg_temp.save(actor uuid DEFAULT 'dddddddd-0000-4000-a000-000000000000',
  method text DEFAULT 'session', key uuid DEFAULT NULL, template text DEFAULT 'storefront-a') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.save_template_credential(template, 'Y2lwaGVy', 'AAAAAAAAAAAAAAAAAAAAAA==', 'AAAAAAAAAAAAAAAAAAAAAA==', actor, method, key);
$$;
CREATE FUNCTION pg_temp.reject(actor uuid, method text, key uuid, expected text DEFAULT 'FORBIDDEN') RETURNS void LANGUAGE plpgsql AS $$
DECLARE snapshot jsonb := pg_temp.state(); response jsonb;
BEGIN
  response := pg_temp.save(actor,method,key);
  PERFORM pg_temp.assert_true(response->>'code'=expected, 'write returns ' || expected);
  PERFORM pg_temp.assert_true(snapshot=pg_temp.state(), 'denied write retains records');
END;
$$;
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid='public.template_credentials'::regclass), 'RLS enabled');
SELECT pg_temp.assert_true((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.save_template_credential(text,text,text,text,uuid,text,uuid)'::regprocedure), 'RPC settings');
DO $$
DECLARE role_name text; op text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH op IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(role_name,'public.template_credentials',op),role_name || ' denied ' || op);
    END LOOP;
    PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,'public.save_template_credential(text,text,text,text,uuid,text,uuid)','EXECUTE'), role_name || ' denied RPC');
  END LOOP;
END;
$$;
DO $$
DECLARE role_name text; query text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH query IN ARRAY ARRAY['SELECT * FROM public.template_credentials',
      'INSERT INTO public.template_credentials(template_id) VALUES (''storefront-a'')',
      'UPDATE public.template_credentials SET state=''missing''', 'DELETE FROM public.template_credentials'] LOOP
      EXECUTE format('SET LOCAL ROLE %I',role_name);
      BEGIN
        EXECUTE query;
        RAISE EXCEPTION 'Unexpected credential access for %',role_name;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      RESET ROLE;
    END LOOP;
  END LOOP;
END;
$$;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"dddddddd-0000-4000-a000-000000000000"}',true);
SELECT pg_temp.reject('dddddddd-0000-4000-a000-000000000000','session',null);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT pg_temp.reject(null,'session',null);
SELECT pg_temp.reject('bbbbbbbb-0000-4000-a000-000000000000','session',null);
SELECT pg_temp.reject('dddddddd-0000-4000-a000-000000000000',null,null);
SELECT pg_temp.reject('dddddddd-0000-4000-a000-000000000000','other',null);
SELECT pg_temp.reject('dddddddd-0000-4000-a000-000000000000','api_key',null);
SELECT pg_temp.reject('dddddddd-0000-4000-a000-000000000000','session','aaaaaaaa-1111-4111-a111-111111111111');
INSERT INTO public.api_keys(id,name,key_prefix,key_hash,admin_user_id,scopes)
SELECT 'aaaaaaaa-1111-4111-a111-111111111111','Template credentials','sf_test_tpl2','template-credential-test',id,'["templates:read"]'
FROM public.admin_users WHERE user_id='dddddddd-0000-4000-a000-000000000000';
SELECT pg_temp.reject('dddddddd-0000-4000-a000-000000000000','api_key','aaaaaaaa-1111-4111-a111-111111111111');
UPDATE public.api_keys SET scopes='["templates:write"]',expires_at=now()-interval '1 hour' WHERE key_hash='template-credential-test';
SELECT pg_temp.reject('dddddddd-0000-4000-a000-000000000000','api_key','aaaaaaaa-1111-4111-a111-111111111111');
UPDATE public.api_keys SET expires_at=null,revoked_at=now(),is_active=false WHERE key_hash='template-credential-test';
SELECT pg_temp.reject('dddddddd-0000-4000-a000-000000000000','api_key','aaaaaaaa-1111-4111-a111-111111111111');
UPDATE public.api_keys SET revoked_at=null,is_active=false WHERE key_hash='template-credential-test';
SELECT pg_temp.reject('dddddddd-0000-4000-a000-000000000000','api_key','aaaaaaaa-1111-4111-a111-111111111111');
UPDATE public.api_keys SET is_active=true WHERE key_hash='template-credential-test';
INSERT INTO public.admin_users(user_id) VALUES ('bbbbbbbb-0000-4000-a000-000000000000');
SELECT pg_temp.reject('bbbbbbbb-0000-4000-a000-000000000000','api_key','aaaaaaaa-1111-4111-a111-111111111111');
CREATE TEMP TABLE presentation_before AS SELECT jsonb_build_array(
  (SELECT jsonb_agg(c) FROM public.storefront_config c),
  (SELECT jsonb_agg(h ORDER BY revision) FROM public.storefront_config_history h)) AS state;
SELECT pg_temp.assert_true(pg_temp.save()->'status'='{"templateId":"storefront-a","state":"unknown","verifiedAt":null}', 'session write returns status only');
UPDATE public.template_credentials SET state='valid',verified_at=now() WHERE template_id='storefront-a';
SELECT pg_temp.assert_true(pg_temp.save('dddddddd-0000-4000-a000-000000000000','api_key','aaaaaaaa-1111-4111-a111-111111111111')->>'success'='true','WRITE-only key accepted');
SELECT pg_temp.assert_true((SELECT state='unknown' AND verified_at IS NULL FROM public.template_credentials WHERE template_id='storefront-a'), 'replacement clears verification');
SELECT pg_temp.assert_true(pg_temp.save(template=>'default')->>'code'='INVALID','unsupported template denied');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM public.audit_log WHERE table_name='template_credentials'), 'each successful write audited');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.audit_log WHERE table_name='template_credentials' AND new_values::text ~ 'Y2lwaGVy|encrypted|token|email|order'), 'audit fields contain status metadata only');
SELECT pg_temp.assert_true((SELECT jsonb_build_array(
  (SELECT jsonb_agg(c) FROM public.storefront_config c),
  (SELECT jsonb_agg(h ORDER BY revision) FROM public.storefront_config_history h))=state FROM presentation_before), 'config and history unchanged');
CREATE FUNCTION pg_temp.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit unavailable'; END;
$$;
CREATE TRIGGER template_credential_test BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_audit();
SELECT pg_temp.reject('dddddddd-0000-4000-a000-000000000000','session',null,'UNAVAILABLE');
SELECT pg_temp.assert_true(pg_temp.save(template=>'storefront-b')->>'code'='UNAVAILABLE', 'audit failure on first credential');
SELECT pg_temp.assert_true((SELECT state='missing' AND encrypted_key IS NULL FROM public.template_credentials WHERE template_id='storefront-b'), 'first credential remains absent');
ROLLBACK;
