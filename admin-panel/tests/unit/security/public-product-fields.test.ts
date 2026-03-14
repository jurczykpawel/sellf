import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ============================================================================
 * SECURITY TEST: Public Product API Field Exposure
 * ============================================================================
 *
 * Verifies that the public product API uses explicit field selection
 * and does not expose sensitive fields (content_config, internal IDs, etc.)
 * to unauthenticated users. Tests real route source via static analysis.
 * ============================================================================
 */

const routePath = join(__dirname, '../../../src/app/api/public/products/[slug]/route.ts');
const routeSource = readFileSync(routePath, 'utf-8');

// Extract the select() template literal content from the route source
const selectMatch = routeSource.match(/\.select\(\s*`([^`]+)`\s*\)/s);
const selectContent = selectMatch ? selectMatch[1] : '';

// SOURCE_TEXT_VERIFY: These tests read the public product route source and verify the
// explicit field list in .select(). Runtime testing is not possible without a running
// Supabase instance, but the critical security invariant is that select('*') is never
// used and sensitive fields (content_config, success_redirect_url) are never included
// in the field list.

describe('Public Product API Field Exposure', () => {
  describe('Route source uses explicit select', () => {
    it('uses explicit field list (not select(*))', () => {
      expect(selectMatch).not.toBeNull();
      expect(selectContent.trim()).not.toBe('*');
      expect(routeSource).not.toMatch(/\.select\(\s*['"`]\s*\*\s*['"`]\s*\)/);
    });
  });

  describe('Sensitive fields are NOT exposed', () => {
    it('does NOT expose content_config, success_redirect_url, or pass_params_to_redirect', () => {
      expect(selectContent).not.toContain('content_config');
      expect(selectContent).not.toContain('success_redirect_url');
      expect(selectContent).not.toContain('pass_params_to_redirect');
    });

    it('does NOT expose auto_grant_duration_days or tenant_id', () => {
      expect(selectContent).not.toContain('auto_grant_duration_days');
      expect(selectContent).not.toContain('tenant_id');
    });
  });

  describe('Required display fields are included', () => {
    it('includes core display fields', () => {
      // Use word-boundary regex to avoid false positives (e.g., 'id' matching 'product_id')
      const requiredFields = ['id', 'name', 'slug', 'description', 'price', 'currency', 'icon'];
      for (const field of requiredFields) {
        expect(selectContent).toMatch(new RegExp(`\\b${field}\\b`));
      }
    });

    it('includes custom pricing and availability fields', () => {
      const pricingFields = ['allow_custom_price', 'custom_price_min', 'custom_price_presets', 'show_price_presets'];
      for (const field of pricingFields) {
        expect(selectContent).toContain(field);
      }

      const availabilityFields = ['available_from', 'available_until', 'enable_waitlist'];
      for (const field of availabilityFields) {
        expect(selectContent).toContain(field);
      }
    });

    it('includes layout and delivery type but NOT content config', () => {
      expect(selectContent).toContain('layout_template');
      expect(selectContent).toContain('content_delivery_type');
      expect(selectContent).not.toContain('content_config');
    });

    it('includes product status fields', () => {
      expect(selectContent).toContain('is_active');
      expect(selectContent).toContain('is_featured');
    });
  });
});
