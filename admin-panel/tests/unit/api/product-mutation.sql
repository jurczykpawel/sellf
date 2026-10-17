CREATE FUNCTION pg_temp.reject_product_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.table_name = 'products' THEN RAISE EXCEPTION 'audit unavailable'; END IF;
  RETURN NEW;
END;
$$;

SET LOCAL ROLE service_role;

DO $$
DECLARE
  actor uuid := (SELECT user_id FROM public.admin_users LIMIT 1);
  product public.products;
  changed public.products;
  audit public.audit_log;
  mutation_operation text;
  audit_count bigint;
BEGIN
  ASSERT actor IS NOT NULL, 'test requires a seeded admin';
  ASSERT NOT has_function_privilege('anon', 'public.mutate_product_with_audit(text,jsonb,uuid,uuid)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.mutate_product_with_audit(text,jsonb,uuid,uuid)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.mutate_product_with_audit(text,jsonb,uuid,uuid)', 'EXECUTE');
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT * INTO product FROM public.mutate_product_with_audit('INSERT', jsonb_build_object(
    'name', 'Audit course', 'slug', 'audit-' || gen_random_uuid(), 'price', 49, 'seller_id', actor
  ), NULL, actor);
  ASSERT product.id IS NOT NULL AND product.created_at IS NOT NULL AND product.is_listed;
  SELECT * INTO audit FROM public.audit_log WHERE new_values->>'id' = product.id::text AND operation = 'INSERT';
  ASSERT audit.user_id = actor AND audit.performed_by = actor AND audit.old_values IS NULL;
  ASSERT audit.new_values = to_jsonb(product);

  SELECT * INTO changed FROM public.mutate_product_with_audit('UPDATE', '{"name":"New course","description":null}', product.id, actor);
  SELECT * INTO audit FROM public.audit_log WHERE new_values->>'id' = product.id::text AND operation = 'UPDATE';
  ASSERT audit.old_values = to_jsonb(product) AND audit.new_values = to_jsonb(changed);
  ASSERT changed.name = 'New course' AND changed.description IS NULL AND changed.price = product.price;
  PERFORM public.mutate_product_with_audit('DELETE', '{}', product.id, actor);
  SELECT * INTO audit FROM public.audit_log WHERE old_values->>'id' = product.id::text AND operation = 'DELETE';
  ASSERT audit.old_values = to_jsonb(changed) AND audit.new_values IS NULL;
  ASSERT NOT EXISTS (SELECT FROM public.products WHERE id = product.id);
  ASSERT (SELECT count(*) = 3 FROM public.audit_log
    WHERE coalesce(new_values->>'id', old_values->>'id') = product.id::text);

  BEGIN
    PERFORM public.mutate_product_with_audit('INSERT', '{}', NULL, gen_random_uuid());
    RAISE EXCEPTION 'expected actor error';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT * INTO product FROM public.mutate_product_with_audit('INSERT', jsonb_build_object(
    'name', 'Rollback course', 'slug', 'rollback-' || gen_random_uuid(), 'price', 19
  ), NULL, actor);
  SELECT count(*) INTO audit_count FROM public.audit_log;
  BEGIN
    PERFORM public.mutate_product_with_audit('INSERT', jsonb_build_object(
      'name', 'Duplicate', 'slug', product.slug, 'price', 19
    ), NULL, actor);
    RAISE EXCEPTION 'expected duplicate error';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.mutate_product_with_audit('UPDATE', '{"name":"Missing"}', gen_random_uuid(), actor);
    RAISE EXCEPTION 'expected missing product error';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.mutate_product_with_audit('UPDATE', '{"id":null}', product.id, actor);
    RAISE EXCEPTION 'expected field error';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.mutate_product_with_audit('DELETE', '{}', product.id, actor);
    RAISE EXCEPTION 'expected role error';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  ASSERT (SELECT count(*) = audit_count FROM public.audit_log);
  CREATE TRIGGER reject_product_audit BEFORE INSERT ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_product_audit();
  FOREACH mutation_operation IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
    BEGIN
      PERFORM public.mutate_product_with_audit(mutation_operation, jsonb_build_object(
        'name', 'Changed', 'slug', 'failure-' || product.id, 'price', 29
      ), product.id, actor);
      RAISE EXCEPTION 'expected audit error';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'audit unavailable' THEN RAISE; END IF;
    END;
    ASSERT (SELECT to_jsonb(p) = to_jsonb(product) FROM public.products p WHERE id = product.id);
    ASSERT NOT EXISTS (SELECT FROM public.products WHERE slug = 'failure-' || product.id);
    ASSERT (SELECT count(*) = audit_count FROM public.audit_log);
  END LOOP;
END;
$$;
