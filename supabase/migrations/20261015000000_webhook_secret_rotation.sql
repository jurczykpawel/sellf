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
