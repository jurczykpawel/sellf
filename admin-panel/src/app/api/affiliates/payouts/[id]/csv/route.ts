/** Private payout export. @see lib/affiliates/payouts/download.ts */
import { downloadPayoutCsv } from '@/lib/affiliates/payouts/download';
import type { NextRequest } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return downloadPayoutCsv({ payout_id: (await params).id, version: request.nextUrl.searchParams.get('version') });
}
