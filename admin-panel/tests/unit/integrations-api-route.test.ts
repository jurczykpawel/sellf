import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { API_SCOPES, isValidScope } from '@/lib/api';
import { validateIntegrations } from '@/lib/validations/integrations';

const routeSource = readFileSync(
  resolve(__dirname, '../../src/app/api/v1/integrations/route.ts'),
  'utf-8'
);

describe('PATCH /api/v1/integrations contract', () => {
  it('defines and accepts the integrations:write API scope', () => {
    expect(API_SCOPES.INTEGRATIONS_WRITE).toBe('integrations:write');
    expect(isValidScope('integrations:write')).toBe(true);
  });

  it('does not expose a read endpoint for integrations config', () => {
    expect(routeSource).not.toContain('export async function GET');
    expect(routeSource).not.toContain('API_SCOPES.INTEGRATIONS_READ');
  });

  it('requires integrations:write, validates payloads, and writes an audit event', () => {
    expect(routeSource).toContain('authenticate(request, [API_SCOPES.INTEGRATIONS_WRITE])');
    expect(routeSource).toContain('validateIntegrations(updates as IntegrationsInput)');
    expect(routeSource).toContain("from('tracking_logs')");
    expect(routeSource).toContain('integrations.config_updated');
  });

  it('validates GTM, Pixel, and token formats used by TrackStack onboarding', () => {
    expect(validateIntegrations({ gtm_container_id: 'GTM-ABC123' }).isValid).toBe(true);
    expect(validateIntegrations({ facebook_pixel_id: '1234567890' }).isValid).toBe(true);
    expect(validateIntegrations({ facebook_capi_token: 'x'.repeat(40) }).isValid).toBe(true);

    const result = validateIntegrations({
      gtm_container_id: 'BAD-GTM',
      facebook_pixel_id: 'not-numeric',
      facebook_capi_token: 'short',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.gtm_container_id).toBeDefined();
    expect(result.errors.facebook_pixel_id).toBeDefined();
    expect(result.errors.facebook_capi_token).toBeDefined();
  });
});
