-- Atomic product offer lifecycle. @see supabase/tests/product-offer-lifecycle.sql
CREATE FUNCTION public.mutate_product_offer(offer_product_id uuid, expected_revision bigint, operation text, validated_config jsonb,
 restored_from bigint DEFAULT NULL, actor_user_id uuid DEFAULT NULL, actor_method text DEFAULT NULL, actor_api_key_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 current_config public.product_offer_config%ROWTYPE;
 owner_id uuid; key_record public.api_keys%ROWTYPE; required_scope text;
 next_draft jsonb; next_published jsonb; candidate jsonb; product_public boolean;
BEGIN
 IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
 SELECT id INTO owner_id FROM public.admin_users WHERE user_id=actor_user_id FOR SHARE;
 IF owner_id IS NULL OR actor_method IS NULL OR actor_method NOT IN ('session','api_key') OR
   (actor_method='session' AND actor_api_key_id IS NOT NULL) THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
 required_scope := CASE WHEN operation IN ('publish','rollback') THEN 'templates:activate' ELSE 'templates:write' END;
 IF actor_method='api_key' THEN
   SELECT * INTO key_record FROM public.api_keys WHERE id=actor_api_key_id FOR SHARE;
   IF NOT FOUND OR key_record.admin_user_id IS DISTINCT FROM owner_id OR key_record.revoked_at IS NOT NULL OR
     (NOT key_record.is_active AND (key_record.rotation_grace_until IS NULL OR key_record.rotation_grace_until <= clock_timestamp())) OR
     (key_record.expires_at IS NOT NULL AND key_record.expires_at <= clock_timestamp()) OR
     NOT (key_record.scopes @> jsonb_build_array(required_scope)) THEN RETURN jsonb_build_object('success',false,'code','FORBIDDEN'); END IF;
 END IF;
 IF expected_revision IS NULL OR expected_revision NOT BETWEEN 0 AND 9007199254740991 OR
   (restored_from IS NOT NULL AND restored_from NOT BETWEEN 0 AND 9007199254740991) THEN RETURN jsonb_build_object('success',false,'code','LIMIT'); END IF;
 IF operation IS NULL OR operation NOT IN ('draft','reset','publish','rollback') OR (operation<>'rollback' AND restored_from IS NOT NULL) THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
 -- The canonical product also serializes concurrent first edits and deletion.
 SELECT is_active AND is_listed INTO product_public FROM public.products WHERE id=offer_product_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND'); END IF;
 SELECT * INTO current_config FROM public.product_offer_config WHERE product_id=offer_product_id FOR UPDATE;
 IF NOT FOUND THEN current_config.revision := 0; END IF;
 IF expected_revision <> current_config.revision THEN RETURN jsonb_build_object('success',false,'code','CONFLICT','currentRevision',current_config.revision); END IF;
 IF current_config.revision=9007199254740991 THEN RETURN jsonb_build_object('success',false,'code','LIMIT'); END IF;
 next_draft := current_config.draft; next_published := current_config.published;
 IF operation IN ('draft','reset') THEN
   IF validated_config IS NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
   next_draft := validated_config; candidate := validated_config;
 ELSIF operation='publish' THEN
   IF validated_config IS NOT NULL OR current_config.draft IS NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
   next_published := current_config.draft; next_draft := NULL; candidate := next_published;
 ELSE
   IF validated_config IS NOT NULL OR restored_from IS NULL THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
   SELECT h.published INTO next_published FROM public.product_offer_history h WHERE h.product_id=offer_product_id AND h.revision=mutate_product_offer.restored_from;
   IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'code','NOT_FOUND'); END IF;
   next_draft := NULL; candidate := next_published;
 END IF;
 IF public.storefront_config_stored_bytes(candidate)>102400 OR public.storefront_config_stored_bytes(next_published)>102400 THEN RETURN jsonb_build_object('success',false,'code','LIMIT'); END IF;
 IF (candidate IS NOT NULL AND public.product_offer_config_valid(candidate) IS DISTINCT FROM true) OR
    (next_published IS NOT NULL AND public.product_offer_config_valid(next_published) IS DISTINCT FROM true) THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
 IF operation IN ('publish','rollback') AND candidate->>'enabled'='true' AND product_public IS DISTINCT FROM true THEN RETURN jsonb_build_object('success',false,'code','INVALID'); END IF;
 IF current_config.product_id IS NULL THEN
   INSERT INTO public.product_offer_config(product_id) VALUES(offer_product_id);
   INSERT INTO public.product_offer_history(product_id,revision,operation,actor_id) VALUES(offer_product_id,0,'draft',actor_user_id);
 END IF;
 UPDATE public.product_offer_config SET revision=current_config.revision+1,draft=next_draft,published=next_published,updated_at=clock_timestamp(),updated_by=actor_user_id WHERE product_id=offer_product_id;
 INSERT INTO public.product_offer_history(product_id,revision,operation,draft,published,actor_id,restored_from)
 VALUES(offer_product_id,current_config.revision+1,operation,next_draft,next_published,actor_user_id,restored_from);
 INSERT INTO public.audit_log(table_name,operation,user_id,performed_by,new_values)
 VALUES('product_offer_config','UPDATE',actor_user_id,actor_user_id,jsonb_build_object('productId',offer_product_id,'revision',current_config.revision+1,'action',operation,'scope',required_scope,'actor_method',actor_method,'actor_api_key_id',actor_api_key_id));
 RETURN jsonb_build_object('success',true,'revision',current_config.revision+1);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'code','UNAVAILABLE');
END; $$;
REVOKE EXECUTE ON FUNCTION public.mutate_product_offer(uuid,bigint,text,jsonb,bigint,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_product_offer(uuid,bigint,text,jsonb,bigint,uuid,text,uuid) TO service_role;
