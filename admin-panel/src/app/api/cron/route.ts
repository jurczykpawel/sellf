/**
 * Universal Cron Endpoint
 *
 * Secured with CRON_SECRET env var. Platform-admin infrastructure only.
 * Sellers don't interact with cron — it runs across all schemas automatically.
 *
 *   # Preferred (secret not in logs):
 *   curl -H "Authorization: Bearer $CRON_SECRET" "https://yourdomain.com/api/cron?job=access-expired"
 *
 *   # Fallback (secret in URL — visible in access logs, avoid in production):
 *   curl "https://yourdomain.com/api/cron?job=access-expired&secret=$CRON_SECRET"
 *
 * Jobs:
 *   access-expired        — dispatch access.expired webhooks for newly expired access records (ALL schemas)
 *   cleanup-webhook-logs  — delete webhook_logs older than WEBHOOK_LOG_RETENTION_DAYS (ALL schemas)
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createPlatformClient } from '@/lib/supabase/admin';
import { createSellerAdminClient } from '@/lib/marketplace/seller-client';
import { isValidSellerSchema } from '@/lib/marketplace/tenant';
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
  const platformClient = createPlatformClient();

  // Single query across ALL seller schemas via SQL function
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: expiredRows, error } = await (platformClient as any)
    .rpc('get_expired_access_all_schemas', { p_limit: 100 }) as { data: any[] | null; error: any };

  if (error) {
    console.error('[cron/access-expired] Failed to query expired access:', error);
    throw new Error('DB query failed');
  }

  if (!expiredRows || expiredRows.length === 0) {
    return { processed: 0, errors: 0 };
  }

  // Batch fetch user emails (auth.users is global)
  const userIds = [...new Set(expiredRows.map((r: { user_id: string }) => r.user_id))];
  const emailMap: Record<string, string | null> = {};
  const EMAIL_BATCH_SIZE = 10;
  for (let i = 0; i < userIds.length; i += EMAIL_BATCH_SIZE) {
    await Promise.all(
      userIds.slice(i, i + EMAIL_BATCH_SIZE).map(async (userId) => {
        try {
          const { data: { user } } = await platformClient.auth.admin.getUserById(userId);
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
      // Get schema-scoped client for webhook delivery to correct seller's endpoints
      let webhookClient;
      if (row.seller_schema && isValidSellerSchema(row.seller_schema)) {
        webhookClient = createSellerAdminClient(row.seller_schema);
      } else {
        webhookClient = platformClient;
      }

      await WebhookService.trigger('access.expired', {
        customer: {
          email: emailMap[row.user_id] ?? null,
          userId: row.user_id,
        },
        product: {
          id: row.product_id,
          name: row.product_name,
          slug: row.product_slug,
          price: row.product_price,
          currency: row.product_currency,
          icon: row.product_icon,
        },
        access: {
          grantedAt: row.access_granted_at,
          expiredAt: row.access_expires_at,
        },
        seller: {
          slug: row.seller_slug,
          schema: row.seller_schema,
        },
      }, webhookClient);

      // Mark as notified in the correct schema
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (platformClient as any)
        .rpc('mark_access_expiry_notified', {
          p_schema: row.seller_schema,
          p_access_id: row.access_id,
        });

      if (updateError) {
        console.error('[cron/access-expired] Failed to mark notified:', row.access_id, updateError);
        errors++;
      } else {
        processed++;
      }
    } catch (err) {
      console.error('[cron/access-expired] Error processing row:', row.access_id, err);
      errors++;
    }
  }

  return { processed, errors };
}

// ===== JOB: cleanup-webhook-logs =====

const raw = Number(process.env.WEBHOOK_LOG_RETENTION_DAYS);
const WEBHOOK_LOG_RETENTION_DAYS = Number.isFinite(raw) && raw > 0 ? raw : 30;

async function handleCleanupWebhookLogs(): Promise<CronJobResult> {
  const platformClient = createPlatformClient();

  // Single call that cleans ALL seller schemas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: deletedCount, error } = await (platformClient as any)
    .rpc('cleanup_webhook_logs_all_schemas', { p_retention_days: WEBHOOK_LOG_RETENTION_DAYS }) as { data: number | null; error: any };

  if (error) {
    console.error('[cron/cleanup-webhook-logs] Failed to cleanup logs:', error);
    throw new Error('DB cleanup failed');
  }

  return {
    processed: deletedCount ?? 0,
    errors: 0,
    details: `Deleted logs older than ${WEBHOOK_LOG_RETENTION_DAYS}d from all seller schemas`,
  };
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
