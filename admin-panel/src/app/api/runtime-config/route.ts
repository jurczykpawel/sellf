import { NextResponse } from 'next/server';
import { buildRuntimeConfig } from '@/lib/runtime-config';

// Public, read-only, heavily cached. No rate limit.
export async function GET() {
  return NextResponse.json(buildRuntimeConfig(), {
    headers: {
      'Cache-Control':
        process.env.NODE_ENV === 'development'
          ? 'no-cache, no-store, must-revalidate'
          : 'private, max-age=300',
    },
  });
}
