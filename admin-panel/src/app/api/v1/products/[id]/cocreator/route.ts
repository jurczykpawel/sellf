/**
 * Products API v1 - co-creator share
 *
 * GET    /api/v1/products/[id]/cocreator - Read the co-creator and their share (products:read)
 * PUT    /api/v1/products/[id]/cocreator - Assign a co-creator or change the share (products:write)
 * DELETE /api/v1/products/[id]/cocreator - Remove the co-creator from future purchases (products:write)
 *
 * The share (percent or fixed amount) is added to any partner commission on the same purchase;
 * one-time products only; purchases made before the change keep what they had.
 *
 * @see src/lib/affiliates/cocreator/service.ts
 */

import { NextRequest } from 'next/server';
import {
  API_SCOPES,
  apiError,
  authenticate,
  handleApiError,
  handleCorsPreFlight,
  jsonResponse,
  noContentResponse,
  parseJsonBody,
  successResponse,
} from '@/lib/api';
import { validateProductId } from '@/lib/validations/product';
import { cocreatorPutSchema } from '@/lib/affiliates/cocreator/model';
import { readProductCocreator, writeProductCocreator } from '@/lib/affiliates/cocreator/service';
import type { CocreatorInfo } from '@/lib/affiliates/cocreator/model';
import type { CocreatorError } from '@/lib/affiliates/cocreator/service';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ERRORS: Record<CocreatorError, [Parameters<typeof apiError>[1], string]> = {
  NOT_FOUND: ['NOT_FOUND', 'Product not found'],
  CONFLICT: ['CONFLICT', 'The co-creator setting changed; read it again and resend expected_revision'],
  INVALID_INPUT: ['INVALID_INPUT', 'Co-creator shares apply to one-time products only, to an approved person'],
  ACCOUNT_NOT_FOUND: ['NOT_FOUND', 'No account with this e-mail; the person must sign in once first'],
  PROGRAM_REQUIRED: ['INVALID_INPUT', 'Save the partner program settings first (hold days and payout thresholds)'],
  FORBIDDEN: ['FORBIDDEN', 'Forbidden'],
  INTERNAL_ERROR: ['INTERNAL_ERROR', 'Co-creator setting unavailable'],
};
function failure(request: NextRequest, code: CocreatorError) {
  const [errorCode, message] = ERRORS[code];
  return apiError(request, errorCode, message);
}

/** The documented response shape (cocreatorResponseSchema), without panel-only product facts. */
function publicView({ product_id, revision, program_configured, cocreator }: CocreatorInfo): CocreatorInfo {
  return { product_id, revision, program_configured, cocreator };
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);
    const { id } = await context.params;
    if (!validateProductId(id).isValid) return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
    const result = await readProductCocreator(supabase, id);
    if (!result.success) return failure(request, result.errorCode);
    return jsonResponse(successResponse(publicView(result.data)), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);
    const { id } = await context.params;
    if (!validateProductId(id).isValid) return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
    const parsed = cocreatorPutSchema.safeParse(await parseJsonBody<unknown>(request));
    if (!parsed.success) {
      return apiError(request, 'VALIDATION_ERROR', 'Expected { email, rule: { percentage_bps } | { fixed_minor, currency }, display_name?, expected_revision? }');
    }
    const { email, display_name, rule, expected_revision } = parsed.data;
    const written = await writeProductCocreator(auth.supabase, auth.admin.userId, { product_id: id, expected_revision, person: { email, display_name, rule } });
    if (!written.success) return failure(request, written.errorCode);
    const result = await readProductCocreator(auth.supabase, id);
    if (!result.success) return failure(request, result.errorCode);
    return jsonResponse(successResponse(publicView(result.data)), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);
    const { id } = await context.params;
    if (!validateProductId(id).isValid) return apiError(request, 'INVALID_INPUT', 'Invalid product ID format');
    const current = await readProductCocreator(auth.supabase, id);
    if (!current.success) return failure(request, current.errorCode);
    if (current.data.cocreator) {
      const written = await writeProductCocreator(auth.supabase, auth.admin.userId, { product_id: id, expected_revision: current.data.revision, person: null });
      if (!written.success) return failure(request, written.errorCode);
    }
    return noContentResponse(request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
