/**
 * Universal Cron Endpoint
 *
 * Secured with CRON_SECRET env var. Platform-admin infrastructure only.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "https://yourdomain.com/api/cron?job=access-expired"
 *
 * Jobs:
 *   access-expired             — dispatch access.expired webhooks for newly expired access records
 *   cleanup-webhook-logs       — delete webhook_logs older than WEBHOOK_LOG_RETENTION_DAYS
 *   webhook-deliveries-retry   — process due retries (status=pending_retry) with exp backoff;
 *                                push to DLQ (permanently_failed) after max_attempts
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { createPlatformClient } from '@/lib/supabase/admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { WebhookService } from '@/lib/services/webhook-service';
import { getWebhookQueue } from '@/lib/services/webhook-queue';
import { WebhookDispatcher } from '@/lib/services/webhook-queue/dispatcher';
import { computeNextRetry, hasMoreAttempts } from '@/lib/services/webhook-queue/retry-policy';

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

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const candidate = authHeader.slice(7);
  if (!candidate) return false;

  // Hash both inputs to fixed-length digests so timingSafeEqual never sees a
  // length difference — even the length of the secret stays out of the
  // observable timing channel.
  try {
    const a = createHash('sha256').update(candidate).digest();
    const b = createHash('sha256').update(cronSecret).digest();
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ===== JOB: access-expired =====

async function handleAccessExpired(): Promise<CronJobResult> {
  const platformClient = createPlatformClient();
  const adminClient = createAdminClient();

  // Query expired access records that haven't been notified yet
  const { data: expiredRows, error } = await adminClient
    .from('user_product_access')
    .select(`
      id,
      user_id,
      product_id,
      access_granted_at,
      access_expires_at,
      products!inner (
        name,
        slug,
        price,
        currency,
        icon
      )
    `)
    .not('access_expires_at', 'is', null)
    .lt('access_expires_at', new Date().toISOString())
    .is('expiry_notified_at', null)
    .limit(100);

  if (error) {
    console.error('[cron/access-expired] Failed to query expired access:', error);
    throw new Error('DB query failed');
  }

  if (!expiredRows || expiredRows.length === 0) {
    return { processed: 0, errors: 0 };
  }

  // Batch fetch user emails (auth.users is global)
  const userIds = [...new Set(expiredRows.map((r) => r.user_id))];
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
    const product = row.products as unknown as {
      name: string; slug: string; price: number; currency: string; icon: string;
    };

    try {
      await WebhookService.trigger('access.expired', {
        customer: {
          email: emailMap[row.user_id] ?? null,
          userId: row.user_id,
        },
        product: {
          id: row.product_id,
          name: product.name,
          slug: product.slug,
          price: product.price,
          currency: product.currency,
          icon: product.icon,
        },
        access: {
          grantedAt: row.access_granted_at,
          expiredAt: row.access_expires_at,
        },
      }, adminClient, row.product_id);

      // Mark as notified
      const { error: updateError } = await adminClient
        .from('user_product_access')
        .update({ expiry_notified_at: new Date().toISOString() })
        .eq('id', row.id);

      if (updateError) {
        console.error('[cron/access-expired] Failed to mark notified:', row.id, updateError);
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
  const adminClient = createAdminClient();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - WEBHOOK_LOG_RETENTION_DAYS);

  const { count, error } = await adminClient
    .from('webhook_logs')
    .delete({ count: 'exact' })
    .lt('created_at', cutoffDate.toISOString());

  if (error) {
    console.error('[cron/cleanup-webhook-logs] Failed to cleanup logs:', error);
    throw new Error('DB cleanup failed');
  }

  return {
    processed: count ?? 0,
    errors: 0,
    details: `Deleted logs older than ${WEBHOOK_LOG_RETENTION_DAYS}d`,
  };
}

// ===== JOB: webhook-deliveries-retry =====

const WEBHOOK_RETRY_BATCH = 50;

async function handleWebhookDeliveriesRetry(): Promise<CronJobResult> {
  const adminClient = createAdminClient();
  const queue = getWebhookQueue();

  const due = await queue.pickDue(WEBHOOK_RETRY_BATCH);
  if (due.length === 0) {
    return { processed: 0, errors: 0 };
  }

  let processed = 0;
  let errors = 0;

  await Promise.allSettled(
    due.map(async (delivery) => {
      try {
        const { data: endpoint, error } = await adminClient
          .from('webhook_endpoints')
          .select('id, url, secret, is_active, custom_headers_encrypted')
          .eq('id', delivery.endpointId)
          .single();

        if (error || !endpoint || !endpoint.is_active) {
          await queue.markPermanentlyFailed(delivery.id, {
            ok: false,
            httpStatus: 0,
            responseBody: null,
            errorMessage: 'Endpoint missing or inactive',
            durationMs: 0,
          });
          errors++;
          return;
        }

        const nextAttempt = delivery.attemptCount + 1;
        const result = await WebhookDispatcher.dispatch(
          // Carry the encrypted custom headers into the slice so retried
          // deliveries re-apply them — without this they were dropped, sending
          // unauthenticated (e.g. → 401 → DLQ, PII posted without auth).
          { id: endpoint.id, url: endpoint.url, secret: endpoint.secret, custom_headers_encrypted: endpoint.custom_headers_encrypted },
          delivery.eventType,
          delivery.payload,
          { attemptCount: nextAttempt },
        );

        if (result.ok) {
          await queue.markDelivered(delivery.id, result);
        } else if (!hasMoreAttempts(nextAttempt, delivery.maxAttempts)) {
          await queue.markPermanentlyFailed(delivery.id, result);
        } else {
          await queue.markFailed(delivery.id, result, computeNextRetry(nextAttempt));
        }
        processed++;
      } catch (err) {
        console.error('[cron/webhook-deliveries-retry] processing error', delivery.id, err);
        errors++;
      }
    }),
  );

  return { processed, errors };
}

// ===== JOB REGISTRY =====

const JOB_REGISTRY: Record<string, () => Promise<CronJobResult>> = {
  'access-expired': handleAccessExpired,
  'cleanup-webhook-logs': handleCleanupWebhookLogs,
  'webhook-deliveries-retry': handleWebhookDeliveriesRetry,
};

// ===== HANDLER =====

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const credential = request.headers.get('Authorization')?.slice(7) ?? '';
  const credentialFingerprint = createHash('sha256').update(credential).digest('hex').slice(0, 16);
  const invocationAllowed = await checkRateLimitForIdentifier(
    'cron_invoke',
    60,
    1,
    `cron:${credentialFingerprint}`,
  );
  if (!invocationAllowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
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
    console.error(`[cron/${job}] Fatal error:`, err);
    return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
  }
}
