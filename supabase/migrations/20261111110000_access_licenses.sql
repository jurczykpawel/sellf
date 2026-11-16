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

-- ===== W256d: license issued by the seller + its audit entry in ONE transaction =====
-- Manual and API v1 issuance (src/lib/license-keys/request.ts). The issued_licenses insert fires
-- capture_license_issued_event, which queues license.issued — its webhook payload carries the key.
-- With the audit entry written afterwards in a separate request, a refused entry left a committed
-- license and a queued event (W256cr P1). Here the license row, the event (trigger, same statement)
-- and the audit_log row commit together; when the audit insert fails, none of them exists.
-- 23505 (same order_id + product_id) propagates unchanged so the caller can return the winner.
CREATE FUNCTION public.issue_license_with_audit(p_license jsonb, p_performed_by uuid, p_audit_values jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.issued_licenses; v public.issued_licenses;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_performed_by IS NULL OR jsonb_typeof(p_license) IS DISTINCT FROM 'object'
     OR (p_audit_values IS NOT NULL AND jsonb_typeof(p_audit_values) <> 'object') THEN
    RAISE EXCEPTION 'Invalid license issuance' USING ERRCODE='22023';
  END IF;
  r := jsonb_populate_record(NULL::public.issued_licenses, p_license);
  INSERT INTO public.issued_licenses(id, seller_id, original_seller_id, product_id, email, user_id, order_id, access_grant_id,
      customer_locale, kid, license_key, expires_at, issuance_source, license_domain)
    VALUES(coalesce(r.id, gen_random_uuid()), r.seller_id, r.original_seller_id, r.product_id, r.email, r.user_id, r.order_id,
      r.access_grant_id, r.customer_locale, r.kid, r.license_key, r.expires_at, coalesce(r.issuance_source, 'purchase'), r.license_domain)
    RETURNING * INTO v;
  INSERT INTO public.audit_log(table_name, operation, performed_by, new_values)
    VALUES('issued_licenses', 'INSERT', p_performed_by, coalesce(p_audit_values, '{}'::jsonb)
      || CASE WHEN v.access_grant_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('access_grant_id', v.access_grant_id) END
      || jsonb_build_object('license_id', v.id, 'product_id', v.product_id, 'email', v.email, 'domain', v.license_domain, 'kid', v.kid));
  RETURN v.id;
END $$;
REVOKE ALL ON FUNCTION public.issue_license_with_audit(jsonb, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_license_with_audit(jsonb, uuid, jsonb) TO service_role;

-- ===== W256d: admin access grant/update/revoke + its audit entry in ONE transaction =====
-- Replaces "audit entry first, change, take the entry back on error" in api/users/[id]/access: a
-- process killed between the two requests left an entry for a change that never happened (W256cr P2).
-- The entry is written only when a row actually changed; performed_by references auth.users, so the
-- actor must be a user (the admin's auth UUID). p_audit is stored as new_values (grant/update) or
-- old_values (revoke), as before.
CREATE FUNCTION public.mutate_access_audited(p_action text, p_user_id uuid, p_product_id uuid DEFAULT NULL, p_access_id uuid DEFAULT NULL,
  p_values jsonb DEFAULT '{}', p_actor jsonb DEFAULT '{}', p_audit jsonb DEFAULT '{}')
RETURNS SETOF public.user_product_access LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE a public.user_product_access; changed integer := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_actor->>'type' IS DISTINCT FROM 'user' OR p_actor->>'id' IS NULL
     OR (p_audit IS NOT NULL AND jsonb_typeof(p_audit) <> 'object') THEN
    RAISE EXCEPTION 'Audited access change needs a user actor' USING ERRCODE='22023';
  END IF;
  FOR a IN SELECT * FROM public.mutate_access(p_action, p_user_id, p_product_id, p_access_id, p_values, p_actor) LOOP
    changed := changed + 1;
    RETURN NEXT a;
  END LOOP;
  IF changed > 0 THEN
    INSERT INTO public.audit_log(table_name, operation, user_id, performed_by, old_values, new_values)
      VALUES('user_product_access',
        CASE p_action WHEN 'grant' THEN 'INSERT' WHEN 'revoke' THEN 'DELETE' ELSE 'UPDATE' END,
        p_user_id, (p_actor->>'id')::uuid,
        CASE WHEN p_action = 'revoke' THEN coalesce(p_audit, '{}'::jsonb) END,
        CASE WHEN p_action <> 'revoke' THEN coalesce(p_audit, '{}'::jsonb) END);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.mutate_access_audited(text,uuid,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_access_audited(text,uuid,uuid,uuid,jsonb,jsonb,jsonb) TO service_role;
