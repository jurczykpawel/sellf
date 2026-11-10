-- Company lookup is configured by the shop, independently of product profiles.
UPDATE public.products AS product
SET checkout_profile = jsonb_set(product.checkout_profile, '{modules}', (
  SELECT jsonb_agg(CASE WHEN module->>'id' = 'buyer' THEN module - 'gus' ELSE module END ORDER BY position)
  FROM jsonb_array_elements(product.checkout_profile->'modules') WITH ORDINALITY AS entries(module, position)
))
WHERE jsonb_typeof(product.checkout_profile->'modules') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(product.checkout_profile->'modules') AS module
    WHERE module->>'id' = 'buyer' AND module ? 'gus'
  );
