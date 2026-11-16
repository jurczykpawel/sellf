/**
 * Checkout settings API v1
 *
 * GET   /api/v1/settings/checkout - Read shop checkout settings (system:read)
 * PATCH /api/v1/settings/checkout - Change them (system:write)
 *
 * Today one setting: `invoice_recipient_enabled` — collect a different invoice recipient
 * (institutions only, always with a NIP). OFF by default.
 *
 * @see src/lib/checkout/invoice-recipient-setting.ts
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
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
import { changeInvoiceRecipientEnabled, readInvoiceRecipientEnabled } from '@/lib/checkout/invoice-recipient-setting';
import type { SettingsClient } from '@/lib/checkout/invoice-recipient-setting';

const patchSchema = z.object({ invoice_recipient_enabled: z.boolean() }).strict();

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.SYSTEM_READ]);
    const enabled = await readInvoiceRecipientEnabled(auth.supabase as unknown as SettingsClient);
    return jsonResponse(successResponse({ invoice_recipient_enabled: enabled }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.SYSTEM_WRITE]);
    const parsed = patchSchema.safeParse(await parseJsonBody<unknown>(request));
    if (!parsed.success) {
      return apiError(request, 'INVALID_INPUT', 'Expected exactly { "invoice_recipient_enabled": boolean }');
    }
    const enabled = parsed.data.invoice_recipient_enabled;
    // Setting + audit entry in one transaction: the entry names the admin by auth user UUID (for an
    // API key, the key owner's admin_users.user_id); when it is refused nothing is saved.
    const saved = await changeInvoiceRecipientEnabled(auth.supabase as unknown as SettingsClient, enabled, {
      performedBy: auth.admin.userId,
      details: { auth: auth.method },
    });
    if (!saved.ok) {
      console.error('[PATCH /api/v1/settings/checkout] Error:', saved.error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to update checkout settings');
    }
    return jsonResponse(successResponse({ invoice_recipient_enabled: enabled }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
