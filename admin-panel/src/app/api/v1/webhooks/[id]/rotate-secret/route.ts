/**
 * POST /api/v1/webhooks/:id/rotate-secret — replace the signing secret.
 * @see supabase/migrations/20261110235900_release_2026_11_0_storefront.sql
 */
import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import {
  authenticate, API_SCOPES, ApiAuthError, apiError, handleApiError,
  handleCorsPreFlight, jsonResponse, successResponse,
} from '@/lib/api';
import { validateUUID } from '@/lib/validations/product';
import { encryptWebhookSecret } from '@/lib/webhooks/signing-secret';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);
    const { id } = await params;
    if (!validateUUID(id).isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid webhook ID format');
    }

    const secret = `whsec_${randomBytes(32).toString('hex')}`;
    const stored = await encryptWebhookSecret(secret);
    const { data, error } = await auth.supabase.rpc('rotate_webhook_secret', {
      p_endpoint_id: id,
      p_secret: stored,
      p_actor_id: auth.admin.userId,
      p_api_key_id: auth.method === 'api_key' ? auth.apiKey.id : null,
    });
    if (error) {
      return apiError(request, 'INTERNAL_ERROR', 'Failed to rotate webhook secret');
    }
    if (!data) return apiError(request, 'NOT_FOUND', 'Webhook not found');

    const response = jsonResponse(successResponse({ id, secret }), request);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof ApiAuthError) return handleApiError(error, request);
    // Keep encryption configuration details out of API errors.
    return handleApiError(new Error('Failed to rotate webhook secret'), request);
  }
}
