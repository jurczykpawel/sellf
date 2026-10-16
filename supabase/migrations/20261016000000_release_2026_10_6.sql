-- Sellf 2026.10.6

-- Replace a webhook secret and record the actor in a single transaction.
CREATE OR REPLACE FUNCTION public.rotate_webhook_secret(
  p_endpoint_id uuid,
  p_secret text,
  p_actor_id uuid,
  p_api_key_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = p_actor_id) THEN
    RAISE EXCEPTION 'Admin required';
  END IF;
  IF p_secret IS NULL OR p_secret NOT LIKE 'enc:v1:%' THEN
    RAISE EXCEPTION 'Encrypted secret required';
  END IF;

  UPDATE public.webhook_endpoints
  SET secret = p_secret, updated_at = now()
  WHERE id = p_endpoint_id;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.audit_log (table_name, operation, new_values, performed_by)
  VALUES ('webhook_endpoints', 'UPDATE', jsonb_build_object(
    'id', p_endpoint_id,
    'action', 'secret_rotated',
    'api_key_id', p_api_key_id
  ), p_actor_id);
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rotate_webhook_secret(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_webhook_secret(uuid, text, uuid, uuid) TO service_role;

-- Product mutations and their snapshots share one transaction.
CREATE FUNCTION public.mutate_product_with_audit(
  operation_param text,
  product_data jsonb,
  product_id uuid,
  actor_id uuid
) RETURNS SETOF public.products
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  before_row public.products;
  after_row public.products;
  columns_sql text;
BEGIN
  -- Only the server supplies the actor, after session or API-key authentication.
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     OR NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = actor_id) THEN
    RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501';
  END IF;
  IF operation_param NOT IN ('INSERT', 'UPDATE', 'DELETE') OR operation_param IS NULL
     OR product_data IS NULL OR jsonb_typeof(product_data) <> 'object' THEN
    RAISE EXCEPTION 'Invalid product mutation' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(product_data) AS k(name)
    WHERE name IN ('id', 'created_at', 'updated_at') OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.products'::regclass AND attname = k.name
        AND attnum > 0 AND NOT attisdropped
    )
  ) THEN
    RAISE EXCEPTION 'Invalid product fields' USING ERRCODE = '22023';
  END IF;

  IF operation_param IN ('UPDATE', 'DELETE') THEN
    SELECT * INTO before_row FROM public.products WHERE id = product_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT string_agg(format('%I', name), ', ' ORDER BY name)
    INTO columns_sql FROM jsonb_object_keys(product_data) AS k(name);
  IF operation_param = 'INSERT' THEN
    IF columns_sql IS NULL THEN
      RAISE EXCEPTION 'Product fields required' USING ERRCODE = '22023';
    END IF;
    EXECUTE format(
      'INSERT INTO public.products (%s) SELECT %s FROM jsonb_populate_record(NULL::public.products, $1) RETURNING *',
      columns_sql, columns_sql
    ) INTO after_row USING product_data;
  ELSIF operation_param = 'UPDATE' THEN
    IF columns_sql IS NULL THEN
      UPDATE public.products SET updated_at = now() WHERE id = product_id RETURNING * INTO after_row;
    ELSE
      EXECUTE format(
        'UPDATE public.products SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.products, $1)) WHERE id = $2 RETURNING *',
        columns_sql, columns_sql
      ) INTO after_row USING product_data, product_id;
    END IF;
  ELSE
    DELETE FROM public.products WHERE id = product_id;
  END IF;

  INSERT INTO public.audit_log (table_name, operation, old_values, new_values, user_id, performed_by)
  VALUES (
    'products', operation_param,
    CASE WHEN operation_param <> 'INSERT' THEN to_jsonb(before_row) END,
    CASE WHEN operation_param <> 'DELETE' THEN to_jsonb(after_row) END,
    actor_id, actor_id
  );
  RETURN NEXT CASE WHEN operation_param = 'DELETE' THEN before_row ELSE after_row END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mutate_product_with_audit(text, jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_product_with_audit(text, jsonb, uuid, uuid) TO service_role;

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
