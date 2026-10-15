\set ON_ERROR_STOP on
-- Run as the local supabase_admin role to create rolled-back cron fixtures.
BEGIN;
CREATE EXTENSION IF NOT EXISTS plpgsql_check WITH SCHEMA extensions;

CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
    RAISE NOTICE 'PASS: %', label;
END;
$$;

-- Check all branches without executing maintenance statistics operations.
SELECT pg_temp.assert_true(NOT EXISTS (
    SELECT 1
    FROM (VALUES ('public.cleanup_old_admin_actions(integer)'),
                 ('public.cleanup_old_rate_limits(integer)'),
                 ('public.get_cleanup_job_status()')) AS f(signature)
    CROSS JOIN LATERAL extensions.plpgsql_check_function_tb(f.signature::regprocedure) AS issue
    WHERE issue.level = 'error'
), 'cleanup functions compile with their configured search paths');

INSERT INTO cron.job(jobid, jobname, schedule, command, nodename, nodeport, database, username, active)
VALUES (-901001, 'sql-cleanup-history', '0 0 * * *', 'SELECT 1', 'localhost', 5432, current_database(), current_user, false),
       (-901002, 'sql-cleanup-never-run', '0 0 * * *', 'SELECT 1', 'localhost', 5432, current_database(), current_user, false),
       (-901003, 'sql-unrelated-job', '0 0 * * *', 'SELECT 1', 'localhost', 5432, current_database(), current_user, false);
INSERT INTO cron.job_run_details(jobid, runid, start_time)
VALUES (-901001, -901001, now() - interval '2 days'),
       (-901001, -901002, now() - interval '1 day'),
       (-901001, -901003, NULL);
SELECT pg_temp.assert_true((SELECT last_run = now() - interval '1 day'
    AND schedule = '0 0 * * *' AND command = 'SELECT 1' AND active = false
    FROM public.get_cleanup_job_status() WHERE jobname = 'sql-cleanup-history'), 'latest run and job configuration are reported once');
SELECT pg_temp.assert_true((SELECT last_run IS NULL
    FROM public.get_cleanup_job_status() WHERE jobname = 'sql-cleanup-never-run'), 'jobs without history remain visible');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM public.get_cleanup_job_status()
    WHERE jobname = 'sql-unrelated-job'), 'status includes only cleanup jobs');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.assert_true(public.batch_check_user_product_access(NULL) = '{}'::jsonb,
    'batch access initializes an empty JSON object');
SELECT pg_temp.assert_true(public._process_stripe_payment_completion_with_bump_impl(NULL, NULL, NULL, NULL, NULL)
    ->> 'error' = 'Invalid session ID', 'payment initializes its UUID array before validating input');
INSERT INTO public.admin_actions(action, target_type, target_id, created_at)
VALUES ('sql-cleanup-test', 'test', 'expired', now() - interval '91 days'),
       ('sql-cleanup-test', 'test', 'retained', now() - interval '90 days');
INSERT INTO public.rate_limits(user_id, function_name, window_start)
VALUES ('ca900000-0000-4000-a000-000000000001', 'sql-cleanup-test', now() - interval '25 hours'),
       ('ca900000-0000-4000-a000-000000000001', 'sql-cleanup-test', now() - interval '24 hours');
DO $$
DECLARE expected integer;
BEGIN
    SELECT count(*) INTO expected FROM public.admin_actions WHERE created_at < now() - interval '90 days';
    PERFORM pg_temp.assert_true(public.cleanup_old_admin_actions() = expected, 'admin cleanup returns deleted count');
    SELECT count(*) INTO expected FROM public.rate_limits WHERE window_start < now() - interval '24 hours';
    PERFORM pg_temp.assert_true(public.cleanup_old_rate_limits() = expected, 'rate cleanup returns deleted count');
END;
$$;
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.admin_actions WHERE action = 'sql-cleanup-test'
    AND target_id = 'retained'), 'admin retention boundary is preserved');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.rate_limits WHERE function_name = 'sql-cleanup-test'
    AND window_start = now() - interval '24 hours'), 'rate retention boundary is preserved');

DO $$
DECLARE signature text;
BEGIN
    FOREACH signature IN ARRAY ARRAY['public.cleanup_old_admin_actions(integer)',
        'public.cleanup_old_rate_limits(integer)', 'public.get_cleanup_job_status()'] LOOP
        PERFORM pg_temp.assert_true(has_function_privilege('service_role', signature, 'EXECUTE')
            AND NOT has_function_privilege('anon', signature, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', signature, 'EXECUTE'), signature || ' grants');
    END LOOP;
    BEGIN
        PERFORM public.cleanup_old_admin_actions(29);
        RAISE EXCEPTION 'Expected retention validation';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'Retention period must be at least 30 days' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM public.cleanup_old_rate_limits(0);
        RAISE EXCEPTION 'Expected retention validation';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'Retention period must be at least 1 hour' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM public.cleanup_old_admin_actions(NULL);
        RAISE EXCEPTION 'Expected retention validation';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'Retention period must be at least 30 days' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM public.cleanup_old_rate_limits(NULL);
        RAISE EXCEPTION 'Expected retention validation';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'Retention period must be at least 1 hour' THEN RAISE; END IF;
    END;
END;
$$;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
DO $$
BEGIN
    BEGIN
        PERFORM public.cleanup_old_admin_actions();
        RAISE EXCEPTION 'Expected admin check';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'Unauthorized: Admin privileges required' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM public.cleanup_old_rate_limits();
        RAISE EXCEPTION 'Expected admin check';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'Unauthorized: Admin privileges required' THEN RAISE; END IF;
    END;
END;
$$;
ROLLBACK;
