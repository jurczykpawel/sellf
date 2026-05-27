import { test, expect } from '@playwright/test';
import { validateIntegrations } from '../src/lib/validations/integrations';

test.describe('Integrations Validation Logic', () => {

  test('should accept valid GTM ID', () => {
    const result = validateIntegrations({
      gtm_container_id: 'GTM-ABC123'
    });
    expect(result.isValid).toBe(true);
  });

  test('should reject invalid GTM ID', () => {
    const result = validateIntegrations({
      gtm_container_id: 'INVALID-ID'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.gtm_container_id).toContain('Invalid GTM Container ID format');
  });

  test('should accept valid FB Pixel ID', () => {
    const result = validateIntegrations({
      facebook_pixel_id: '1234567890'
    });
    expect(result.isValid).toBe(true);
  });

  test('should reject non-numeric FB Pixel ID', () => {
    const result = validateIntegrations({
      facebook_pixel_id: 'ABC123'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.facebook_pixel_id).toContain('Facebook Pixel ID must be numeric');
  });

  test('should accept valid GTM Server Container HTTPS URL', () => {
    const result = validateIntegrations({
      gtm_server_container_url: 'https://gtm.example.com'
    });
    expect(result.isValid).toBe(true);
  });

  test('should accept GTM Server Container URL with path', () => {
    const result = validateIntegrations({
      gtm_server_container_url: 'https://gtm.example.com/gtm'
    });
    expect(result.isValid).toBe(true);
  });

  test('should reject HTTP GTM Server Container URL', () => {
    const result = validateIntegrations({
      gtm_server_container_url: 'http://gtm.example.com'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.gtm_server_container_url).toContain('GTM Server URL must be a valid HTTPS URL');
  });

  test('should reject invalid GTM Server Container URL format', () => {
    const result = validateIntegrations({
      gtm_server_container_url: 'not-a-valid-url'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.gtm_server_container_url).toBeDefined();
  });

  test('should accept empty GTM Server Container URL', () => {
    const result = validateIntegrations({
      gtm_server_container_url: ''
    });
    expect(result.isValid).toBe(true);
  });

  test('should accept null GTM Server Container URL', () => {
    const result = validateIntegrations({
      gtm_server_container_url: null
    });
    expect(result.isValid).toBe(true);
  });

  test('should accept valid Google Ads Conversion ID', () => {
    const result = validateIntegrations({
      google_ads_conversion_id: 'AW-123456789'
    });
    expect(result.isValid).toBe(true);
  });

  test('should reject invalid Google Ads Conversion ID', () => {
    const result = validateIntegrations({
      google_ads_conversion_id: 'INVALID-ADS-ID'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.google_ads_conversion_id).toContain('Invalid Google Ads ID format');
  });

  test('should accept valid Umami Website ID (UUID format)', () => {
    const result = validateIntegrations({
      umami_website_id: '550e8400-e29b-41d4-a716-446655440000'
    });
    expect(result.isValid).toBe(true);
  });

  test('should reject invalid Umami Website ID', () => {
    const result = validateIntegrations({
      umami_website_id: 'not-a-uuid'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.umami_website_id).toContain('Invalid Website ID (must be a UUID)');
  });

  test('should validate multiple fields at once', () => {
    const result = validateIntegrations({
      gtm_container_id: 'GTM-VALID123',
      facebook_pixel_id: '1234567890',
      gtm_server_container_url: 'https://gtm.example.com',
      umami_website_id: '550e8400-e29b-41d4-a716-446655440000'
    });
    expect(result.isValid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  test('should return multiple errors for multiple invalid fields', () => {
    const result = validateIntegrations({
      gtm_container_id: 'INVALID',
      facebook_pixel_id: 'not-numeric',
      gtm_server_container_url: 'http://insecure.com'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.gtm_container_id).toBeDefined();
    expect(result.errors.facebook_pixel_id).toBeDefined();
    expect(result.errors.gtm_server_container_url).toBeDefined();
  });

  test('should accept each valid conversion_tracking_mode value', () => {
    for (const mode of ['strict', 'limited', 'permissive'] as const) {
      const result = validateIntegrations({ conversion_tracking_mode: mode });
      expect(result.isValid).toBe(true);
    }
  });

  test('should reject unknown conversion_tracking_mode value', () => {
    const result = validateIntegrations({
      // @ts-expect-error — intentionally testing a runtime-only invalid value
      conversion_tracking_mode: 'aggressive',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.conversion_tracking_mode).toContain('Invalid conversion tracking mode');
  });
});
