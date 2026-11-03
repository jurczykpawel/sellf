/** Buyer declares the transfer is on its way; the signed order link is the only credential. @see migration 20261103150000_unpaid_order_reservations.sql (declare_transfer) */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';
import { dispatchTransferEvent } from '@/lib/orders/bank-transfer-service';
import { verifyTransferToken } from '@/lib/orders/transfer-token';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import type { NextRequest } from 'next/server';

const inputSchema = z.object({
  orderId: z.uuid(), token: z.string().max(80),
  note: z.string().trim().max(200).regex(/^[^\u0000-\u001f\u007f]*$/).optional(),
}).strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    if (!await checkRateLimit('transfer_declare', 10, 60)) return reply({ error: 'Too many requests' }, 429);
    const parsed = inputSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return reply({ error: 'Invalid request' }, 400);
    const { orderId, token, note } = parsed.data;
    if (!verifyTransferToken(token, orderId)) return reply({ error: 'Not found' }, 404);
    const db = createAdminClient();
    const { data, error } = await db.rpc('declare_transfer', { p_id: orderId, p_note: note ?? '', p_now: new Date().toISOString() });
    const result = data as { success?: boolean; already_declared?: boolean; releaseAt?: string | null; declaredAt?: string } | null;
    if (error || !result) return reply({ error: 'Declaration unavailable' }, 500);
    if (!result.success) return reply({ error: 'Order is not awaiting payment' }, 409);
    if (!result.already_declared) {
      try { await dispatchTransferEvent(db, orderId, 'order.transfer_declared'); }
      catch { console.error('[transfer-declare] Event awaiting recovery:', orderId); }
    }
    return reply({ declaredAt: result.declaredAt, releaseAt: result.releaseAt ?? null });
  } catch (error) {
    return reply({ error: error instanceof ApiPayloadTooLargeError ? 'Request too large' : 'Declaration unavailable' }, error instanceof ApiPayloadTooLargeError ? 413 : 500);
  }
}
