/** Release-bundled public fonts for portable storefront snapshots. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limiting';

export async function GET(_request: Request, { params }: { params: Promise<{ font: string }> }): Promise<NextResponse> {
  const { font } = await params;
  if (font !== 'geist' && font !== 'dm-sans') return new NextResponse(null, { status: 404 });
  if (!(await checkRateLimit('storefront_preview_font', 120, 1))) return new NextResponse(null, { status: 429 });
  try {
    const bytes = font === 'geist'
      ? await readFile(path.join(process.cwd(), 'node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2'))
      : await readFile(path.join(process.cwd(), 'src/fonts/DMSans-Variable.ttf'));
    return new NextResponse(bytes, { headers: { 'Content-Type': font === 'geist' ? 'font/woff2' : 'font/ttf', 'Cache-Control': 'public, max-age=3600' } });
  } catch { return new NextResponse(null, { status: 404 }); }
}
