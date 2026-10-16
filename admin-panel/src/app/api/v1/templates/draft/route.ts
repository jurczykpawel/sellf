/** Template draft HTTP endpoint. @see @/lib/storefront-templates/http */
import { templateHttp } from '@/lib/storefront-templates/http';
import type { NextRequest } from 'next/server';

export async function PUT(request: NextRequest) {
  return templateHttp(request, 'draft');
}
