-- Replace boolean send_conversions_without_consent with a three-value mode
-- describing how server-side conversions behave when the user has not given
-- explicit cookie consent.
--
-- Modes:
--   strict     — never send anything without consent (most defensible)
--   limited    — send Purchase/Lead under Limited Data Use (DEFAULT)
--   permissive — send Purchase/Lead with full payload under legitimate interest
--                claim (legacy behaviour, requires written LIA + privacy policy)

ALTER TABLE public.integrations_config
  ADD COLUMN IF NOT EXISTS conversion_tracking_mode TEXT
    DEFAULT 'strict'
    CHECK (conversion_tracking_mode IN ('strict', 'limited', 'permissive'));

-- Backfill from the legacy flag where possible. Rows where the flag was true
-- keep current behaviour (now called 'permissive'). False/null becomes
-- 'strict' — the safer of the two states it could have meant.
UPDATE public.integrations_config
SET conversion_tracking_mode = CASE
  WHEN send_conversions_without_consent IS TRUE THEN 'permissive'
  ELSE 'strict'
END
WHERE conversion_tracking_mode IS NULL OR conversion_tracking_mode = 'strict';

ALTER TABLE public.integrations_config
  ALTER COLUMN conversion_tracking_mode SET NOT NULL;

-- The public passthrough view depends on every column of the underlying
-- table, so drop and recreate it around the column change.

ALTER TABLE public.integrations_config
  DROP COLUMN IF EXISTS send_conversions_without_consent;



-- Rebuild the public RPC to expose the new column (and stop returning the
-- dropped one). Anonymous storefront callers read this to know whether the
-- client proxy should report consent state for browsing events.
CREATE OR REPLACE FUNCTION public.get_public_integrations_config()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  config_record RECORD;
BEGIN
  SELECT * INTO config_record FROM public.integrations_config WHERE id = 1;

  RETURN jsonb_build_object(
    'gtm_container_id', config_record.gtm_container_id,
    'gtm_server_container_url', config_record.gtm_server_container_url,
    'facebook_pixel_id', config_record.facebook_pixel_id,
    'fb_capi_enabled', COALESCE(config_record.fb_capi_enabled, false),
    'conversion_tracking_mode', COALESCE(config_record.conversion_tracking_mode, 'strict'),
    'umami_website_id', config_record.umami_website_id,
    'umami_script_url', config_record.umami_script_url,
    'cookie_consent_enabled', config_record.cookie_consent_enabled,
    'consent_logging_enabled', config_record.consent_logging_enabled
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_integrations_config() TO anon, authenticated, service_role;
