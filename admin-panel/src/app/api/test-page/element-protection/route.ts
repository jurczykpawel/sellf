import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CSP_NONCE_HEADER } from '@/proxy';

/**
 * Serves element-protection.html test page from the SAME origin as Next.js.
 * This avoids cross-origin cookie issues with sellf.js SDK in tests.
 * Only available in development/test mode.
 */
export async function GET(request: NextRequest) {
  // Test pages must never be served in production — regardless of E2E_MODE
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  // Validate testProduct: only allow slug-safe characters (prevent XSS via </script> breakout)
  const rawTestProduct = request.nextUrl.searchParams.get('testProduct') || 'test-product';
  const testProduct = rawTestProduct.replace(/[^a-zA-Z0-9_-]/g, '');

  // Sanitize host header: only allow hostname:port characters (prevent XSS injection into HTML)
  const rawHost = request.headers.get('host') || 'localhost:3777';
  if (!/^[a-zA-Z0-9.\-:]+$/.test(rawHost)) {
    return NextResponse.json({ error: 'Invalid host header' }, { status: 400 });
  }
  const baseUrl = `http://${rawHost}`;

  const nonce = request.headers.get(CSP_NONCE_HEADER) ?? '';

  try {
    const htmlPath = join(process.cwd(), '..', 'examples', 'test-pages', 'element-protection.html');
    let html = readFileSync(htmlPath, 'utf-8');

    // Override the apiUrl to point to same origin (match any localhost port in the fallback)
    html = html.replace(
      /const apiBaseUrl = urlParams\.get\('apiUrl'\) \|\| 'http:\/\/localhost:\d+'/,
      `const apiBaseUrl = '${baseUrl}'`
    );

    // Set testProduct (already sanitized to alphanumeric+hyphens above)
    html = html.replace(
      "urlParams.get('testProduct') || 'test-product'",
      `'${testProduct}'`
    );

    if (nonce) {
      html = html.replace(/<script>/g, `<script nonce="${nonce}">`);
      html = html.replace(
        "document.body.appendChild(script);",
        `script.nonce = ${JSON.stringify(nonce)}; document.body.appendChild(script);`,
      );
    }

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch {
    return NextResponse.json({ error: 'Test page not found' }, { status: 404 });
  }
}
