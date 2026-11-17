/**
 * Maintenance mode API v1
 *
 * GET   /api/v1/system/maintenance - Effective state, its source and how to end it (system:read)
 * PATCH /api/v1/system/maintenance - Switch the database source on or off (system:write)
 *
 * The server file (<install>/MAINTENANCE) and SELLF_MAINTENANCE win over the database switch and
 * cannot be changed here; the answer says where they are. Every change is audited in the same
 * transaction.
 *
 * @see src/lib/maintenance/setting.ts
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
import { changeMaintenanceMode, maintenanceChangeSchema, readMaintenanceStatus } from '@/lib/maintenance/setting';
import type { MaintenanceClient } from '@/lib/maintenance/setting';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.SYSTEM_READ]);
    const status = await readMaintenanceStatus(auth.supabase as unknown as MaintenanceClient);
    if (!status.ok) {
      console.error('[GET /api/v1/system/maintenance] Error:', status.error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to read maintenance mode');
    }
    return jsonResponse(successResponse(status.data), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.SYSTEM_WRITE]);
    const parsed = maintenanceChangeSchema.safeParse(await parseJsonBody<unknown>(request));
    if (!parsed.success) {
      return apiError(request, 'INVALID_INPUT', 'Expected { "enabled": boolean, "message"?: string | null (max 500), "expected_end_at"?: ISO 8601 | null }');
    }
    // The change and its audit entry are one transaction; the entry names the admin by auth user UUID
    // (for an API key, the key owner's admin_users.user_id).
    const saved = await changeMaintenanceMode(auth.supabase as unknown as MaintenanceClient, parsed.data, {
      performedBy: auth.admin.userId,
      details: { auth: auth.method },
    });
    if (!saved.ok) {
      if (saved.invalid) return apiError(request, 'INVALID_INPUT', saved.error);
      console.error('[PATCH /api/v1/system/maintenance] Error:', saved.error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to change maintenance mode');
    }
    return jsonResponse(successResponse(saved.data), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
