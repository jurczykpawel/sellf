-- New webhook endpoints get a Stripe-style `whsec_` prefix so the UI mask
-- and the visible secret share a recognizable shape. Existing rows are NOT
-- backfilled — rotating their secrets would break already-deployed handlers.
ALTER TABLE seller_main.webhook_endpoints
  ALTER COLUMN secret SET DEFAULT 'whsec_' || replace(gen_random_uuid()::text, '-', '');
