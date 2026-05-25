import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  handleCorsPreFlight,
  jsonResponse,
  noContentResponse,
  apiError,
  authenticate,
  handleApiError,
  parseJsonBody,
  ApiValidationError,
  successResponse,
  API_SCOPES,
} from '@/lib/api';
import { validateUUID } from '@/lib/validations/product';
import { TagUpdateDTO, TAG_API_FIELDS } from '@/lib/api/dto/tag';

interface RouteParams { params: Promise<{ id: string }>; }

export async function OPTIONS(request: NextRequest) { return handleCorsPreFlight(request); }

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);
    const { id } = await params;
    if (!validateUUID(id).isValid) return apiError(request, 'INVALID_INPUT', 'Invalid tag ID');

    const { data, error } = await supabase.from('tags').select(TAG_API_FIELDS).eq('id', id).single();
    if (error) {
      if (error.code === 'PGRST116') return apiError(request, 'NOT_FOUND', 'Tag not found');
      console.error('[tags.GET single]', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch tag');
    }
    return jsonResponse(successResponse(data), request);
  } catch (e) { return handleApiError(e, request); }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);
    const { id } = await params;
    if (!validateUUID(id).isValid) return apiError(request, 'INVALID_INPUT', 'Invalid tag ID');

    const body = await parseJsonBody<Record<string, unknown>>(request);
    let input;
    try {
      input = TagUpdateDTO.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApiValidationError('Validation failed', {
          _errors: err.issues.map((i) => `${i.path.join('.') || '_'}: ${i.message}`),
        });
      }
      throw err;
    }
    if (Object.keys(input).length === 0) return apiError(request, 'INVALID_INPUT', 'No fields to update');

    if (input.slug) {
      const { data: dup } = await supabase.from('tags').select('id').eq('slug', input.slug).neq('id', id).maybeSingle();
      if (dup) return apiError(request, 'CONFLICT', 'Tag slug already exists');
    }

    const { data, error } = await supabase.from('tags').update(input).eq('id', id).select(TAG_API_FIELDS).single();
    if (error) {
      if (error.code === 'PGRST116') return apiError(request, 'NOT_FOUND', 'Tag not found');
      console.error('[tags.PATCH]', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to update tag');
    }
    return jsonResponse(successResponse(data), request);
  } catch (e) { return handleApiError(e, request); }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);
    const { id } = await params;
    if (!validateUUID(id).isValid) return apiError(request, 'INVALID_INPUT', 'Invalid tag ID');

    const { count, error } = await supabase.from('tags').delete({ count: 'exact' }).eq('id', id);
    if (error) {
      console.error('[tags.DELETE]', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to delete tag');
    }
    if (count === 0) return apiError(request, 'NOT_FOUND', 'Tag not found');
    return noContentResponse(request);
  } catch (e) { return handleApiError(e, request); }
}
