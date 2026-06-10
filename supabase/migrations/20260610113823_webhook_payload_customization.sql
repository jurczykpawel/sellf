-- Optional per-endpoint payload shaping. NULL on every existing row preserves
-- today's exact webhook behavior. Columns inherit the table's existing RLS.
ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS custom_headers_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS custom_payload_fields    JSONB,
  ADD COLUMN IF NOT EXISTS payload_field_selection  JSONB;

COMMENT ON COLUMN public.webhook_endpoints.custom_headers_encrypted IS
  'Encrypted JSON map of extra request headers (e.g. Authorization). Decrypted service-role only at send time.';
COMMENT ON COLUMN public.webhook_endpoints.custom_payload_fields IS
  'Extra top-level body fields; string leaves may contain {{placeholder}} tokens.';
COMMENT ON COLUMN public.webhook_endpoints.payload_field_selection IS
  'Whitelist (string[]) of standard data.* keys to include; NULL = all.';
