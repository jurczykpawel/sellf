-- Per-template credentials, independent of presentation snapshots.
CREATE TABLE public.template_credentials (
  template_id text PRIMARY KEY CHECK (template_id IN ('storefront-a','storefront-b','storefront-c')),
  encrypted_key text,
  encryption_iv text,
  encryption_tag text,
  state text NOT NULL DEFAULT 'missing' CHECK (state IN ('valid','missing','expired','revoked','invalid','unknown')),
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT template_credentials_value CHECK (
    (state='missing' AND encrypted_key IS NULL AND encryption_iv IS NULL AND encryption_tag IS NULL AND verified_at IS NULL) OR
    (state<>'missing' AND encrypted_key IS NOT NULL AND encryption_iv IS NOT NULL AND encryption_tag IS NOT NULL AND
      length(encrypted_key) BETWEEN 4 AND 21848 AND encrypted_key ~ '^[A-Za-z0-9+/]+={0,2}$' AND
      octet_length(decode(encrypted_key,'base64')) BETWEEN 1 AND 16384 AND
      length(encryption_iv)=24 AND octet_length(decode(encryption_iv,'base64'))=16 AND
      length(encryption_tag)=24 AND octet_length(decode(encryption_tag,'base64'))=16)
  ),
  CONSTRAINT template_credentials_verification CHECK (state<>'valid' OR verified_at IS NOT NULL)
);
ALTER TABLE public.template_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.template_credentials FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.template_credentials TO service_role;
CREATE POLICY template_credentials_service_read ON public.template_credentials FOR SELECT TO service_role
  USING ((SELECT auth.role())='service_role');

CREATE FUNCTION public.save_template_credential(template_id text, encrypted_key text, encryption_iv text, encryption_tag text,
  actor_user_id uuid DEFAULT NULL, actor_method text DEFAULT NULL, actor_api_key_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner_id uuid; key_record public.api_keys%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
  SELECT id INTO owner_id FROM public.admin_users WHERE user_id=actor_user_id FOR SHARE;
  IF owner_id IS NULL OR actor_method IS NULL OR actor_method NOT IN ('session','api_key') OR
    (actor_method='session' AND actor_api_key_id IS NOT NULL) THEN
    RETURN jsonb_build_object('success',false,'code','FORBIDDEN');
  END IF;
  IF actor_method='api_key' THEN
    SELECT * INTO key_record FROM public.api_keys WHERE id=actor_api_key_id FOR SHARE;
    IF NOT FOUND OR key_record.admin_user_id IS DISTINCT FROM owner_id OR key_record.revoked_at IS NOT NULL OR
      (NOT key_record.is_active AND (key_record.rotation_grace_until IS NULL OR key_record.rotation_grace_until<=clock_timestamp())) OR
      (key_record.expires_at IS NOT NULL AND key_record.expires_at<=clock_timestamp()) OR
      NOT (key_record.scopes @> '["templates:write"]'::jsonb) THEN
      RETURN jsonb_build_object('success',false,'code','FORBIDDEN');
    END IF;
  END IF;
  IF template_id IS NULL OR template_id NOT IN ('storefront-a','storefront-b','storefront-c') OR
    encrypted_key IS NULL OR encryption_iv IS NULL OR encryption_tag IS NULL THEN
    RETURN jsonb_build_object('success',false,'code','INVALID');
  END IF;
  INSERT INTO public.template_credentials AS stored(template_id,encrypted_key,encryption_iv,encryption_tag,state,verified_at)
    VALUES(template_id,encrypted_key,encryption_iv,encryption_tag,'unknown',NULL)
    ON CONFLICT ON CONSTRAINT template_credentials_pkey DO UPDATE SET encrypted_key=EXCLUDED.encrypted_key,
      encryption_iv=EXCLUDED.encryption_iv,encryption_tag=EXCLUDED.encryption_tag,state='unknown',verified_at=NULL,updated_at=clock_timestamp();
  INSERT INTO public.audit_log(table_name,operation,user_id,performed_by,new_values)
    VALUES('template_credentials','UPDATE',actor_user_id,actor_user_id,jsonb_build_object(
      'templateId',template_id,'state','unknown','scope','templates:write','actor_method',actor_method,'actor_api_key_id',actor_api_key_id));
  RETURN jsonb_build_object('success',true,'status',jsonb_build_object('templateId',template_id,'state','unknown','verifiedAt',NULL));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success',false,'code','UNAVAILABLE');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_template_credential(text,text,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_template_credential(text,text,text,text,uuid,text,uuid) TO service_role;
