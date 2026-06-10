ALTER TABLE public.webhook_logs ADD COLUMN IF NOT EXISTS delivery_key TEXT;
-- One first-attempt row per logical delivery; retries update in place, and the
-- legacy manual retry leaves delivery_key NULL, so a partial unique index is safe.
CREATE UNIQUE INDEX IF NOT EXISTS webhook_logs_delivery_key_uniq
  ON public.webhook_logs (delivery_key) WHERE delivery_key IS NOT NULL;
