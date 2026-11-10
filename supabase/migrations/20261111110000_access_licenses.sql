-- Licenses issued by an individual manual access grant.
ALTER TABLE public.user_product_access ADD COLUMN license_requested boolean NOT NULL DEFAULT false;
ALTER TABLE public.issued_licenses
  ADD COLUMN access_grant_id uuid UNIQUE;

CREATE FUNCTION public.bind_access_license() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE a public.user_product_access;
BEGIN
  IF NEW.access_grant_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO a FROM public.user_product_access WHERE id = NEW.access_grant_id FOR UPDATE;
  IF NOT FOUND OR NOT a.license_requested OR a.user_id IS DISTINCT FROM NEW.user_id
    OR a.product_id IS DISTINCT FROM NEW.product_id OR NEW.order_id <> 'access_' || a.id::text THEN
    RAISE EXCEPTION 'Access grant is not available for license issuance';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bind_access_license() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER bind_access_license BEFORE INSERT ON public.issued_licenses
FOR EACH ROW EXECUTE FUNCTION public.bind_access_license();

CREATE OR REPLACE FUNCTION public.mutate_access(p_action text, p_user_id uuid, p_product_id uuid DEFAULT NULL, p_access_id uuid DEFAULT NULL, p_values jsonb DEFAULT '{}', p_actor jsonb DEFAULT '{}')
RETURNS SETOF public.user_product_access LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE previous text := current_setting('sellf.grant_source', true); a public.user_product_access;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  PERFORM set_config('sellf.grant_source', 'manual', true);
  IF p_action = 'revoke' THEN
    FOR a IN SELECT * FROM public.user_product_access WHERE user_id = p_user_id
      AND (id = p_access_id OR (p_access_id IS NULL AND product_id = p_product_id)) FOR UPDATE LOOP
      IF coalesce((p_values->>'revoke_license')::boolean, false) THEN
        PERFORM public.revoke_order_licenses(a.product_id, ARRAY['access_' || a.id::text], 'manual');
      END IF;
    END LOOP;
  END IF;
  FOR a IN SELECT * FROM public.mutate_access_impl(p_action, p_user_id, p_product_id, p_access_id, p_values, p_actor) LOOP
    IF p_action = 'grant' AND coalesce((p_values->>'issue_license')::boolean, false) THEN
      UPDATE public.user_product_access SET license_requested = true WHERE id = a.id RETURNING * INTO a;
    END IF;
    RETURN NEXT a;
  END LOOP;
  PERFORM set_config('sellf.grant_source', coalesce(previous, ''), true);
END $$;
REVOKE ALL ON FUNCTION public.mutate_access(text,uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_access(text,uuid,uuid,uuid,jsonb,jsonb) TO service_role;
