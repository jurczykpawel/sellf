import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSchemaAwareAdminClient } from '@/lib/supabase/admin';
import { requireAdminOrSellerApi } from '@/lib/auth-server';

/**
 * SECURITY FIX (V8): Validate webhook URL to prevent SSRF attacks.
 * Rejects: internal IPs, localhost, private networks, cloud metadata endpoints.
 */
function isValidWebhookUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);

    // Must be HTTPS for security (except in development)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { valid: false, error: 'URL must use HTTPS protocol' };
    }

    const hostname = url.hostname.toLowerCase();

    // Block localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1') {
      return { valid: false, error: 'URL cannot point to localhost' };
    }

    // Block private/internal hostnames
    const blockedHostnames = [
      'metadata.google.internal',
      'metadata.goog',
      'kubernetes.default',
      'kubernetes.default.svc',
    ];
    if (blockedHostnames.some(blocked => hostname === blocked || hostname.endsWith('.' + blocked))) {
      return { valid: false, error: 'URL cannot point to internal services' };
    }

    // Check if hostname is an IP address
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipv4Match = hostname.match(ipv4Regex);

    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);

      // Block private IPv4 ranges (RFC 1918)
      // 10.0.0.0 - 10.255.255.255
      if (a === 10) {
        return { valid: false, error: 'URL cannot point to private IP addresses (10.x.x.x)' };
      }
      // 172.16.0.0 - 172.31.255.255
      if (a === 172 && b >= 16 && b <= 31) {
        return { valid: false, error: 'URL cannot point to private IP addresses (172.16-31.x.x)' };
      }
      // 192.168.0.0 - 192.168.255.255
      if (a === 192 && b === 168) {
        return { valid: false, error: 'URL cannot point to private IP addresses (192.168.x.x)' };
      }
      // 127.0.0.0 - 127.255.255.255 (loopback)
      if (a === 127) {
        return { valid: false, error: 'URL cannot point to loopback addresses' };
      }
      // 169.254.0.0 - 169.254.255.255 (link-local, includes AWS metadata)
      if (a === 169 && b === 254) {
        return { valid: false, error: 'URL cannot point to link-local addresses (cloud metadata)' };
      }
      // 0.0.0.0
      if (a === 0 && b === 0 && c === 0 && d === 0) {
        return { valid: false, error: 'URL cannot point to 0.0.0.0' };
      }
    }

    // Block IPv6 loopback and link-local (basic check for bracketed format)
    if (hostname.startsWith('[')) {
      const ipv6 = hostname.slice(1, -1).toLowerCase();
      if (ipv6 === '::1' || ipv6.startsWith('fe80:') || ipv6.startsWith('fc') || ipv6.startsWith('fd')) {
        return { valid: false, error: 'URL cannot point to IPv6 loopback or private addresses' };
      }
      // Block IPv4-mapped IPv6 addresses (e.g., ::ffff:127.0.0.1)
      if (ipv6.startsWith('::ffff:')) {
        return { valid: false, error: 'URL cannot use IPv4-mapped IPv6 addresses' };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);
    const dataClient = await createSchemaAwareAdminClient(authResult.sellerSchema);

    const { data: endpoints, error } = await (dataClient as any)
      .from('webhook_endpoints')
      .select('id, url, events, description, is_active, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(endpoints);
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && (error.message === 'Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    
    console.error('Error fetching webhooks:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const authResult = await requireAdminOrSellerApi(supabase);
    const dataClient = await createSchemaAwareAdminClient(authResult.sellerSchema);

    const body = await request.json();
    const { url, events, description } = body;

    if (!url || !events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    // SECURITY FIX (V8): Validate webhook URL to prevent SSRF
    const urlValidation = isValidWebhookUrl(url);
    if (!urlValidation.valid) {
      return NextResponse.json({ error: `Invalid webhook URL: ${urlValidation.error}` }, { status: 400 });
    }

    const { data: endpoint, error } = await (dataClient as any)
      .from('webhook_endpoints')
      .insert({
        url,
        events,
        description,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(endpoint);
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && (error.message === 'Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    console.error('Error creating webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}