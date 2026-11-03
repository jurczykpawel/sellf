/** Buyer adds the participant list after payment. @see lib/orders/participants-service.ts, migration 20261103170000_participants_later.sql */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';
import { canEditParticipants } from '@/lib/orders/participants-access';
import { submitParticipants } from '@/lib/orders/participants-service';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import type { NextRequest } from 'next/server';

const inputSchema = z.object({ orderId: z.uuid(), token: z.string().max(80).optional(), people: z.array(z.unknown()).max(100) }).strict();
const STATUS: Record<string, number> = { not_found: 404, not_paid: 409, not_allowed: 409, already_complete: 409, unavailable: 500 };

export async function POST(request: NextRequest): Promise<NextResponse> {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    if (!await checkRateLimit('order_participants', 20, 60)) return reply({ error: 'Too many requests' }, 429);
    const parsed = inputSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return reply({ error: 'Invalid request' }, 400);
    const { orderId, token, people } = parsed.data;
    const db = createAdminClient();
    const { data: tx } = await db.from('payment_transactions').select('user_id,order_details').eq('id', orderId).maybeSingle();
    if (!tx || !await canEditParticipants(orderId, token, tx.user_id)) return reply({ error: 'Not found' }, 404);
    const details = tx.order_details as { quantity?: { value?: number }; participants?: { people?: unknown[] } } | null;
    if ((details?.participants?.people?.length ?? 0) > 0) return reply({ success: false, code: 'already_complete' }, 409);
    const quantity = Number(details?.quantity?.value ?? 1);
    const result = await submitParticipants(db, orderId, quantity, people);
    if (result.ok) return reply({ success: true });
    if (STATUS[result.code]) return reply({ success: false, code: result.code }, STATUS[result.code]);
    return reply({ success: false, errors: [{ field: result.field ? `participants.${result.field}` : 'participants', code: result.code }] }, 422);
  } catch (error) {
    return reply({ error: error instanceof ApiPayloadTooLargeError ? 'Request too large' : 'Participants unavailable' }, error instanceof ApiPayloadTooLargeError ? 413 : 500);
  }
}
