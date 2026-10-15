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
