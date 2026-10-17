/** Product offer config endpoint. @see @/lib/storefront-templates/http */
import { templateHttp } from '@/lib/storefront-templates/http';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return templateHttp(request, 'read', (await params).id);
}
