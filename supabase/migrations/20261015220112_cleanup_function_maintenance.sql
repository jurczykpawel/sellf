CREATE OR REPLACE FUNCTION public.cleanup_old_admin_actions(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    IF NOT (SELECT public.is_admin()) THEN
        RAISE EXCEPTION 'Unauthorized: Admin privileges required';
    END IF;
    IF retention_days IS NULL OR retention_days < 30 THEN
        RAISE EXCEPTION 'Retention period must be at least 30 days';
    END IF;

    DELETE FROM public.admin_actions
    WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    -- Leave table statistics intact for autovacuum scheduling.
    RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits(retention_hours INTEGER DEFAULT 24)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '60s'
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    IF NOT (SELECT public.is_admin()) THEN
        RAISE EXCEPTION 'Unauthorized: Admin privileges required';
    END IF;
    IF retention_hours IS NULL OR retention_hours < 1 THEN
        RAISE EXCEPTION 'Retention period must be at least 1 hour';
    END IF;

    DELETE FROM public.rate_limits
    WHERE window_start < NOW() - (retention_hours || ' hours')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cleanup_job_status()
RETURNS TABLE(jobname TEXT, schedule TEXT, command TEXT, active BOOLEAN, last_run TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT j.jobname, j.schedule, j.command, j.active,
        (SELECT MAX(r.start_time) FROM cron.job_run_details r WHERE r.jobid = j.jobid)
    FROM cron.job j
    WHERE j.jobname LIKE '%cleanup%'
    ORDER BY j.jobname;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_old_admin_actions(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_rate_limits(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_cleanup_job_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_admin_actions(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_old_rate_limits(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cleanup_job_status() TO service_role;
