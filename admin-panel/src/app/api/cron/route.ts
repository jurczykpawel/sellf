/**
 * Universal Cron Endpoint
 *
 * Secured with CRON_SECRET env var. Preferred: Authorization header.
 * URL secret is a fallback for schedulers that don't support custom headers.
 *
 *   # Preferred (secret not in logs):
 *   curl -H "Authorization: Bearer $CRON_SECRET" "https://yourdomain.com/api/cron?job=access-expired"
 *
 *   # Fallback (secret in URL — visible in access logs, avoid in production):
 *   curl "https://yourdomain.com/api/cron?job=access-expired&secret=$CRON_SECRET"
 *
 * Jobs:
 *   access-expired        — dispatch access.expired webhooks for newly expired access records
 *   cleanup-webhook-logs  — delete webhook_logs older than WEBHOOK_LOG_RETENTION_DAYS (default: 30)
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { WebhookService } from '@/lib/services/webhook-service';

// ===== TYPES =====

interface CronJobResult {
  processed: number;
  errors: number;
  details?: string;
}

// ===== SECURITY =====

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron] CRON_SECRET env var is not set — all cron requests will be rejected');
    return false;
  }

  // Prefer Authorization: Bearer <secret> (not logged by proxies/CDNs)
  const authHeader = request.headers.get('Authorization');
  const candidate = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : request.nextUrl.searchParams.get('secret'); // URL fallback

  if (!candidate) return false;

  // Timing-safe comparison (prevents secret length/content oracle attacks)
  try {
    const a = Buffer.from(candidate);
    const b = Buffer.from(cronSecret);
    // timingSafeEqual requires same length — check length separately
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ===== JOB: access-expired =====

async function handleAccessExpired(): Promise<CronJobResult> {
  const supabase = createAdminClient();

  const { data: expiredRows, error } = await supabase
    .from('user_product_access')
    .select(`
      id,
      user_id,
      product_id,
      access_granted_at,
      access_expires_at,
      products:product_id ( id, name, slug, price, currency, icon )
    `)
    .lt('access_expires_at', new Date().toISOString())
    .is('expiry_notified_at', null)
    .limit(100); // Process in batches to avoid timeout

  if (error) {
    console.error('[cron/access-expired] Failed to query expired access:', error);
    throw new Error('DB query failed');
  }

  if (!expiredRows || expiredRows.length === 0) {
    return { processed: 0, errors: 0 };
  }

  // Batch fetch user emails (auth.users is in a separate schema, can't join via PostgREST)
  // Limited to 10 concurrent requests to avoid hitting Supabase Auth rate limits
  const userIds = [...new Set(expiredRows.map(r => r.user_id).filter((id): id is string => id !== null))];
  const emailMap: Record<string, string | null> = {};
  const EMAIL_BATCH_SIZE = 10;
  for (let i = 0; i < userIds.length; i += EMAIL_BATCH_SIZE) {
    await Promise.all(
      userIds.slice(i, i + EMAIL_BATCH_SIZE).map(async (userId) => {
        try {
          const { data: { user } } = await supabase.auth.admin.getUserById(userId);
          emailMap[userId] = user?.email ?? null;
        } catch {
          emailMap[userId] = null;
        }
      })
    );
  }

  let processed = 0;
  let errors = 0;

  for (const row of expiredRows) {
    try {
      // Proxy views lose NOT NULL constraints; assert known non-null columns
      const rowId = row.id!;
      const userId = row.user_id!;
      const productId = row.product_id!;
      const product = row.products as { id: string; name: string; slug: string; price: number; currency: string; icon: string } | null;

      await WebhookService.trigger('access.expired', {
        customer: {
          email: emailMap[userId] ?? null,
          userId,
        },
        product: {
          id: product?.id ?? productId,
          name: product?.name ?? null,
          slug: product?.slug ?? null,
          price: product?.price ?? null,
          currency: product?.currency ?? null,
          icon: product?.icon ?? null,
        },
        access: {
          grantedAt: row.access_granted_at,
          expiredAt: row.access_expires_at,
        },
      });

      // Mark as notified only after successful trigger call
      const { error: updateError } = await supabase
        .from('user_product_access')
        .update({ expiry_notified_at: new Date().toISOString() })
        .eq('id', rowId);

      if (updateError) {
        console.error('[cron/access-expired] Failed to mark notified:', rowId, updateError);
        errors++;
      } else {
        processed++;
      }
    } catch (err) {
      console.error('[cron/access-expired] Error processing row:', row.id, err);
      errors++;
    }
  }

  return { processed, errors };
}

// ===== JOB: cleanup-webhook-logs =====

const raw = Number(process.env.WEBHOOK_LOG_RETENTION_DAYS);
const WEBHOOK_LOG_RETENTION_DAYS = Number.isFinite(raw) && raw > 0 ? raw : 30;

async function handleCleanupWebhookLogs(): Promise<CronJobResult> {
  const supabase = createAdminClient();

  const cutoff = new Date(Date.now() - WEBHOOK_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error, count } = await supabase
    .from('webhook_logs')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff);

  if (error) {
    console.error('[cron/cleanup-webhook-logs] Failed to delete old logs:', error);
    throw new Error('DB delete failed');
  }

  return { processed: count ?? 0, errors: 0, details: `Deleted logs older than ${WEBHOOK_LOG_RETENTION_DAYS}d (cutoff: ${cutoff})` };
}

// ===== JOB REGISTRY =====

const JOB_REGISTRY: Record<string, () => Promise<CronJobResult>> = {
  'access-expired': handleAccessExpired,
  'cleanup-webhook-logs': handleCleanupWebhookLogs,
};

// ===== HANDLER =====

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const job = request.nextUrl.searchParams.get('job');

  if (!job) {
    return NextResponse.json(
      { error: 'Missing ?job= parameter', available: Object.keys(JOB_REGISTRY) },
      { status: 400 }
    );
  }

  const handler = JOB_REGISTRY[job];

  if (!handler) {
    return NextResponse.json(
      { error: `Unknown job: ${job}`, available: Object.keys(JOB_REGISTRY) },
      { status: 400 }
    );
  }

  try {
    const result = await handler();
    return NextResponse.json({ job, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[cron/${job}] Fatal error:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
