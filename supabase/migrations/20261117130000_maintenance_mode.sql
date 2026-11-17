-- Maintenance mode ("Przerwa w działaniu"), the database source: the seller switches it on in the
-- panel or through API v1 for a planned break. While on, the shop, checkout, embed and login wall
-- answer 503 with a maintenance page; the admin panel and Stripe webhooks keep working.
-- The second source is a file on the server (<install>/MAINTENANCE), checked before any database
-- query and managed by scripts/upgrade.sh; it is not stored here.
--
-- @see admin-panel/src/lib/maintenance/setting.ts (panel + API v1)
-- @see admin-panel/src/lib/maintenance/state.ts (proxy read through get_maintenance_mode)

CREATE TABLE public.maintenance_mode (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  message text CHECK (message IS NULL OR char_length(message) BETWEEN 1 AND 500),
  expected_end_at timestamptz,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX maintenance_mode_changed_by_idx ON public.maintenance_mode(changed_by);
COMMENT ON TABLE public.maintenance_mode IS 'Singleton: maintenance mode switched from the panel or API v1. Changed only through set_maintenance_mode (audited).';

INSERT INTO public.maintenance_mode DEFAULT VALUES;

ALTER TABLE public.maintenance_mode ENABLE ROW LEVEL SECURITY;
CREATE POLICY maintenance_mode_service ON public.maintenance_mode FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role') WITH CHECK ((select auth.role()) = 'service_role');
CREATE POLICY maintenance_mode_admin_read ON public.maintenance_mode FOR SELECT TO authenticated
  USING ((select public.is_admin()));
REVOKE ALL ON public.maintenance_mode FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.maintenance_mode TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.maintenance_mode TO service_role;

-- Public read for the proxy (anon key): only what the maintenance page shows. The message and the
-- expected end are returned only while the mode is on.
CREATE FUNCTION public.get_maintenance_mode()
RETURNS TABLE (enabled boolean, message text, expected_end_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.enabled,
         CASE WHEN m.enabled THEN m.message END,
         CASE WHEN m.enabled THEN m.expected_end_at END
  FROM public.maintenance_mode m
  WHERE m.id;
$$;
REVOKE EXECUTE ON FUNCTION public.get_maintenance_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_maintenance_mode() TO anon, authenticated, service_role;

-- Switch the mode and write the audit entry in ONE transaction: when the audit insert fails
-- (e.g. performed_by is not an auth user) nothing changes and the caller gets the error.
-- Returns the previous state.
CREATE FUNCTION public.set_maintenance_mode(
  p_enabled boolean,
  p_message text,
  p_expected_end_at timestamptz,
  p_performed_by uuid,
  p_details jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.maintenance_mode;
  v_message text := nullif(btrim(p_message), '');
  v_previous jsonb;
  v_next jsonb;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL OR p_performed_by IS NULL
     OR (v_message IS NOT NULL AND char_length(v_message) > 500)
     OR (p_details IS NOT NULL AND jsonb_typeof(p_details) <> 'object') THEN
    RAISE EXCEPTION 'Invalid maintenance mode change' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.maintenance_mode (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_row FROM public.maintenance_mode WHERE id FOR UPDATE;

  v_previous := jsonb_build_object('enabled', v_row.enabled, 'message', v_row.message, 'expected_end_at', v_row.expected_end_at);
  v_next := jsonb_build_object('enabled', p_enabled, 'message', v_message, 'expected_end_at', p_expected_end_at);

  UPDATE public.maintenance_mode
  SET enabled = p_enabled,
      message = v_message,
      expected_end_at = p_expected_end_at,
      changed_at = now(),
      changed_by = p_performed_by
  WHERE id;

  INSERT INTO public.audit_log (table_name, operation, user_id, performed_by, old_values, new_values)
  VALUES ('maintenance_mode', 'UPDATE', p_performed_by, p_performed_by, v_previous, coalesce(p_details, '{}'::jsonb) || v_next);

  RETURN v_previous;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_maintenance_mode(boolean, text, timestamptz, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_maintenance_mode(boolean, text, timestamptz, uuid, jsonb) TO service_role;
