\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF; RAISE NOTICE 'PASS: %', label; END;
$$;
SELECT pg_temp.assert_true((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.record_template_credential_status(text,text,text,text,text,timestamptz)'::regprocedure), 'background RPC settings');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.record_template_credential_status(text,text,text,text,text,timestamptz)','EXECUTE'), 'anonymous denied');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.record_template_credential_status(text,text,text,text,text,timestamptz)','EXECUTE'), 'member denied');
CREATE TEMP TABLE original_history AS SELECT * FROM public.storefront_config_history;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT public.save_template_credential('storefront-a','Y2lwaGVy','AAAAAAAAAAAAAAAAAAAAAA==','AAAAAAAAAAAAAAAAAAAAAA==','dddddddd-0000-4000-a000-000000000000','session',NULL);
CREATE FUNCTION pg_temp.record(state text, key text DEFAULT 'Y2lwaGVy', checked timestamptz DEFAULT clock_timestamp()) RETURNS boolean LANGUAGE sql AS $$
SELECT public.record_template_credential_status('storefront-a',key,'AAAAAAAAAAAAAAAAAAAAAA==','AAAAAAAAAAAAAAAAAAAAAA==',state,checked);
$$;
SELECT pg_temp.assert_true(NOT pg_temp.record('valid','b3RoZXI='), 'replacement confirmation ignored');
SELECT pg_temp.assert_true(NOT pg_temp.record('valid', checked=>clock_timestamp()-interval '61 seconds'), 'stale confirmation denied');
SELECT pg_temp.assert_true(pg_temp.record('valid'), 'matching confirmation saved');
SELECT pg_temp.assert_true((SELECT state='valid' AND verified_at IS NOT NULL FROM public.template_credentials WHERE template_id='storefront-a'), 'verified status stored');
SELECT pg_temp.assert_true(pg_temp.record('revoked'), 'revocation stored');
SELECT pg_temp.assert_true(NOT pg_temp.record('valid'), 'revocation retained');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM ((SELECT * FROM public.storefront_config_history EXCEPT SELECT * FROM original_history) UNION ALL (SELECT * FROM original_history EXCEPT SELECT * FROM public.storefront_config_history)) diff), 'history unchanged');
SELECT public.save_template_credential('storefront-a','Y2lwaGVy','AAAAAAAAAAAAAAAAAAAAAA==','AAAAAAAAAAAAAAAAAAAAAA==','dddddddd-0000-4000-a000-000000000000','session',NULL);
CREATE FUNCTION pg_temp.reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit unavailable'; END; $$;
CREATE TRIGGER t203_reject_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_audit();
SELECT pg_temp.assert_true(NOT pg_temp.record('valid'), 'audit failure reported');
SELECT pg_temp.assert_true((SELECT state='unknown' AND verified_at IS NULL FROM public.template_credentials WHERE template_id='storefront-a'), 'audit failure retains original status');
ROLLBACK;
