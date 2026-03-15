import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSchemaAwareAdminClient } from '@/lib/supabase/admin';
import { requireAdminOrSellerApi } from '@/lib/auth-server';

/**
 * SECURITY FIX (V17): Validate webhook URL to prevent SSRF attacks.
 * This validation was missing in PUT (only existed in POST), allowing bypass.
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
      if (a === 10) {
        return { valid: false, error: 'URL cannot point to private IP addresses (10.x.x.x)' };
      }
      if (a === 172 && b >= 16 && b <= 31) {
        return { valid: false, error: 'URL cannot point to private IP addresses (172.16-31.x.x)' };
      }
      if (a === 192 && b === 168) {
        return { valid: false, error: 'URL cannot point to private IP addresses (192.168.x.x)' };
      }
      if (a === 127) {
        return { valid: false, error: 'URL cannot point to loopback addresses' };
      }
      // 169.254.x.x - link-local, includes AWS/cloud metadata
      if (a === 169 && b === 254) {
        return { valid: false, error: 'URL cannot point to link-local addresses (cloud metadata)' };
      }
      if (a === 0 && b === 0 && c === 0 && d === 0) {
        return { valid: false, error: 'URL cannot point to 0.0.0.0' };
      }
    }

    // Block IPv6 loopback and link-local
    if (hostname.startsWith('[')) {
      const ipv6 = hostname.slice(1, -1).toLowerCase();
      if (ipv6 === '::1' || ipv6.startsWith('fe80:') || ipv6.startsWith('fc') || ipv6.startsWith('fd')) {
        return { valid: false, error: 'URL cannot point to IPv6 loopback or private addresses' };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    await requireAdminOrSellerApi(supabase);
    const dataClient = await createSchemaAwareAdminClient();

    const { error } = await (dataClient as any)
      .from('webhook_endpoints')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && (error.message === 'Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    console.error('Error deleting webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    await requireAdminOrSellerApi(supabase);
    const dataClient = await createSchemaAwareAdminClient();

    const body = await request.json();

    // Allow updating active status, events, url, description
    const updates: any = {};
    if (typeof body.is_active === 'boolean') updates.is_active = body.is_active;

    // SECURITY FIX (V17): Validate URL to prevent SSRF bypass via PUT
    // Previously only POST validated URLs, allowing attackers to create valid webhook
    // then update it to point to internal services (169.254.x.x, localhost, etc.)
    if (body.url) {
      const urlValidation = isValidWebhookUrl(body.url);
      if (!urlValidation.valid) {
        return NextResponse.json(
          { error: urlValidation.error || 'Invalid webhook URL' },
          { status: 400 }
        );
      }
      updates.url = body.url;
    }

    if (body.events) updates.events = body.events;
    if (body.description !== undefined) updates.description = body.description;

    const { data, error } = await (dataClient as any)
      .from('webhook_endpoints')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error instanceof Error && (error.message === 'Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    console.error('Error updating webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}