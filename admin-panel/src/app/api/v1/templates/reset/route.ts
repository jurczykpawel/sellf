/** Template reset HTTP endpoint. @see @/lib/storefront-templates/http */
import { templateHttp } from '@/lib/storefront-templates/http';
import type { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  return templateHttp(request, 'reset');
}
