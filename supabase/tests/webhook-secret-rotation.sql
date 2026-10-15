-- Run after the rotation migration in the same BEGIN ... ROLLBACK transaction.
SET LOCAL ROLE service_role;
DO $$
DECLARE
  actor uuid;
  endpoint uuid;
  stored text := 'enc:v1:{"encrypted_key":"fixture","encryption_iv":"fixture","encryption_tag":"fixture"}';
  audit_count int;
BEGIN
  SELECT user_id INTO STRICT actor FROM public.admin_users LIMIT 1;
  INSERT INTO public.webhook_endpoints (url, events, secret, description)
    VALUES ('https://rotation.example.com/webhook', ARRAY['purchase.completed'], 'whsec_before', 'Rotation verification')
    RETURNING id INTO endpoint;

  IF has_function_privilege('anon', 'public.rotate_webhook_secret(uuid,text,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.rotate_webhook_secret(uuid,text,uuid,uuid)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.rotate_webhook_secret(uuid,text,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected function permissions';
  END IF;

  BEGIN
    PERFORM public.rotate_webhook_secret(endpoint, stored, gen_random_uuid());
    RAISE EXCEPTION 'Expected admin validation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Admin required' THEN RAISE; END IF;
  END;

  IF NOT public.rotate_webhook_secret(endpoint, stored, actor) THEN
    RAISE EXCEPTION 'Expected rotation';
  END IF;
  IF (SELECT secret FROM public.webhook_endpoints WHERE id = endpoint) <> stored THEN
    RAISE EXCEPTION 'Expected replacement';
  END IF;
  SELECT count(*) INTO audit_count FROM public.audit_log
    WHERE table_name = 'webhook_endpoints' AND performed_by = actor
      AND new_values = jsonb_build_object('id', endpoint, 'action', 'secret_rotated', 'api_key_id', NULL)
      AND old_values IS NULL;
  IF audit_count <> 1 THEN RAISE EXCEPTION 'Expected one audit entry'; END IF;
  IF public.rotate_webhook_secret(gen_random_uuid(), stored, actor) THEN
    RAISE EXCEPTION 'Expected missing endpoint';
  END IF;
END;
$$;

RESET ROLE;

CREATE FUNCTION pg_temp.reject_rotation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.new_values->>'action' = 'secret_rotated' THEN
    RAISE EXCEPTION 'Audit unavailable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER test_rotation_audit BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_rotation_audit();

DO $$
DECLARE
  actor uuid;
  endpoint uuid;
BEGIN
  SELECT user_id INTO STRICT actor FROM public.admin_users LIMIT 1;
  INSERT INTO public.webhook_endpoints (url, secret)
    VALUES ('https://rotation.example.com/rollback', 'whsec_unchanged') RETURNING id INTO endpoint;
  BEGIN
    PERFORM public.rotate_webhook_secret(endpoint, 'enc:v1:fixture', actor);
    RAISE EXCEPTION 'Expected audit failure';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Audit unavailable' THEN RAISE; END IF;
  END;
  IF (SELECT secret FROM public.webhook_endpoints WHERE id = endpoint) <> 'whsec_unchanged' THEN
    RAISE EXCEPTION 'Expected unchanged secret';
  END IF;
END;
$$;
