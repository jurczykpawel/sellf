/**
 * Remove custom scripts from public integrations config RPC.
 *
 * Custom scripts (dangerouslySetInnerHTML) are disabled in favour of managed
 * integrations (GTM, Facebook Pixel, Umami) which accept only validated IDs.
 * This prevents arbitrary JS injection by seller_admin users in marketplace mode.
 *
 * The custom_scripts table is retained (data preserved), but scripts are no
 * longer exposed through the public RPC or rendered by TrackingProvider.
 */

-- Update seller_main function to stop returning scripts
CREATE OR REPLACE FUNCTION seller_main.get_public_integrations_config()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  config_record RECORD;
BEGIN
  SELECT * INTO config_record FROM seller_main.integrations_config WHERE id = 1;

  RETURN jsonb_build_object(
    'gtm_container_id', config_record.gtm_container_id,
    'gtm_server_container_url', config_record.gtm_server_container_url,
    'facebook_pixel_id', config_record.facebook_pixel_id,
    'fb_capi_enabled', COALESCE(config_record.fb_capi_enabled, false),
    'send_conversions_without_consent', COALESCE(config_record.send_conversions_without_consent, false),
    'umami_website_id', config_record.umami_website_id,
    'umami_script_url', config_record.umami_script_url,
    'cookie_consent_enabled', config_record.cookie_consent_enabled,
    'consent_logging_enabled', config_record.consent_logging_enabled
  );
END;
$$;

GRANT EXECUTE ON FUNCTION seller_main.get_public_integrations_config() TO anon, authenticated, service_role;
