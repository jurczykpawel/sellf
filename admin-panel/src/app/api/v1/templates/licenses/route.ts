/** Private template credential entry and status. @see lib/storefront-templates/http.ts */
import { templateHttp } from '@/lib/storefront-templates/http';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) { return templateHttp(request, 'license_status'); }
export async function POST(request: NextRequest) { return templateHttp(request, 'license_save'); }
