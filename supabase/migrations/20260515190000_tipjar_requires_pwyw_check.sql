SET client_min_messages = warning;

ALTER TABLE seller_main.products
  DROP CONSTRAINT IF EXISTS products_tipjar_requires_pwyw;

ALTER TABLE seller_main.products
  ADD CONSTRAINT products_tipjar_requires_pwyw
  CHECK (checkout_template <> 'tip-jar' OR allow_custom_price = true);
