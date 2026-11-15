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
import { readInvoiceRecipientEnabled, saveInvoiceRecipientEnabled } from '@/lib/checkout/invoice-recipient-setting';
import { createPlatformClient } from '@/lib/supabase/admin';
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
    const saved = await saveInvoiceRecipientEnabled(auth.supabase as unknown as SettingsClient, enabled);
    if (!saved.ok) {
      console.error('[PATCH /api/v1/settings/checkout] Error:', saved.error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to update checkout settings');
    }
    try {
      await createPlatformClient().from('audit_log').insert({
        user_id: auth.admin.userId,
        operation: 'UPDATE',
        table_name: 'shop_config',
        performed_by: auth.admin.email || 'unknown',
        new_values: { invoice_recipient_enabled: enabled, auth: auth.method },
      });
    } catch (auditError) {
      console.error('[PATCH /api/v1/settings/checkout] Audit log insert failed:', auditError instanceof Error ? auditError.message : 'Unknown error');
    }
    return jsonResponse(successResponse({ invoice_recipient_enabled: enabled }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
