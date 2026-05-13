/**
 * Integrations API v1
 *
 * PATCH /api/v1/integrations - Update tracking/consent integrations config.
 */

import { NextRequest } from 'next/server';
import {
  API_SCOPES,
  apiError,
  authenticate,
  handleApiError,
  handleCorsPreFlight,
  jsonResponse,
  parseJsonBody,
  successResponse,
} from '@/lib/api';
import { createPlatformClient } from '@/lib/supabase/admin';
import { validateIntegrations, type IntegrationsInput } from '@/lib/validations/integrations';

const ALLOWED_FIELDS = [
  'gtm_container_id',
  'gtm_server_container_url',
  'gtm_ss_enabled',
  'google_ads_conversion_id',
  'google_ads_conversion_label',
  'facebook_pixel_id',
  'facebook_capi_token',
  'facebook_test_event_code',
  'fb_capi_enabled',
  'send_conversions_without_consent',
  'umami_website_id',
  'umami_script_url',
  'cookie_consent_enabled',
  'consent_logging_enabled',
] as const satisfies ReadonlyArray<keyof IntegrationsInput>;

const BOOLEAN_FIELDS = new Set<keyof IntegrationsInput>([
  'gtm_ss_enabled',
  'fb_capi_enabled',
  'send_conversions_without_consent',
  'cookie_consent_enabled',
  'consent_logging_enabled',
]);

const allowedFieldSet = new Set<string>(ALLOWED_FIELDS);

type AllowedField = typeof ALLOWED_FIELDS[number];
type UpdatePayload = Partial<Record<AllowedField, string | boolean | null>>;

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.INTEGRATIONS_WRITE]);
    const body = await parseJsonBody<Record<string, unknown>>(request);

    const unknownFields = Object.keys(body).filter((key) => !allowedFieldSet.has(key));
    if (unknownFields.length > 0) {
      return apiError(request, 'INVALID_INPUT', `Unsupported fields: ${unknownFields.join(', ')}`);
    }

    if (Object.keys(body).length === 0) {
      return apiError(request, 'INVALID_INPUT', 'At least one integration field is required');
    }

    const updates: UpdatePayload = {};
    const errors: Record<string, string[]> = {};

    for (const field of ALLOWED_FIELDS) {
      if (!(field in body)) continue;
      const value = body[field];

      if (BOOLEAN_FIELDS.has(field)) {
        if (typeof value !== 'boolean') {
          errors[field] = ['Must be a boolean'];
          continue;
        }
        updates[field] = value;
        continue;
      }

      if (value === null) {
        updates[field] = null;
        continue;
      }

      if (typeof value !== 'string') {
        errors[field] = ['Must be a string or null'];
        continue;
      }

      updates[field] = value.trim() === '' ? null : value.trim();
    }

    if (Object.keys(errors).length > 0) {
      return apiError(request, 'INVALID_INPUT', 'Invalid integration fields', errors);
    }

    const validation = validateIntegrations(updates as IntegrationsInput);
    if (!validation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid integration fields', validation.errors);
    }

    const changedFields = Object.keys(updates).sort();
    const { data, error } = await auth.supabase
      .from('integrations_config')
      .upsert({ id: 1, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('id, updated_at')
      .single();

    if (error) {
      console.error('[PATCH /api/v1/integrations] update failed:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to update integrations configuration');
    }

    await createPlatformClient().from('tracking_logs').insert({
      event_name: 'integrations.config_updated',
      event_id: crypto.randomUUID(),
      source: 'server',
      status: 'success',
      destination: 'api_v1',
      skip_reason: `fields=${changedFields.join(',')};auth=${auth.method}`,
    });

    return jsonResponse(
      successResponse({
        id: data.id,
        updated_at: data.updated_at,
        changed_fields: changedFields,
      }),
      request
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
