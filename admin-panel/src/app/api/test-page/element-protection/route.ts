import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Serves element-protection.html test page from the SAME origin as Next.js.
 * This avoids cross-origin cookie issues with sellf.js SDK in tests.
 * Only available in development/test mode.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' && !process.env.E2E_MODE) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  const testProduct = request.nextUrl.searchParams.get('testProduct') || 'test-product';

  // Read the static HTML file and inject apiUrl pointing to ourselves (same origin)
  const baseUrl = `http://${request.headers.get('host') || 'localhost:3777'}`;

  try {
    const htmlPath = join(process.cwd(), '..', 'examples', 'test-pages', 'element-protection.html');
    let html = readFileSync(htmlPath, 'utf-8');

    // Override the apiUrl to point to same origin (match any localhost port in the fallback)
    html = html.replace(
      /const apiBaseUrl = urlParams\.get\('apiUrl'\) \|\| 'http:\/\/localhost:\d+'/,
      `const apiBaseUrl = '${baseUrl}'`
    );

    // Set testProduct
    html = html.replace(
      "urlParams.get('testProduct') || 'test-product'",
      `'${testProduct.replace(/'/g, "\\'")}'`
    );

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch {
    return NextResponse.json({ error: 'Test page not found' }, { status: 404 });
  }
}
