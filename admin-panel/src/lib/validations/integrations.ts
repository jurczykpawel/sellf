/**
 * Integrations validation utilities
 * Pure TypeScript validation
 */

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string[]>;
}

export interface IntegrationsInput {
  gtm_container_id?: string | null;
  gtm_server_container_url?: string | null;
  gtm_ss_enabled?: boolean;
  google_ads_conversion_id?: string | null;
  google_ads_conversion_label?: string | null;
  facebook_pixel_id?: string | null;
  facebook_capi_token?: string | null;
  facebook_test_event_code?: string | null;
  fb_capi_enabled?: boolean;
  send_conversions_without_consent?: boolean;
  umami_website_id?: string | null;
  umami_script_url?: string | null;
  cookie_consent_enabled?: boolean;
  consent_logging_enabled?: boolean;
  sellf_license?: string | null;
}

export function validateIntegrations(data: IntegrationsInput): ValidationResult {
  const errors: Record<string, string[]> = {};

  const addError = (field: string, message: string) => {
    if (!errors[field]) errors[field] = [];
    errors[field].push(message);
  };

  // GTM ID validation
  if (data.gtm_container_id && !/^GTM-[A-Z0-9]+$/.test(data.gtm_container_id)) {
    addError('gtm_container_id', 'Invalid GTM Container ID format');
  }

  // GTM Server Container URL validation
  if (data.gtm_server_container_url && !/^https:\/\/.+/.test(data.gtm_server_container_url)) {
    addError('gtm_server_container_url', 'GTM Server URL must be a valid HTTPS URL');
  }

  // Umami validation
  if (data.umami_website_id && !/^[0-9a-fA-F-]{36}$/.test(data.umami_website_id)) {
    addError('umami_website_id', 'Invalid Website ID (must be a UUID)');
  }

  if (data.umami_script_url && !/^https?:\/\/.+/.test(data.umami_script_url)) {
    addError('umami_script_url', 'Invalid Script URL');
  }

  // Google Ads ID
  if (data.google_ads_conversion_id && !/^AW-[0-9]+$/.test(data.google_ads_conversion_id)) {
    addError('google_ads_conversion_id', 'Invalid Google Ads ID format');
  }

  // FB Pixel
  if (data.facebook_pixel_id && !/^[0-9]+$/.test(data.facebook_pixel_id)) {
    addError('facebook_pixel_id', 'Facebook Pixel ID must be numeric');
  }

  // Sellf License format: SF-{domain}-{TIER}-{expiry}-{signature} or legacy SF-{domain}-{expiry}-{signature}
  if (data.sellf_license && !/^SF-[a-zA-Z0-9.*-]+-(?:(?:REG|PRO|BIZ|MKT)-)?(?:UNLIMITED|\d{8})-[A-Za-z0-9_-]+$/.test(data.sellf_license)) {
    addError('sellf_license', 'Invalid license format (expected: SF-domain-TIER-expiry-signature)');
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}