-- Direct event links follow the product sale window independently of catalogue listing.
CREATE OR REPLACE FUNCTION public.public_event_availability(p_product_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.products WHERE id=p_product_id AND event_mode AND is_active
  AND (available_from IS NULL OR available_from<=statement_timestamp())
  AND (available_until IS NULL OR available_until>statement_timestamp()))
  THEN public.event_availability(p_product_id) ELSE '[]'::jsonb END;
$$;
REVOKE ALL ON FUNCTION public.public_event_availability(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_event_availability(uuid) TO service_role;
