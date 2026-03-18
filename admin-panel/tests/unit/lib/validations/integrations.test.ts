/**
 * Integrations Validation Unit Tests
 *
 * Tests for third-party integrations configuration validation.
 */

import { describe, it, expect } from 'vitest';
import { validateIntegrations } from '@/lib/validations/integrations';
import type { IntegrationsInput } from '@/lib/validations/integrations';

describe('Integrations Validation', () => {
  describe('validateIntegrations', () => {
    it('should validate empty input', () => {
      const result = validateIntegrations({});
      expect(result.isValid).toBe(true);
    });

    it('should validate all valid integrations', () => {
      const input: IntegrationsInput = {
        gtm_container_id: 'GTM-ABC123',
        gtm_server_container_url: 'https://gtm.example.com',
        google_ads_conversion_id: 'AW-123456789',
        facebook_pixel_id: '1234567890',
        umami_website_id: '550e8400-e29b-41d4-a716-446655440000',
        umami_script_url: 'https://analytics.example.com/script.js',
        sellf_license: 'SF-example.com-UNLIMITED-abc123XYZ',
      };
      const result = validateIntegrations(input);
      expect(result.isValid).toBe(true);
    });

    describe('GTM Container ID', () => {
      it('should accept valid GTM ID format', () => {
        expect(validateIntegrations({ gtm_container_id: 'GTM-ABC123' }).isValid).toBe(true);
        expect(validateIntegrations({ gtm_container_id: 'GTM-WXYZ789' }).isValid).toBe(true);
      });

      it('should reject invalid GTM ID format', () => {
        const result = validateIntegrations({ gtm_container_id: 'invalid' });
        expect(result.isValid).toBe(false);
        expect(result.errors.gtm_container_id).toContain('Invalid GTM Container ID format');
      });

      it('should reject lowercase GTM ID', () => {
        const result = validateIntegrations({ gtm_container_id: 'gtm-abc123' });
        expect(result.isValid).toBe(false);
      });

      it('should reject GTM ID without prefix', () => {
        const result = validateIntegrations({ gtm_container_id: 'ABC123' });
        expect(result.isValid).toBe(false);
      });
    });

    describe('GTM Server Container URL', () => {
      it('should accept valid HTTPS URL', () => {
        const result = validateIntegrations({ gtm_server_container_url: 'https://gtm.example.com' });
        expect(result.isValid).toBe(true);
      });

      it('should reject HTTP URL', () => {
        const result = validateIntegrations({ gtm_server_container_url: 'http://gtm.example.com' });
        expect(result.isValid).toBe(false);
        expect(result.errors.gtm_server_container_url[0]).toContain('valid HTTPS URL');
      });

      it('should reject invalid URL', () => {
        const result = validateIntegrations({ gtm_server_container_url: 'not-a-url' });
        expect(result.isValid).toBe(false);
      });
    });

    describe('Google Ads Conversion ID', () => {
      it('should accept valid Google Ads ID format', () => {
        expect(validateIntegrations({ google_ads_conversion_id: 'AW-123456789' }).isValid).toBe(true);
        expect(validateIntegrations({ google_ads_conversion_id: 'AW-1' }).isValid).toBe(true);
      });

      it('should reject invalid Google Ads ID format', () => {
        const result = validateIntegrations({ google_ads_conversion_id: 'invalid' });
        expect(result.isValid).toBe(false);
        expect(result.errors.google_ads_conversion_id).toContain('Invalid Google Ads ID format');
      });

      it('should reject non-numeric part', () => {
        const result = validateIntegrations({ google_ads_conversion_id: 'AW-abc' });
        expect(result.isValid).toBe(false);
      });
    });

    describe('Facebook Pixel ID', () => {
      it('should accept numeric pixel ID', () => {
        expect(validateIntegrations({ facebook_pixel_id: '1234567890' }).isValid).toBe(true);
        expect(validateIntegrations({ facebook_pixel_id: '123' }).isValid).toBe(true);
      });

      it('should reject non-numeric pixel ID', () => {
        const result = validateIntegrations({ facebook_pixel_id: 'abc123' });
        expect(result.isValid).toBe(false);
        expect(result.errors.facebook_pixel_id[0]).toContain('numeric');
      });
    });

    describe('Umami Website ID', () => {
      it('should accept valid UUID format', () => {
        const result = validateIntegrations({
          umami_website_id: '550e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid UUID format', () => {
        const result = validateIntegrations({ umami_website_id: 'not-a-uuid' });
        expect(result.isValid).toBe(false);
        expect(result.errors.umami_website_id[0]).toContain('UUID');
      });
    });

    describe('Umami Script URL', () => {
      it('should accept valid HTTP(S) URL', () => {
        expect(validateIntegrations({ umami_script_url: 'https://analytics.example.com/script.js' }).isValid).toBe(true);
        expect(validateIntegrations({ umami_script_url: 'http://localhost:3000/script.js' }).isValid).toBe(true);
      });

      it('should reject invalid URL', () => {
        const result = validateIntegrations({ umami_script_url: 'not-a-url' });
        expect(result.isValid).toBe(false);
        expect(result.errors.umami_script_url).toContain('Invalid Script URL');
      });
    });

    describe('Sellf License', () => {
      it('should accept valid unlimited license format', () => {
        const result = validateIntegrations({ sellf_license: 'SF-example.com-UNLIMITED-abc123XYZ_-' });
        expect(result.isValid).toBe(true);
      });

      it('should accept valid dated license format', () => {
        const result = validateIntegrations({ sellf_license: 'SF-example.com-20251231-abc123XYZ' });
        expect(result.isValid).toBe(true);
      });

      it('should accept wildcard domain license', () => {
        const result = validateIntegrations({ sellf_license: 'SF-*.example.com-UNLIMITED-signature' });
        expect(result.isValid).toBe(true);
      });

      it('should reject invalid license format', () => {
        const result = validateIntegrations({ sellf_license: 'invalid-license' });
        expect(result.isValid).toBe(false);
        expect(result.errors.sellf_license[0]).toContain('Invalid license format');
      });

      it('should reject missing prefix', () => {
        const result = validateIntegrations({ sellf_license: 'example.com-UNLIMITED-abc123' });
        expect(result.isValid).toBe(false);
      });
    });

    describe('null values', () => {
      it('should allow null values for all fields', () => {
        const input: IntegrationsInput = {
          gtm_container_id: null,
          gtm_server_container_url: null,
          google_ads_conversion_id: null,
          facebook_pixel_id: null,
          umami_website_id: null,
          umami_script_url: null,
          sellf_license: null,
        };
        const result = validateIntegrations(input);
        expect(result.isValid).toBe(true);
      });
    });

    describe('multiple errors', () => {
      it('should accumulate all errors', () => {
        const input: IntegrationsInput = {
          gtm_container_id: 'invalid',
          google_ads_conversion_id: 'bad',
          facebook_pixel_id: 'abc',
        };
        const result = validateIntegrations(input);
        expect(result.isValid).toBe(false);
        expect(Object.keys(result.errors).length).toBe(3);
      });
    });
  });

});
