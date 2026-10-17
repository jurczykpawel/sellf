/** Product offer validate endpoint. @see @/lib/storefront-templates/http */
import { templateHttp } from '@/lib/storefront-templates/http';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return templateHttp(request, 'validate', (await params).id);
}
