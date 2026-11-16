-- The shop setting "collect a different invoice recipient" and its audit entry
-- are saved in ONE transaction. The shop_config row is locked, only the one key in custom_settings is
-- changed (jsonb_set — other keys and parallel changes of other settings stay), and the audit_log
-- insert runs in the same statement: when it fails (e.g. performed_by is not an auth user) nothing is
-- saved and the caller gets the error. Shared by the panel action and PATCH /api/v1/settings/checkout.
--
-- @see admin-panel/src/lib/checkout/invoice-recipient-setting.ts

CREATE FUNCTION public.set_invoice_recipient_enabled(
  p_enabled BOOLEAN,
  p_performed_by UUID,
  p_details JSONB DEFAULT '{}'::jsonb
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.shop_config;
  v_previous BOOLEAN;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL OR p_performed_by IS NULL
     OR (p_details IS NOT NULL AND jsonb_typeof(p_details) <> 'object') THEN
    RAISE EXCEPTION 'Invalid setting change' USING ERRCODE = '22023';
  END IF;

  -- Fresh install: create the singleton row (shop_config_singleton_idx) without racing another call.
  INSERT INTO public.shop_config DEFAULT VALUES ON CONFLICT DO NOTHING;
  SELECT * INTO v_row FROM public.shop_config LIMIT 1 FOR UPDATE;

  v_previous := coalesce(v_row.custom_settings -> 'invoice_recipient_enabled' = 'true'::jsonb, false);

  UPDATE public.shop_config
  SET custom_settings = jsonb_set(
        CASE WHEN jsonb_typeof(custom_settings) = 'object' THEN custom_settings ELSE '{}'::jsonb END,
        '{invoice_recipient_enabled}', to_jsonb(p_enabled), true),
      updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.audit_log (table_name, operation, user_id, performed_by, old_values, new_values)
  VALUES (
    'shop_config', 'UPDATE', p_performed_by, p_performed_by,
    jsonb_build_object('invoice_recipient_enabled', v_previous),
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('invoice_recipient_enabled', p_enabled)
  );

  RETURN v_previous;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_invoice_recipient_enabled(BOOLEAN, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_invoice_recipient_enabled(BOOLEAN, UUID, JSONB) TO service_role;
