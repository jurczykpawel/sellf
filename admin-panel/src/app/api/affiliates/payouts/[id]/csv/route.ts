/** Private payout export. @see lib/affiliates/payouts/download.ts */
import { downloadPayoutCsv } from '@/lib/affiliates/payouts/download';
import type { NextRequest } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (request.headers.get('sec-fetch-site') !== 'same-origin') {
    return Response.json({ error: 'unavailable' }, { status: 403, headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  }
  return downloadPayoutCsv({ payout_id: (await params).id, version: request.nextUrl.searchParams.get('version') });
}
