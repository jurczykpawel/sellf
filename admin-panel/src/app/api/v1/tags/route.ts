import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  parseJsonBody,
  ApiValidationError,
  successResponse,
  parseLimit,
  createPaginationResponse,
  applyCursorToQuery,
  validateCursor,
  API_SCOPES,
} from '@/lib/api';
import { TagCreateDTO, TAG_API_FIELDS, validateTagSortColumn } from '@/lib/api/dto/tag';
import { escapeIlikePattern } from '@/lib/validations/product';

export async function OPTIONS(request: NextRequest) { return handleCorsPreFlight(request); }

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);
    const sp = request.nextUrl.searchParams;
    const cursor = sp.get('cursor');
    const limit = parseLimit(sp.get('limit'));
    const search = sp.get('search') ?? '';
    const sortBy = validateTagSortColumn(sp.get('sort_by'));
    const sortOrder = sp.get('sort_order') === 'asc' ? 'asc' : 'desc';

    const cursorErr = validateCursor(cursor);
    if (cursorErr) return apiError(request, 'INVALID_INPUT', cursorErr);
    if (search.length > 200) return apiError(request, 'INVALID_INPUT', 'Search must be 200 chars or less');
    const esc = search ? escapeIlikePattern(search) : null;

    let countQ = supabase.from('tags').select('id', { count: 'exact', head: true });
    if (esc) countQ = countQ.or(`name.ilike.%${esc}%,slug.ilike.%${esc}%`);
    const { count } = await countQ;

    let q = supabase.from('tags').select(TAG_API_FIELDS);
    if (esc) q = q.or(`name.ilike.%${esc}%,slug.ilike.%${esc}%`);
    q = applyCursorToQuery(q, cursor, sortBy, sortOrder);
    q = q.order(sortBy, { ascending: sortOrder === 'asc' })
         .order('id', { ascending: sortOrder === 'asc' })
         .limit(limit + 1);

    const { data, error } = await q;
    if (error) {
      console.error('[tags.GET]', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch tags');
    }
    const { items, pagination } = createPaginationResponse(data ?? [], limit, sortBy, sortOrder, cursor);
    return jsonResponse(successResponse(items, { ...pagination, total: count ?? undefined }), request);
  } catch (e) { return handleApiError(e, request); }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    let input;
    try {
      input = TagCreateDTO.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApiValidationError('Validation failed', {
          _errors: err.issues.map((i) => `${i.path.join('.') || '_'}: ${i.message}`),
        });
      }
      throw err;
    }

    const { data: existing } = await supabase.from('tags').select('id').eq('slug', input.slug).maybeSingle();
    if (existing) return apiError(request, 'CONFLICT', 'Tag slug already exists');

    const { data, error } = await supabase.from('tags').insert(input).select(TAG_API_FIELDS).single();
    if (error) {
      if (error.code === '23505') return apiError(request, 'CONFLICT', 'Tag slug already exists');
      console.error('[tags.POST]', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to create tag');
    }
    return jsonResponse(successResponse(data), request, 201);
  } catch (e) { return handleApiError(e, request); }
}
