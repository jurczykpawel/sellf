\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
CREATE FUNCTION pg_temp.denied(statement text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END;
$$;
SELECT pg_temp.assert_true((SELECT count(*) = 1 AND min(revision) = 0 FROM public.storefront_config), 'singleton revision zero');
SELECT pg_temp.assert_true((SELECT published - ARRAY['settingsByTemplate','content'] = '{"format":1,"templateId":"default","overridesByTemplate":{},"tokens":null}'::jsonb
  AND (published->'settingsByTemplate') ?& ARRAY['storefront-a','storefront-b','storefront-c']
  AND (published->'settingsByTemplate') - ARRAY['storefront-a','storefront-b','storefront-c'] = '{}'::jsonb
  AND (published->'content') ?& ARRAY['home.author','home.story','home.paths','home.projects']
  AND (published->'content') - ARRAY['home.author','home.story','home.paths','home.projects'] = '{}'::jsonb
  AND published #>> '{content,home.author,en,name}' = 'Alex Example'
  AND public.storefront_config_valid(published) AND draft IS NULL AND updated_by IS NULL
  FROM public.storefront_config), 'default bootstrap retains valid inactive templates and seller copy');
SELECT pg_temp.assert_true((SELECT h.revision = c.revision AND h.published = c.published AND h.draft IS NULL AND h.actor_id IS NULL FROM public.storefront_config c CROSS JOIN public.storefront_config_history h), 'bootstrap history matches singleton');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM pg_class WHERE oid IN ('public.storefront_config'::regclass, 'public.storefront_config_history'::regclass) AND relrowsecurity), 'both tables enable RLS');

SET LOCAL ROLE anon;
SELECT pg_temp.assert_true(pg_temp.denied('SELECT draft FROM public.storefront_config'), 'anon cannot read draft');
SELECT pg_temp.assert_true(pg_temp.denied('SELECT * FROM public.storefront_config_history'), 'anon cannot read history');
SELECT pg_temp.assert_true(pg_temp.denied('SELECT public.storefront_config_stored_bytes(''{}''::jsonb)'), 'anon cannot call size helper');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"bbbbbbbb-0000-4000-a000-000000000000"}', true);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.storefront_config), 'member cannot read config');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.storefront_config_history), 'member cannot read history');
SELECT pg_temp.assert_true(pg_temp.denied('SELECT public.storefront_config_stored_bytes(''{}''::jsonb)'), 'member cannot call size helper');
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"dddddddd-0000-4000-a000-000000000000"}', true);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.storefront_config), 'admin reads config');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.storefront_config_history), 'admin reads history');
SELECT pg_temp.assert_true(pg_temp.denied('UPDATE public.storefront_config SET revision = 1'), 'admin cannot update config');
SELECT pg_temp.assert_true(pg_temp.denied('INSERT INTO public.storefront_config_history(revision,operation,published) VALUES (1,''draft'',''{}'')'), 'admin cannot append history');
RESET ROLE;

DO $$
DECLARE role_name text; table_name text; privilege_name text; expected boolean;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH table_name IN ARRAY ARRAY['storefront_config','storefront_config_history'] LOOP
      FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        expected := (role_name = 'authenticated' AND privilege_name = 'SELECT') OR
          (role_name = 'service_role' AND (privilege_name IN ('SELECT','INSERT') OR (table_name = 'storefront_config' AND privilege_name = 'UPDATE')));
        PERFORM pg_temp.assert_true(has_table_privilege(role_name, 'public.' || table_name, privilege_name) = expected, role_name || ' ' || table_name || ' ' || privilege_name);
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.storefront_config), 'service reads config');
UPDATE public.storefront_config SET revision = 1, draft = published;
INSERT INTO public.storefront_config_history(revision,operation,draft,published,restored_from)
SELECT revision, 'draft', draft, published, 0 FROM public.storefront_config;
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.storefront_config_history), 'service appends history');
SELECT pg_temp.assert_true(pg_temp.denied('DELETE FROM public.storefront_config'), 'service cannot delete singleton');
SELECT pg_temp.assert_true(pg_temp.denied('UPDATE public.storefront_config_history SET operation = ''reset'''), 'service cannot update history');
SELECT pg_temp.assert_true(pg_temp.denied('DELETE FROM public.storefront_config_history'), 'service cannot delete history');
RESET ROLE;

DO $$
DECLARE bytes integer; payload jsonb; column_name text; table_name text; rev bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['storefront_config','storefront_config_history'] LOOP
    FOREACH column_name IN ARRAY ARRAY['draft','published'] LOOP
      FOREACH bytes IN ARRAY ARRAY[102399,102400,102401] LOOP
        payload := to_jsonb(repeat('ą', (bytes - 2) / 2) || repeat('x', (bytes - 2) % 2));
        PERFORM pg_temp.assert_true(public.storefront_config_stored_bytes(payload) = bytes, 'authoritative UTF-8 stored size ' || bytes);
        BEGIN
          EXECUTE format('UPDATE public.%I SET %I = $1 WHERE revision = 1', table_name, column_name) USING payload;
          PERFORM pg_temp.assert_true(bytes <= 102400, column_name || ' accepts bounded size');
        EXCEPTION WHEN check_violation THEN
          PERFORM pg_temp.assert_true(bytes > 102400, column_name || ' rejects oversized value');
        END;
      END LOOP;
    END LOOP;
    FOREACH rev IN ARRAY ARRAY[-1, 0, 9007199254740991, 9007199254740992]::bigint[] LOOP
      BEGIN
        -- Revision zero already exists in history.
        IF table_name = 'storefront_config_history' AND rev = 0 THEN CONTINUE; END IF;
        EXECUTE format('UPDATE public.%I SET revision = $1 WHERE revision = 1', table_name) USING rev;
        PERFORM pg_temp.assert_true(rev BETWEEN 0 AND 9007199254740991, table_name || ' accepts revision ' || rev);
        EXECUTE format('UPDATE public.%I SET revision = 1 WHERE revision = $1', table_name) USING rev;
      EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.assert_true(rev < 0 OR rev > 9007199254740991, table_name || ' rejects revision ' || rev);
      END;
    END LOOP;
  END LOOP;
  BEGIN
    INSERT INTO public.storefront_config(id,published) VALUES (false, '{}');
    RAISE EXCEPTION 'false singleton id accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: false singleton id rejected'; END;
  BEGIN
    INSERT INTO public.storefront_config(published) VALUES ('{}');
    RAISE EXCEPTION 'second singleton accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS: second singleton rejected'; END;
  BEGIN
    INSERT INTO public.storefront_config_history(revision,operation,published) VALUES (2,'other','{}');
    RAISE EXCEPTION 'unknown operation accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: unknown operation rejected'; END;
END;
$$;
ROLLBACK;
