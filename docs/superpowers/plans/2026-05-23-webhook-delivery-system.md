# Webhook Delivery System (DLQ + Retry + Replay) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic retry with exponential backoff + DLQ pattern + Admin UI for failed deliveries with replay button, on top of the existing `seller_main.webhook_logs` table.

**Architecture:** Per-row state machine on `webhook_logs` (extended with retry columns). New `WebhookDispatcher` extracts pure HTTP-call logic from `WebhookService`. New `IWebhookDeliveryQueue` interface with Supabase implementation (uses `FOR UPDATE SKIP LOCKED` via SQL function for atomic claim+lease). Worker exposed as a cron job. Admin UI page lists DLQ rows with Replay/Cancel/Force-now actions. Factory + SQS stub keeps the seam clear for a future swap.

**Tech Stack:** Next.js 16 App Router, Supabase (PG 15), TypeScript strict, Vitest (unit + API), Playwright (E2E), Bun.

---

## Important corrections to the source task spec

The source task at `vault/personal/_db-tasks/sellf-webhook-delivery-system.md` had three incorrect assumptions verified against the current code:

1. **`webhook_log_status` is NOT a Postgres enum** — it is a `TEXT` column with a `CHECK` constraint (`supabase/migrations/20250103000000_features.sql:184`). Migration must DROP+ADD the constraint, not `ALTER TYPE`.
2. **JOB_REGISTRY has no `intervalMinutes`** — it is `Record<string, () => Promise<CronJobResult>>` (`admin-panel/src/app/api/cron/route.ts:185`). External cron handles scheduling.
3. **Tests live under `admin-panel/tests/`** (not `tests/` at repo root). E2E specs go in `admin-panel/tests/*.spec.ts`, Vitest unit in `admin-panel/tests/unit/...`, Vitest API in `admin-panel/tests/api/...`.

These corrections are baked into the file paths and code below.

## File map

```
supabase/
└── migrations/
    └── 20260523<TS>_webhook_delivery_retry.sql                  # NEW (single migration)

admin-panel/src/
├── lib/
│   ├── services/
│   │   ├── webhook-service.ts                                   # REFACTOR: delegates to dispatcher + queue
│   │   └── webhook-queue/                                       # NEW dir
│   │       ├── types.ts                                         # NEW: IWebhookDeliveryQueue, DTOs
│   │       ├── retry-policy.ts                                  # NEW: exp backoff table + helpers
│   │       ├── dispatcher.ts                                    # NEW: extracted HTTP dispatch (no DB)
│   │       ├── supabase-queue.ts                                # NEW: default impl
│   │       ├── sqs-queue.ts                                     # NEW: stub (throws NotImplemented)
│   │       └── index.ts                                         # NEW: factory + barrel
│   └── api/
│       └── api-keys.ts                                          # unchanged (existing scopes used)
├── app/
│   ├── api/
│   │   ├── cron/route.ts                                        # EXTEND: add webhook-deliveries-retry job
│   │   └── v1/webhooks/logs/[logId]/
│   │       ├── retry/route.ts                                   # unchanged (legacy BC)
│   │       └── replay/route.ts                                  # NEW
│   └── [locale]/dashboard/webhooks/deliveries/
│       └── page.tsx                                             # NEW
├── components/
│   ├── WebhookDeliveriesPageContent.tsx                         # NEW (client)
│   ├── WebhookFailuresPanel.tsx                                 # EXTEND: "View all DLQ" link
│   └── webhooks/
│       └── WebhookLogsTable.tsx                                 # EXTEND: pending_retry/permanently_failed actions
├── hooks/
│   └── useWebhookDeliveries.ts                                  # NEW
├── types/
│   └── webhooks.ts                                              # EXTEND: status union + new fields
└── messages/
    ├── en.json                                                  # EXTEND: new i18n keys
    └── pl.json                                                  # EXTEND: new i18n keys

admin-panel/tests/
├── unit/lib/services/webhook-queue/
│   ├── retry-policy.test.ts                                     # NEW
│   ├── dispatcher.test.ts                                       # NEW
│   └── factory.test.ts                                          # NEW
├── api/
│   └── webhook-deliveries.test.ts                               # NEW
├── webhook-dlq-replay.spec.ts                                   # NEW (Playwright E2E)
└── webhook-retry-concurrent.spec.ts                             # NEW (Playwright E2E)

docs/
└── webhooks.md                                                  # NEW or EXTEND: retry policy + Replay UI
```

## Architecture decisions

### State machine (refined from task spec)

Each `webhook_logs` row is one delivery. New code never produces legacy `'failed'`; instead, a failed first attempt lands as `'pending_retry'` (or `'permanently_failed'` if `max_attempts == 1`, unreachable with default 5). Old `'failed'` rows from before this feature remain as-is for backward compat (legacy filter chip handles them).

```
[INSERT after first dispatch]
  → success                                  (dispatch ok)
  → pending_retry                            (fail, attempt<max, next_retry_at = now + 1m)
  → permanently_failed                       (fail, attempt>=max — only if max=1)

pending_retry --(worker, ok)-->        success
pending_retry --(worker, fail, <max)-->  pending_retry [attempt_count++, exp backoff]
pending_retry --(worker, fail, >=max)--> permanently_failed [failed_permanently_at=now]
permanently_failed --(admin Replay)--> pending_retry [attempt_count=0, next_retry_at=now, failed_permanently_at=null]
pending_retry --(admin Cancel)-->     permanently_failed [failed_permanently_at=now]
pending_retry --(admin Force now)-->  pending_retry [next_retry_at=now]
* --(admin Archive)-->                archived
```

Retry delays (capped at index 4): `[1m, 5m, 30m, 2h, 12h]` — total ~15h.

### Concurrent worker safety (atomic claim + lease)

Workers compete via a SQL function `seller_main.pick_due_webhook_deliveries(p_limit int)` that uses `FOR UPDATE SKIP LOCKED` in a single statement to atomically claim rows AND advance `next_retry_at = NOW() + interval '60 seconds'` (lease). If the worker crashes mid-dispatch, the lease expires after 60s and a future worker can re-pick. Workers complete within ~5s typically (HTTP timeout) so the lease only matters under failure.

### Interface design

```typescript
export interface IWebhookDeliveryQueue {
  recordFirstAttempt(input: FirstAttemptInput): Promise<{ deliveryId: string; willRetry: boolean }>;
  pickDue(limit: number): Promise<DueDelivery[]>;
  markDelivered(deliveryId: string, result: AttemptResult): Promise<void>;
  markFailed(deliveryId: string, result: AttemptResult, nextRetryAt: Date): Promise<void>;
  markPermanentlyFailed(deliveryId: string, result: AttemptResult): Promise<void>;
  replay(deliveryId: string): Promise<void>;
  forceRetryNow(deliveryId: string): Promise<void>;
  cancel(deliveryId: string): Promise<void>;
}
```

Splitting `WebhookDispatcher` (HTTP I/O) from `IWebhookDeliveryQueue` (state) gives each module a single responsibility (SOLID-SRP) and lets the SQS impl reuse the same `WebhookDispatcher` later.

---

## Task 1: Migration — add retry columns + status values + indexes + pick_due function

**Files:**
- Create: `supabase/migrations/20260523150000_webhook_delivery_retry.sql`
- Modify: `admin-panel/src/types/database.ts` (regenerate, do not hand-edit)

- [ ] **Step 1: Find current CHECK constraint name**

```bash
docker exec -i supabase_db_sellf psql -U postgres -c \
  "SELECT conname FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid JOIN pg_namespace n ON t.relnamespace = n.oid WHERE n.nspname = 'seller_main' AND t.relname = 'webhook_logs' AND contype = 'c';"
```
Expected: `webhook_logs_status_check` (record exact name for the migration).

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260523150000_webhook_delivery_retry.sql`:

```sql
-- Add retry/DLQ state columns.
ALTER TABLE seller_main.webhook_logs
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_attempts int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_permanently_at timestamptz;

-- Extend status CHECK constraint.
ALTER TABLE seller_main.webhook_logs DROP CONSTRAINT IF EXISTS webhook_logs_status_check;
ALTER TABLE seller_main.webhook_logs ADD CONSTRAINT webhook_logs_status_check
  CHECK (status IN ('success', 'failed', 'retried', 'archived', 'pending_retry', 'permanently_failed'));

-- Worker index: scan due retries quickly.
CREATE INDEX IF NOT EXISTS idx_webhook_logs_pending_retry
  ON seller_main.webhook_logs (next_retry_at)
  WHERE status = 'pending_retry';

-- DLQ UI index: newest permanently_failed first.
CREATE INDEX IF NOT EXISTS idx_webhook_logs_dlq
  ON seller_main.webhook_logs (failed_permanently_at DESC)
  WHERE status = 'permanently_failed';

-- Atomic claim + lease for concurrent workers.
-- Picks up to p_limit rows with status='pending_retry' AND next_retry_at <= NOW(),
-- locks them with FOR UPDATE SKIP LOCKED, and advances next_retry_at to NOW() + 60s
-- so concurrent workers don't re-pick. The lease auto-expires if the worker dies.
CREATE OR REPLACE FUNCTION seller_main.pick_due_webhook_deliveries(p_limit int)
RETURNS TABLE (
  id uuid,
  endpoint_id uuid,
  event_type text,
  payload jsonb,
  attempt_count int,
  max_attempts int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lease_until timestamptz := NOW() + interval '60 seconds';
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT wl.id
    FROM seller_main.webhook_logs wl
    WHERE wl.status = 'pending_retry'
      AND wl.next_retry_at IS NOT NULL
      AND wl.next_retry_at <= NOW()
    ORDER BY wl.next_retry_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  leased AS (
    UPDATE seller_main.webhook_logs wl
    SET next_retry_at = lease_until
    FROM due
    WHERE wl.id = due.id
    RETURNING wl.id, wl.endpoint_id, wl.event_type, wl.payload, wl.attempt_count, wl.max_attempts
  )
  SELECT leased.id, leased.endpoint_id, leased.event_type, leased.payload, leased.attempt_count, leased.max_attempts
  FROM leased;
END;
$$;

REVOKE EXECUTE ON FUNCTION seller_main.pick_due_webhook_deliveries(int) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION seller_main.pick_due_webhook_deliveries(int) TO service_role;

-- Recreate the public.webhook_logs view to include new columns (existing view is
-- security_invoker = on; CREATE OR REPLACE preserves grants).
CREATE OR REPLACE VIEW public.webhook_logs WITH (security_invoker = on) AS
  SELECT * FROM seller_main.webhook_logs;

COMMENT ON COLUMN seller_main.webhook_logs.attempt_count IS 'Number of delivery attempts so far (1 = first attempt completed)';
COMMENT ON COLUMN seller_main.webhook_logs.max_attempts IS 'Maximum delivery attempts before going to DLQ';
COMMENT ON COLUMN seller_main.webhook_logs.next_retry_at IS 'When the worker should attempt next delivery (also used as in-flight lease)';
COMMENT ON COLUMN seller_main.webhook_logs.failed_permanently_at IS 'Set when delivery enters DLQ (status=permanently_failed)';
COMMENT ON FUNCTION seller_main.pick_due_webhook_deliveries(int) IS 'Atomically claims due retries with FOR UPDATE SKIP LOCKED + 60s lease';
```

- [ ] **Step 3: Apply migration locally**

```bash
cd /Users/pavvel/workspace/projects/sellf/.claude/worktrees/webhook-dlq
npx supabase db reset
```
Expected: completes without errors, all migrations apply.

- [ ] **Step 4: Verify columns + constraint**

```bash
docker exec -i supabase_db_sellf psql -U postgres -c \
  "\\d+ seller_main.webhook_logs" | grep -E "attempt_count|max_attempts|next_retry_at|failed_permanently_at|pending_retry|permanently_failed"
```
Expected: shows the 4 new columns and the extended CHECK constraint.

- [ ] **Step 5: Verify function**

```bash
docker exec -i supabase_db_sellf psql -U postgres -c \
  "SELECT * FROM seller_main.pick_due_webhook_deliveries(10);"
```
Expected: returns 0 rows (no pending retries yet), no errors.

- [ ] **Step 6: Regenerate TypeScript types**

```bash
cd /Users/pavvel/workspace/projects/sellf/.claude/worktrees/webhook-dlq
npx supabase gen types typescript --local > admin-panel/src/types/database.ts
```
Expected: file updated; `webhook_logs` row type includes the 4 new columns.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260523150000_webhook_delivery_retry.sql admin-panel/src/types/database.ts
git commit -m "feat(webhooks): add retry/DLQ columns and atomic claim function"
```

---

## Task 2: Retry policy module (TDD, pure logic, no I/O)

**Files:**
- Create: `admin-panel/src/lib/services/webhook-queue/retry-policy.ts`
- Test: `admin-panel/tests/unit/lib/services/webhook-queue/retry-policy.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `admin-panel/tests/unit/lib/services/webhook-queue/retry-policy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  computeNextRetry,
  hasMoreAttempts,
  RETRY_DELAYS_SECONDS,
  DEFAULT_MAX_ATTEMPTS,
} from '@/lib/services/webhook-queue/retry-policy';

describe('retry-policy', () => {
  const FIXED_NOW = new Date('2026-05-23T12:00:00.000Z');

  it('exposes the documented backoff sequence: 1m, 5m, 30m, 2h, 12h', () => {
    expect(RETRY_DELAYS_SECONDS).toEqual([60, 300, 1800, 7200, 43200]);
  });

  it('default max attempts equals delay table length', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(RETRY_DELAYS_SECONDS.length);
  });

  it.each([
    [1, 60],     // after 1st attempt, wait 60s
    [2, 300],    // after 2nd attempt, wait 5m
    [3, 1800],   // after 3rd attempt, wait 30m
    [4, 7200],   // after 4th attempt, wait 2h
    [5, 43200],  // after 5th attempt, wait 12h
  ])('computeNextRetry(%i) returns now + %is', (attempt, secs) => {
    const next = computeNextRetry(attempt, FIXED_NOW);
    expect(next.getTime() - FIXED_NOW.getTime()).toBe(secs * 1000);
  });

  it('caps the delay at the last entry for attempts beyond the table', () => {
    const next = computeNextRetry(99, FIXED_NOW);
    expect(next.getTime() - FIXED_NOW.getTime()).toBe(43200 * 1000);
  });

  it('clamps attempts < 1 to the first delay slot', () => {
    const next = computeNextRetry(0, FIXED_NOW);
    expect(next.getTime() - FIXED_NOW.getTime()).toBe(60 * 1000);
  });

  it('hasMoreAttempts true when below max', () => {
    expect(hasMoreAttempts(1, 5)).toBe(true);
    expect(hasMoreAttempts(4, 5)).toBe(true);
  });

  it('hasMoreAttempts false at or above max', () => {
    expect(hasMoreAttempts(5, 5)).toBe(false);
    expect(hasMoreAttempts(6, 5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd admin-panel
bunx vitest run tests/unit/lib/services/webhook-queue/retry-policy.test.ts
```
Expected: FAIL — cannot find module `@/lib/services/webhook-queue/retry-policy`.

- [ ] **Step 3: Write the minimal implementation**

Create `admin-panel/src/lib/services/webhook-queue/retry-policy.ts`:

```typescript
export const RETRY_DELAYS_SECONDS: readonly number[] = [60, 300, 1800, 7200, 43200];
export const DEFAULT_MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length;

export function computeNextRetry(attemptCount: number, now: Date = new Date()): Date {
  const idx = Math.min(
    Math.max(attemptCount - 1, 0),
    RETRY_DELAYS_SECONDS.length - 1,
  );
  return new Date(now.getTime() + RETRY_DELAYS_SECONDS[idx] * 1000);
}

export function hasMoreAttempts(attemptCount: number, maxAttempts: number): boolean {
  return attemptCount < maxAttempts;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bunx vitest run tests/unit/lib/services/webhook-queue/retry-policy.test.ts
```
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/lib/services/webhook-queue/retry-policy.ts \
        admin-panel/tests/unit/lib/services/webhook-queue/retry-policy.test.ts
git commit -m "feat(webhooks): retry policy with exp backoff"
```

---

## Task 3: Queue interface types (no logic, no tests yet)

**Files:**
- Create: `admin-panel/src/lib/services/webhook-queue/types.ts`

- [ ] **Step 1: Write the types module**

Create `admin-panel/src/lib/services/webhook-queue/types.ts`:

```typescript
import type { WebhookEventType } from '@/lib/validations/webhook';

export interface AttemptResult {
  ok: boolean;
  httpStatus: number;
  responseBody: string | null;
  errorMessage: string | null;
  durationMs: number;
}

export interface FirstAttemptInput {
  endpointId: string;
  eventType: WebhookEventType | string;
  payload: unknown;
  result: AttemptResult;
  maxAttempts?: number;
}

export interface DueDelivery {
  id: string;
  endpointId: string;
  eventType: string;
  payload: unknown;
  attemptCount: number;
  maxAttempts: number;
}

export interface RecordedDelivery {
  deliveryId: string;
  willRetry: boolean;
}

export interface IWebhookDeliveryQueue {
  recordFirstAttempt(input: FirstAttemptInput): Promise<RecordedDelivery>;
  pickDue(limit: number): Promise<DueDelivery[]>;
  markDelivered(deliveryId: string, result: AttemptResult): Promise<void>;
  markFailed(deliveryId: string, result: AttemptResult, nextRetryAt: Date): Promise<void>;
  markPermanentlyFailed(deliveryId: string, result: AttemptResult): Promise<void>;
  replay(deliveryId: string): Promise<void>;
  forceRetryNow(deliveryId: string): Promise<void>;
  cancel(deliveryId: string): Promise<void>;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd admin-panel
bun run typecheck
```
Expected: PASS (no errors introduced).

- [ ] **Step 3: Commit**

```bash
git add admin-panel/src/lib/services/webhook-queue/types.ts
git commit -m "feat(webhooks): queue abstraction types"
```

---

## Task 4: WebhookDispatcher — extract HTTP-call logic (TDD)

This task moves the SSRF-safe HTTP fetch + HMAC signing out of `WebhookService` so both the immediate-dispatch path and the worker share one implementation. No DB writes happen here; the dispatcher returns an `AttemptResult`.

**Files:**
- Create: `admin-panel/src/lib/services/webhook-queue/dispatcher.ts`
- Test: `admin-panel/tests/unit/lib/services/webhook-queue/dispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `admin-panel/tests/unit/lib/services/webhook-queue/dispatcher.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('undici', () => ({
  fetch: vi.fn(),
}));
vi.mock('@/lib/security/safe-fetch', () => ({
  getSsrfSafeAgent: vi.fn(() => undefined),
}));
vi.mock('@/lib/validations/webhook', () => ({
  validateWebhookUrlAsync: vi.fn(async () => ({ valid: true })),
}));

import { fetch as undiciFetch } from 'undici';
import { validateWebhookUrlAsync } from '@/lib/validations/webhook';
import { WebhookDispatcher } from '@/lib/services/webhook-queue/dispatcher';

const endpoint = {
  id: 'ep_1',
  url: 'https://example.com/hook',
  secret: 'whsec_test_abc',
};
const payload = { event: 'test.event', timestamp: '2026-05-23T12:00:00Z', data: { foo: 'bar' } };

describe('WebhookDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signs payload with HMAC-SHA256 and includes required headers', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });

    const [, init] = (undiciFetch as any).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['X-Sellf-Event']).toBe('test.event');
    expect(init.headers['X-Sellf-Signature']).toMatch(/^[a-f0-9]{64}$/);
    expect(init.headers['X-Sellf-Timestamp']).toBe('2026-05-23T12:00:00Z');
    expect(init.redirect).toBe('error');
  });

  it('adds X-Sellf-Retry-Attempt header when attemptCount > 1', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 3 });
    const [, init] = (undiciFetch as any).mock.calls[0];
    expect(init.headers['X-Sellf-Retry-Attempt']).toBe('3');
  });

  it('omits X-Sellf-Retry-Attempt header on first attempt', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    const [, init] = (undiciFetch as any).mock.calls[0];
    expect(init.headers['X-Sellf-Retry-Attempt']).toBeUndefined();
  });

  it('returns ok=true and httpStatus on 2xx', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => 'hello' });
    const result = await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.responseBody).toBe('hello');
    expect(result.errorMessage).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok=false and HTTP <status> error on non-2xx', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: false, status: 503, text: async () => 'down' });
    const result = await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(503);
    expect(result.errorMessage).toBe('HTTP 503');
  });

  it('rejects URL when SSRF guard fails (no fetch call)', async () => {
    (validateWebhookUrlAsync as any).mockResolvedValueOnce({ valid: false, error: 'private IP' });
    const result = await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(0);
    expect(result.errorMessage).toMatch(/private IP/);
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it('caps responseBody at 5000 chars', async () => {
    (undiciFetch as any).mockResolvedValue({ ok: true, status: 200, text: async () => 'x'.repeat(10000) });
    const result = await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    expect(result.responseBody!.length).toBe(5000);
  });

  it('returns httpStatus=408 on AbortError (timeout)', async () => {
    const err: any = new Error('aborted');
    err.name = 'AbortError';
    (undiciFetch as any).mockRejectedValue(err);
    const result = await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    expect(result.httpStatus).toBe(408);
    expect(result.errorMessage).toMatch(/timed out/i);
  });

  it('returns httpStatus=0 on generic network error', async () => {
    (undiciFetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await WebhookDispatcher.dispatch(endpoint, 'test.event', payload, { attemptCount: 1 });
    expect(result.httpStatus).toBe(0);
    expect(result.errorMessage).toBe('ECONNREFUSED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run tests/unit/lib/services/webhook-queue/dispatcher.test.ts
```
Expected: FAIL — cannot find `dispatcher` module.

- [ ] **Step 3: Implement the dispatcher**

Create `admin-panel/src/lib/services/webhook-queue/dispatcher.ts`:

```typescript
import crypto from 'crypto';
import { fetch as undiciFetch } from 'undici';
import { getSsrfSafeAgent } from '@/lib/security/safe-fetch';
import { validateWebhookUrlAsync } from '@/lib/validations/webhook';
import type { AttemptResult } from './types';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BODY_CHARS = 5000;

interface EndpointSlice {
  id: string;
  url: string;
  secret: string;
}

interface DispatchOptions {
  attemptCount: number;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

export class WebhookDispatcher {
  static async dispatch(
    endpoint: EndpointSlice,
    event: string,
    payload: { event: string; timestamp?: string; data: unknown } | unknown,
    options: DispatchOptions,
  ): Promise<AttemptResult> {
    const payloadString = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', endpoint.secret)
      .update(payloadString)
      .digest('hex');
    const timestamp =
      (typeof payload === 'object' && payload && 'timestamp' in payload && (payload as { timestamp?: string }).timestamp) ||
      new Date().toISOString();

    const startTime = Date.now();

    try {
      const guard = await validateWebhookUrlAsync(endpoint.url);
      if (!guard.valid) {
        return {
          ok: false,
          httpStatus: 0,
          responseBody: null,
          errorMessage: `Webhook URL rejected: ${guard.error || 'failed validation'}`,
          durationMs: Date.now() - startTime,
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Sellf-Event': event,
        'X-Sellf-Signature': signature,
        'X-Sellf-Timestamp': timestamp,
        ...(options.extraHeaders ?? {}),
      };
      if (options.attemptCount > 1) {
        headers['X-Sellf-Retry-Attempt'] = String(options.attemptCount);
      }

      const response = await undiciFetch(endpoint.url, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: controller.signal,
        redirect: 'error',
        dispatcher: getSsrfSafeAgent(),
      });

      clearTimeout(timeoutId);

      const text = await response.text();
      const trimmed = text ? text.substring(0, MAX_RESPONSE_BODY_CHARS) : '';

      return {
        ok: response.ok,
        httpStatus: response.status,
        responseBody: trimmed,
        errorMessage: response.ok ? null : `HTTP ${response.status}`,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        return {
          ok: false,
          httpStatus: 408,
          responseBody: null,
          errorMessage: 'Request timed out (5s)',
          durationMs: Date.now() - startTime,
        };
      }
      return {
        ok: false,
        httpStatus: 0,
        responseBody: null,
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bunx vitest run tests/unit/lib/services/webhook-queue/dispatcher.test.ts
```
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/lib/services/webhook-queue/dispatcher.ts \
        admin-panel/tests/unit/lib/services/webhook-queue/dispatcher.test.ts
git commit -m "feat(webhooks): extract HTTP dispatcher with retry header"
```

---

## Task 5: SupabaseWebhookQueue — state machine (TDD with real local Supabase)

**Files:**
- Create: `admin-panel/src/lib/services/webhook-queue/supabase-queue.ts`
- Test: `admin-panel/tests/api/webhook-deliveries.test.ts` (uses real local Supabase via `tests/api/setup.ts`)

- [ ] **Step 1: Write the failing test**

Create `admin-panel/tests/api/webhook-deliveries.test.ts`:

```typescript
/**
 * API Integration: SupabaseWebhookQueue state machine.
 * Hits the real local Supabase. Run with `bun run test:api`.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { supabase } from './setup';
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';
import type { AttemptResult } from '@/lib/services/webhook-queue/types';
import { computeNextRetry, DEFAULT_MAX_ATTEMPTS } from '@/lib/services/webhook-queue/retry-policy';

const queue = new SupabaseWebhookQueue(supabase);

let endpointId: string;
const createdDeliveryIds: string[] = [];

const okResult: AttemptResult = {
  ok: true, httpStatus: 200, responseBody: 'ok', errorMessage: null, durationMs: 12,
};
const failResult: AttemptResult = {
  ok: false, httpStatus: 503, responseBody: 'down', errorMessage: 'HTTP 503', durationMs: 25,
};

beforeAll(async () => {
  const random = Math.random().toString(36).slice(2, 8);
  const { data: endpoint, error } = await supabase
    .from('webhook_endpoints')
    .insert({
      url: `https://example.com/dlq-${random}`,
      events: ['test.event'],
      description: 'queue test',
      is_active: true,
      secret: `whsec_test_${random}`,
    })
    .select('id')
    .single();
  if (error) throw error;
  endpointId = endpoint.id;
});

afterEach(async () => {
  if (createdDeliveryIds.length > 0) {
    await supabase.from('webhook_logs').delete().in('id', createdDeliveryIds);
    createdDeliveryIds.length = 0;
  }
});

async function fetchRow(id: string) {
  const { data, error } = await supabase
    .from('webhook_logs')
    .select('id, status, attempt_count, max_attempts, next_retry_at, failed_permanently_at, http_status, response_body, error_message')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

describe('SupabaseWebhookQueue.recordFirstAttempt', () => {
  it('records a successful first attempt as status=success with attempt_count=1', async () => {
    const { deliveryId, willRetry } = await queue.recordFirstAttempt({
      endpointId, eventType: 'test.event', payload: { foo: 'bar' }, result: okResult,
    });
    createdDeliveryIds.push(deliveryId);
    expect(willRetry).toBe(false);
    const row = await fetchRow(deliveryId);
    expect(row.status).toBe('success');
    expect(row.attempt_count).toBe(1);
    expect(row.max_attempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(row.next_retry_at).toBeNull();
    expect(row.failed_permanently_at).toBeNull();
    expect(row.http_status).toBe(200);
  });

  it('records a failed first attempt with retries remaining as status=pending_retry with next_retry_at ~ now+1m', async () => {
    const { deliveryId, willRetry } = await queue.recordFirstAttempt({
      endpointId, eventType: 'test.event', payload: { foo: 'bar' }, result: failResult,
    });
    createdDeliveryIds.push(deliveryId);
    expect(willRetry).toBe(true);
    const row = await fetchRow(deliveryId);
    expect(row.status).toBe('pending_retry');
    expect(row.attempt_count).toBe(1);
    expect(row.next_retry_at).not.toBeNull();
    const delta = new Date(row.next_retry_at!).getTime() - Date.now();
    expect(delta).toBeGreaterThan(50_000);  // ~60s ± slack
    expect(delta).toBeLessThan(70_000);
  });

  it('records a failed first attempt with maxAttempts=1 as status=permanently_failed with failed_permanently_at', async () => {
    const { deliveryId, willRetry } = await queue.recordFirstAttempt({
      endpointId, eventType: 'test.event', payload: { foo: 'bar' }, result: failResult, maxAttempts: 1,
    });
    createdDeliveryIds.push(deliveryId);
    expect(willRetry).toBe(false);
    const row = await fetchRow(deliveryId);
    expect(row.status).toBe('permanently_failed');
    expect(row.failed_permanently_at).not.toBeNull();
    expect(row.next_retry_at).toBeNull();
  });
});

describe('SupabaseWebhookQueue.pickDue', () => {
  it('returns deliveries with status=pending_retry and next_retry_at <= now', async () => {
    const past = new Date(Date.now() - 5_000).toISOString();
    const { data: row } = await supabase.from('webhook_logs').insert({
      endpoint_id: endpointId, event_type: 'test.event', payload: { x: 1 },
      status: 'pending_retry', attempt_count: 1, max_attempts: 5, next_retry_at: past,
      http_status: 503, duration_ms: 0,
    }).select('id').single();
    createdDeliveryIds.push(row!.id);
    const due = await queue.pickDue(10);
    expect(due.map((d) => d.id)).toContain(row!.id);
  });

  it('does not return future deliveries', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { data: row } = await supabase.from('webhook_logs').insert({
      endpoint_id: endpointId, event_type: 'test.event', payload: { x: 2 },
      status: 'pending_retry', attempt_count: 1, max_attempts: 5, next_retry_at: future,
      http_status: 503, duration_ms: 0,
    }).select('id').single();
    createdDeliveryIds.push(row!.id);
    const due = await queue.pickDue(10);
    expect(due.map((d) => d.id)).not.toContain(row!.id);
  });

  it('leases picked rows so a subsequent pickDue does not return them', async () => {
    const past = new Date(Date.now() - 5_000).toISOString();
    const { data: row } = await supabase.from('webhook_logs').insert({
      endpoint_id: endpointId, event_type: 'test.event', payload: { x: 3 },
      status: 'pending_retry', attempt_count: 1, max_attempts: 5, next_retry_at: past,
      http_status: 503, duration_ms: 0,
    }).select('id').single();
    createdDeliveryIds.push(row!.id);
    const first = await queue.pickDue(10);
    expect(first.map((d) => d.id)).toContain(row!.id);
    const second = await queue.pickDue(10);
    expect(second.map((d) => d.id)).not.toContain(row!.id);
  });
});

describe('SupabaseWebhookQueue worker transitions', () => {
  async function insertPending(): Promise<string> {
    const past = new Date(Date.now() - 5_000).toISOString();
    const { data: row } = await supabase.from('webhook_logs').insert({
      endpoint_id: endpointId, event_type: 'test.event', payload: { x: Math.random() },
      status: 'pending_retry', attempt_count: 1, max_attempts: 5, next_retry_at: past,
      http_status: 503, duration_ms: 0,
    }).select('id').single();
    createdDeliveryIds.push(row!.id);
    return row!.id;
  }

  it('markDelivered → status=success, attempt_count++', async () => {
    const id = await insertPending();
    await queue.markDelivered(id, okResult);
    const row = await fetchRow(id);
    expect(row.status).toBe('success');
    expect(row.attempt_count).toBe(2);
    expect(row.next_retry_at).toBeNull();
  });

  it('markFailed → status=pending_retry, attempt_count++, next_retry_at advances', async () => {
    const id = await insertPending();
    const nextAt = computeNextRetry(2);
    await queue.markFailed(id, failResult, nextAt);
    const row = await fetchRow(id);
    expect(row.status).toBe('pending_retry');
    expect(row.attempt_count).toBe(2);
    expect(new Date(row.next_retry_at!).getTime()).toBeCloseTo(nextAt.getTime(), -3);
  });

  it('markPermanentlyFailed → status=permanently_failed, failed_permanently_at set', async () => {
    const id = await insertPending();
    await queue.markPermanentlyFailed(id, failResult);
    const row = await fetchRow(id);
    expect(row.status).toBe('permanently_failed');
    expect(row.failed_permanently_at).not.toBeNull();
    expect(row.next_retry_at).toBeNull();
  });
});

describe('SupabaseWebhookQueue admin actions', () => {
  it('replay resets attempt_count=0, status=pending_retry, next_retry_at≈now', async () => {
    const { data: row } = await supabase.from('webhook_logs').insert({
      endpoint_id: endpointId, event_type: 'test.event', payload: { x: 'r' },
      status: 'permanently_failed', attempt_count: 5, max_attempts: 5,
      failed_permanently_at: new Date().toISOString(),
      http_status: 503, duration_ms: 0,
    }).select('id').single();
    createdDeliveryIds.push(row!.id);
    await queue.replay(row!.id);
    const after = await fetchRow(row!.id);
    expect(after.status).toBe('pending_retry');
    expect(after.attempt_count).toBe(0);
    expect(after.failed_permanently_at).toBeNull();
    const delta = new Date(after.next_retry_at!).getTime() - Date.now();
    expect(Math.abs(delta)).toBeLessThan(5_000);
  });

  it('forceRetryNow sets next_retry_at≈now', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { data: row } = await supabase.from('webhook_logs').insert({
      endpoint_id: endpointId, event_type: 'test.event', payload: { x: 'f' },
      status: 'pending_retry', attempt_count: 1, max_attempts: 5, next_retry_at: future,
      http_status: 503, duration_ms: 0,
    }).select('id').single();
    createdDeliveryIds.push(row!.id);
    await queue.forceRetryNow(row!.id);
    const after = await fetchRow(row!.id);
    const delta = new Date(after.next_retry_at!).getTime() - Date.now();
    expect(Math.abs(delta)).toBeLessThan(5_000);
  });

  it('cancel flips pending_retry to permanently_failed', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const { data: row } = await supabase.from('webhook_logs').insert({
      endpoint_id: endpointId, event_type: 'test.event', payload: { x: 'c' },
      status: 'pending_retry', attempt_count: 1, max_attempts: 5, next_retry_at: future,
      http_status: 503, duration_ms: 0,
    }).select('id').single();
    createdDeliveryIds.push(row!.id);
    await queue.cancel(row!.id);
    const after = await fetchRow(row!.id);
    expect(after.status).toBe('permanently_failed');
    expect(after.failed_permanently_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Make sure dev server is running (in another terminal): `cd admin-panel && PORT=3000 bun run dev`.

```bash
cd admin-panel
bun run test:api -- tests/api/webhook-deliveries.test.ts
```
Expected: FAIL — cannot find module `supabase-queue`.

- [ ] **Step 3: Implement SupabaseWebhookQueue**

Create `admin-panel/src/lib/services/webhook-queue/supabase-queue.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  computeNextRetry,
  DEFAULT_MAX_ATTEMPTS,
  hasMoreAttempts,
} from './retry-policy';
import type {
  AttemptResult,
  DueDelivery,
  FirstAttemptInput,
  IWebhookDeliveryQueue,
  RecordedDelivery,
} from './types';

const MAX_RESPONSE_BODY_CHARS = 5000;

// Supabase clients with different schema types can't be unified via generics.
// This alias accepts any schema-scoped client (seller_main, seller_X, etc.).
type SupabaseClientLike = SupabaseClient<any, any, any>;

export class SupabaseWebhookQueue implements IWebhookDeliveryQueue {
  private readonly client: SupabaseClientLike;

  constructor(client?: SupabaseClientLike) {
    this.client = client ?? (createAdminClient() as SupabaseClientLike);
  }

  async recordFirstAttempt(input: FirstAttemptInput): Promise<RecordedDelivery> {
    const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const { status, nextRetryAt, failedPermanentlyAt } = resolveInitialState(input.result, 1, maxAttempts);

    const { data, error } = await this.client
      .from('webhook_logs')
      .insert({
        endpoint_id: input.endpointId,
        event_type: input.eventType,
        payload: input.payload,
        status,
        http_status: input.result.httpStatus,
        response_body: trimBody(input.result.responseBody),
        error_message: input.result.errorMessage,
        duration_ms: input.result.durationMs,
        attempt_count: 1,
        max_attempts: maxAttempts,
        next_retry_at: nextRetryAt,
        failed_permanently_at: failedPermanentlyAt,
      })
      .select('id')
      .single();

    if (error) throw new Error(`recordFirstAttempt failed: ${error.message}`);
    return { deliveryId: data.id, willRetry: status === 'pending_retry' };
  }

  async pickDue(limit: number): Promise<DueDelivery[]> {
    const { data, error } = await this.client
      .rpc('pick_due_webhook_deliveries', { p_limit: limit });

    if (error) throw new Error(`pickDue failed: ${error.message}`);
    return (data ?? []).map((row: {
      id: string;
      endpoint_id: string;
      event_type: string;
      payload: unknown;
      attempt_count: number;
      max_attempts: number;
    }) => ({
      id: row.id,
      endpointId: row.endpoint_id,
      eventType: row.event_type,
      payload: row.payload,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
    }));
  }

  async markDelivered(deliveryId: string, result: AttemptResult): Promise<void> {
    const { error } = await this.client.rpc('increment_webhook_attempt', {
      p_log_id: deliveryId,
      p_status: 'success',
      p_http_status: result.httpStatus,
      p_response_body: trimBody(result.responseBody),
      p_error_message: result.errorMessage,
      p_duration_ms: result.durationMs,
      p_next_retry_at: null,
      p_failed_permanently_at: null,
    });
    if (error) throw new Error(`markDelivered failed: ${error.message}`);
  }

  async markFailed(deliveryId: string, result: AttemptResult, nextRetryAt: Date): Promise<void> {
    const { error } = await this.client.rpc('increment_webhook_attempt', {
      p_log_id: deliveryId,
      p_status: 'pending_retry',
      p_http_status: result.httpStatus,
      p_response_body: trimBody(result.responseBody),
      p_error_message: result.errorMessage,
      p_duration_ms: result.durationMs,
      p_next_retry_at: nextRetryAt.toISOString(),
      p_failed_permanently_at: null,
    });
    if (error) throw new Error(`markFailed failed: ${error.message}`);
  }

  async markPermanentlyFailed(deliveryId: string, result: AttemptResult): Promise<void> {
    const { error } = await this.client.rpc('increment_webhook_attempt', {
      p_log_id: deliveryId,
      p_status: 'permanently_failed',
      p_http_status: result.httpStatus,
      p_response_body: trimBody(result.responseBody),
      p_error_message: result.errorMessage,
      p_duration_ms: result.durationMs,
      p_next_retry_at: null,
      p_failed_permanently_at: new Date().toISOString(),
    });
    if (error) throw new Error(`markPermanentlyFailed failed: ${error.message}`);
  }

  async replay(deliveryId: string): Promise<void> {
    const { error } = await this.client
      .from('webhook_logs')
      .update({
        status: 'pending_retry',
        attempt_count: 0,
        next_retry_at: new Date().toISOString(),
        failed_permanently_at: null,
      })
      .eq('id', deliveryId);
    if (error) throw new Error(`replay failed: ${error.message}`);
  }

  async forceRetryNow(deliveryId: string): Promise<void> {
    const { error } = await this.client
      .from('webhook_logs')
      .update({
        next_retry_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .eq('status', 'pending_retry');
    if (error) throw new Error(`forceRetryNow failed: ${error.message}`);
  }

  async cancel(deliveryId: string): Promise<void> {
    const { error } = await this.client
      .from('webhook_logs')
      .update({
        status: 'permanently_failed',
        next_retry_at: null,
        failed_permanently_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .eq('status', 'pending_retry');
    if (error) throw new Error(`cancel failed: ${error.message}`);
  }
}

function resolveInitialState(result: AttemptResult, attemptCount: number, maxAttempts: number) {
  if (result.ok) {
    return { status: 'success' as const, nextRetryAt: null as string | null, failedPermanentlyAt: null as string | null };
  }
  if (!hasMoreAttempts(attemptCount, maxAttempts)) {
    return {
      status: 'permanently_failed' as const,
      nextRetryAt: null as string | null,
      failedPermanentlyAt: new Date().toISOString(),
    };
  }
  return {
    status: 'pending_retry' as const,
    nextRetryAt: computeNextRetry(attemptCount).toISOString(),
    failedPermanentlyAt: null as string | null,
  };
}

function trimBody(body: string | null): string | null {
  if (!body) return null;
  return body.length > MAX_RESPONSE_BODY_CHARS ? body.substring(0, MAX_RESPONSE_BODY_CHARS) : body;
}
```

- [ ] **Step 4: Add the `increment_webhook_attempt` SQL function to the migration**

Edit `supabase/migrations/20260523150000_webhook_delivery_retry.sql` and append:

```sql
-- Increment attempt_count and update result fields atomically.
-- Status transitions are enforced by the application; this function is the
-- single place that bumps attempt_count, so we never accidentally double-count.
CREATE OR REPLACE FUNCTION seller_main.increment_webhook_attempt(
  p_log_id uuid,
  p_status text,
  p_http_status int,
  p_response_body text,
  p_error_message text,
  p_duration_ms int,
  p_next_retry_at timestamptz,
  p_failed_permanently_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE seller_main.webhook_logs
  SET
    status = p_status,
    http_status = p_http_status,
    response_body = p_response_body,
    error_message = p_error_message,
    duration_ms = p_duration_ms,
    attempt_count = attempt_count + 1,
    next_retry_at = p_next_retry_at,
    failed_permanently_at = p_failed_permanently_at
  WHERE id = p_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION seller_main.increment_webhook_attempt(uuid, text, int, text, text, int, timestamptz, timestamptz) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION seller_main.increment_webhook_attempt(uuid, text, int, text, text, int, timestamptz, timestamptz) TO service_role, authenticated;
```

Note: `authenticated` is granted because the queue is called from the admin panel server (which uses the service role client, but RLS-aware admin actions may run in authenticated context too).

- [ ] **Step 5: Re-apply migration + regenerate types**

```bash
cd /Users/pavvel/workspace/projects/sellf/.claude/worktrees/webhook-dlq
npx supabase db reset
npx supabase gen types typescript --local > admin-panel/src/types/database.ts
```
Expected: clean reset, no errors.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd admin-panel
bun run test:api -- tests/api/webhook-deliveries.test.ts
```
Expected: PASS (all queue tests).

- [ ] **Step 7: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add admin-panel/src/lib/services/webhook-queue/supabase-queue.ts \
        admin-panel/tests/api/webhook-deliveries.test.ts \
        supabase/migrations/20260523150000_webhook_delivery_retry.sql
git commit -m "feat(webhooks): supabase queue implementation with atomic claim/lease"
```

---

## Task 6: SQS stub + factory (TDD)

**Files:**
- Create: `admin-panel/src/lib/services/webhook-queue/sqs-queue.ts`
- Create: `admin-panel/src/lib/services/webhook-queue/index.ts`
- Test: `admin-panel/tests/unit/lib/services/webhook-queue/factory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `admin-panel/tests/unit/lib/services/webhook-queue/factory.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';

describe('getWebhookQueue factory', () => {
  const originalDriver = process.env.WEBHOOK_QUEUE_DRIVER;

  afterEach(() => {
    if (originalDriver === undefined) {
      delete process.env.WEBHOOK_QUEUE_DRIVER;
    } else {
      process.env.WEBHOOK_QUEUE_DRIVER = originalDriver;
    }
  });

  it('defaults to SupabaseWebhookQueue when no env var is set', async () => {
    delete process.env.WEBHOOK_QUEUE_DRIVER;
    const { getWebhookQueue } = await import('@/lib/services/webhook-queue');
    const { SupabaseWebhookQueue } = await import('@/lib/services/webhook-queue/supabase-queue');
    expect(getWebhookQueue()).toBeInstanceOf(SupabaseWebhookQueue);
  });

  it('returns SupabaseWebhookQueue when WEBHOOK_QUEUE_DRIVER=supabase', async () => {
    process.env.WEBHOOK_QUEUE_DRIVER = 'supabase';
    const { getWebhookQueue } = await import('@/lib/services/webhook-queue');
    const { SupabaseWebhookQueue } = await import('@/lib/services/webhook-queue/supabase-queue');
    expect(getWebhookQueue()).toBeInstanceOf(SupabaseWebhookQueue);
  });

  it('returns SqsWebhookQueue stub when WEBHOOK_QUEUE_DRIVER=sqs', async () => {
    process.env.WEBHOOK_QUEUE_DRIVER = 'sqs';
    const { getWebhookQueue } = await import('@/lib/services/webhook-queue');
    const { SqsWebhookQueue } = await import('@/lib/services/webhook-queue/sqs-queue');
    expect(getWebhookQueue()).toBeInstanceOf(SqsWebhookQueue);
  });

  it('SqsWebhookQueue methods throw NotImplemented', async () => {
    process.env.WEBHOOK_QUEUE_DRIVER = 'sqs';
    const { getWebhookQueue } = await import('@/lib/services/webhook-queue');
    const queue = getWebhookQueue();
    await expect(queue.pickDue(10)).rejects.toThrow(/not implemented/i);
  });

  it('throws on unknown driver', async () => {
    process.env.WEBHOOK_QUEUE_DRIVER = 'banana';
    const { getWebhookQueue } = await import('@/lib/services/webhook-queue');
    expect(() => getWebhookQueue()).toThrow(/unknown.*driver/i);
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

```bash
bunx vitest run tests/unit/lib/services/webhook-queue/factory.test.ts
```
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement sqs-queue stub**

Create `admin-panel/src/lib/services/webhook-queue/sqs-queue.ts`:

```typescript
import type {
  AttemptResult,
  DueDelivery,
  FirstAttemptInput,
  IWebhookDeliveryQueue,
  RecordedDelivery,
} from './types';

export class SqsWebhookQueue implements IWebhookDeliveryQueue {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async recordFirstAttempt(_input: FirstAttemptInput): Promise<RecordedDelivery> {
    throw new Error('SqsWebhookQueue.recordFirstAttempt is not implemented yet');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async pickDue(_limit: number): Promise<DueDelivery[]> {
    throw new Error('SqsWebhookQueue.pickDue is not implemented yet');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async markDelivered(_deliveryId: string, _result: AttemptResult): Promise<void> {
    throw new Error('SqsWebhookQueue.markDelivered is not implemented yet');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async markFailed(_deliveryId: string, _result: AttemptResult, _nextRetryAt: Date): Promise<void> {
    throw new Error('SqsWebhookQueue.markFailed is not implemented yet');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async markPermanentlyFailed(_deliveryId: string, _result: AttemptResult): Promise<void> {
    throw new Error('SqsWebhookQueue.markPermanentlyFailed is not implemented yet');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async replay(_deliveryId: string): Promise<void> {
    throw new Error('SqsWebhookQueue.replay is not implemented yet');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async forceRetryNow(_deliveryId: string): Promise<void> {
    throw new Error('SqsWebhookQueue.forceRetryNow is not implemented yet');
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async cancel(_deliveryId: string): Promise<void> {
    throw new Error('SqsWebhookQueue.cancel is not implemented yet');
  }
}
```

- [ ] **Step 4: Implement the factory**

Create `admin-panel/src/lib/services/webhook-queue/index.ts`:

```typescript
import type { IWebhookDeliveryQueue } from './types';
import { SupabaseWebhookQueue } from './supabase-queue';
import { SqsWebhookQueue } from './sqs-queue';

export type { IWebhookDeliveryQueue, AttemptResult, DueDelivery, FirstAttemptInput, RecordedDelivery } from './types';
export { WebhookDispatcher } from './dispatcher';
export { computeNextRetry, hasMoreAttempts, DEFAULT_MAX_ATTEMPTS } from './retry-policy';
export { SupabaseWebhookQueue, SqsWebhookQueue };

export function getWebhookQueue(): IWebhookDeliveryQueue {
  const driver = process.env.WEBHOOK_QUEUE_DRIVER ?? 'supabase';
  switch (driver) {
    case 'supabase':
      return new SupabaseWebhookQueue();
    case 'sqs':
      return new SqsWebhookQueue();
    default:
      throw new Error(`Unknown WEBHOOK_QUEUE_DRIVER: ${driver}`);
  }
}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
bunx vitest run tests/unit/lib/services/webhook-queue/factory.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add admin-panel/src/lib/services/webhook-queue/sqs-queue.ts \
        admin-panel/src/lib/services/webhook-queue/index.ts \
        admin-panel/tests/unit/lib/services/webhook-queue/factory.test.ts
git commit -m "feat(webhooks): queue factory with sqs stub"
```

---

## Task 7: Refactor WebhookService to use dispatcher + queue (TDD via existing dispatch tests)

The refactor must keep `WebhookService.trigger(event, data, client?)`, `WebhookService.retry(logId, client?)`, and `WebhookService.testEndpoint(endpointId, eventType, client?)` signatures intact (call sites in 9 files).

**Files:**
- Modify: `admin-panel/src/lib/services/webhook-service.ts`
- Test: `admin-panel/tests/unit/security/webhook-dispatch-wiring.test.ts` (existing) and `admin-panel/tests/api/webhooks.test.ts` (existing, must stay green)

- [ ] **Step 1: Run existing dispatch tests to capture baseline**

```bash
cd admin-panel
bunx vitest run tests/unit/security/webhook-dispatch-wiring.test.ts
bun run test:api -- tests/api/webhooks.test.ts
```
Expected: All PASS. Record numbers for comparison after refactor.

- [ ] **Step 2: Add a new unit test for trigger → queue.recordFirstAttempt wiring**

Create `admin-panel/tests/unit/lib/services/webhook-queue/service-wiring.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchEndpointsMock = vi.fn();
const fromMock = vi.fn(() => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  contains: fetchEndpointsMock,
}));
const adminClient = { from: fromMock } as any;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminClient,
  createPlatformClient: vi.fn(),
}));

const dispatchMock = vi.fn();
vi.mock('@/lib/services/webhook-queue/dispatcher', () => ({
  WebhookDispatcher: { dispatch: dispatchMock },
}));

const recordFirstAttemptMock = vi.fn();
vi.mock('@/lib/services/webhook-queue/supabase-queue', () => ({
  SupabaseWebhookQueue: class {
    recordFirstAttempt = recordFirstAttemptMock;
  },
}));

import { WebhookService } from '@/lib/services/webhook-service';

describe('WebhookService.trigger wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchEndpointsMock.mockResolvedValue({
      data: [{ id: 'ep_1', url: 'https://example.com/h', secret: 'whsec_x' }],
      error: null,
    });
    dispatchMock.mockResolvedValue({
      ok: false, httpStatus: 503, responseBody: 'down', errorMessage: 'HTTP 503', durationMs: 22,
    });
    recordFirstAttemptMock.mockResolvedValue({ deliveryId: 'log_1', willRetry: true });
  });

  it('dispatches once per active endpoint and records via queue.recordFirstAttempt', async () => {
    await WebhookService.trigger('purchase.completed', { foo: 'bar' });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(recordFirstAttemptMock).toHaveBeenCalledTimes(1);
    const [input] = recordFirstAttemptMock.mock.calls[0];
    expect(input.endpointId).toBe('ep_1');
    expect(input.eventType).toBe('purchase.completed');
    expect(input.result.ok).toBe(false);
    expect(input.result.httpStatus).toBe(503);
  });

  it('does nothing when no active endpoint matches the event', async () => {
    fetchEndpointsMock.mockResolvedValue({ data: [], error: null });
    await WebhookService.trigger('purchase.completed', {});
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(recordFirstAttemptMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Refactor `WebhookService`**

Replace `admin-panel/src/lib/services/webhook-service.ts` contents:

```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { WEBHOOK_MOCK_PAYLOADS } from '@/lib/webhooks/mock-payloads';
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';
import { WebhookDispatcher } from '@/lib/services/webhook-queue/dispatcher';
import { DEFAULT_MAX_ATTEMPTS } from '@/lib/services/webhook-queue/retry-policy';

interface EnvelopePayload {
  event: string;
  timestamp: string;
  data: unknown;
}

// Supabase clients with different schema types can't be unified via generics.
// This alias accepts any schema-scoped client (seller_main, seller_X, etc.).
type SupabaseClientLike = any;

interface EndpointRow {
  id: string;
  url: string;
  secret: string;
}

export class WebhookService {
  /**
   * Triggers webhooks for a specific event to all subscribers.
   * First-attempt result is persisted through the queue. Failures land in
   * `pending_retry` and the worker re-attempts with exp backoff.
   */
  static async trigger(event: string, data: unknown, client?: SupabaseClientLike): Promise<void> {
    const supabase = client || createAdminClient();
    const queue = new SupabaseWebhookQueue(supabase);

    try {
      const { data: endpoints, error } = await supabase
        .from('webhook_endpoints')
        .select('id, url, secret')
        .eq('is_active', true)
        .contains('events', [event]);

      if (error) {
        console.error('[WebhookService.trigger] Failed to fetch endpoints:', error);
        return;
      }
      if (!endpoints || endpoints.length === 0) return;

      const timestamp = new Date().toISOString();
      const envelope: EnvelopePayload = { event, timestamp, data };

      await Promise.allSettled(
        (endpoints as EndpointRow[]).map(async (endpoint) => {
          const result = await WebhookDispatcher.dispatch(endpoint, event, envelope, { attemptCount: 1 });
          try {
            await queue.recordFirstAttempt({
              endpointId: endpoint.id,
              eventType: event,
              payload: envelope,
              result,
              maxAttempts: DEFAULT_MAX_ATTEMPTS,
            });
          } catch (recordErr) {
            console.error('[WebhookService.trigger] Failed to record attempt:', recordErr);
          }
        }),
      );
    } catch (err) {
      console.error('[WebhookService.trigger] Unexpected error:', err);
    }
  }

  /** Send a test event to a specific endpoint (one-shot, no retry semantics). */
  static async testEndpoint(endpointId: string, eventType: string = 'test.event', client?: SupabaseClientLike) {
    const supabase = client || createAdminClient();

    const { data: endpoint, error } = await supabase
      .from('webhook_endpoints')
      .select('id, url, secret')
      .eq('id', endpointId)
      .single();
    if (error || !endpoint) throw new Error('Endpoint not found');

    const mockData = WEBHOOK_MOCK_PAYLOADS[eventType] || WEBHOOK_MOCK_PAYLOADS['test.event'];
    const envelope: EnvelopePayload = { event: eventType, timestamp: new Date().toISOString(), data: mockData };

    const result = await WebhookDispatcher.dispatch(endpoint, eventType, envelope, { attemptCount: 1 });
    const queue = new SupabaseWebhookQueue(supabase);
    await queue.recordFirstAttempt({
      endpointId,
      eventType,
      payload: envelope,
      result,
      maxAttempts: 1, // test mode: do not enqueue retries
    });
    return { success: result.ok, status: result.httpStatus, error: result.errorMessage };
  }

  /**
   * Legacy retry path used by /api/v1/webhooks/logs/[id]/retry for status='failed' rows.
   * Creates a NEW log entry and marks the old log as 'retried' (backward compat).
   * For new status='pending_retry' / 'permanently_failed' rows, use queue.replay() or
   * queue.forceRetryNow() via the /replay endpoint.
   */
  static async retry(logId: string, client?: SupabaseClientLike) {
    const supabase = client || createAdminClient();

    const { data: log, error: logError } = await supabase
      .from('webhook_logs')
      .select('payload, endpoint_id, event_type')
      .eq('id', logId)
      .single();
    if (logError || !log) throw new Error('Log entry not found');
    if (!log.endpoint_id) throw new Error('Endpoint ID is missing in log entry');

    const { data: endpoint, error: endpointError } = await supabase
      .from('webhook_endpoints')
      .select('id, url, secret')
      .eq('id', log.endpoint_id)
      .single();
    if (endpointError || !endpoint) throw new Error('Endpoint not found');

    const result = await WebhookDispatcher.dispatch(
      endpoint,
      log.event_type,
      log.payload,
      { attemptCount: 1, extraHeaders: { 'X-Sellf-Retry': 'true' } },
    );

    const queue = new SupabaseWebhookQueue(supabase);
    await queue.recordFirstAttempt({
      endpointId: endpoint.id,
      eventType: log.event_type,
      payload: log.payload,
      result,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
    });

    if (result.ok || result.httpStatus > 0) {
      await supabase.from('webhook_logs').update({ status: 'retried' }).eq('id', logId);
    }

    return { success: result.ok, status: result.httpStatus, error: result.errorMessage };
  }
}
```

- [ ] **Step 4: Run all webhook tests**

```bash
cd admin-panel
bun run test:unit
bun run test:api -- tests/api/webhooks.test.ts tests/api/webhook-deliveries.test.ts
```
Expected: ALL PASS (including the wiring test and existing dispatch tests).

- [ ] **Step 5: Run a Playwright sanity check on existing webhook tests**

```bash
bunx playwright test webhook-dispatch.spec.ts
```
Expected: PASS (refactor is behaviorally equivalent for the unchanged paths).

- [ ] **Step 6: Commit**

```bash
git add admin-panel/src/lib/services/webhook-service.ts \
        admin-panel/tests/unit/lib/services/webhook-queue/service-wiring.test.ts
git commit -m "refactor(webhooks): WebhookService delegates to dispatcher + queue"
```

---

## Task 8: Cron worker `webhook-deliveries-retry`

**Files:**
- Modify: `admin-panel/src/app/api/cron/route.ts`
- Test: `admin-panel/tests/cron-jobs.spec.ts` (Playwright E2E, extend existing file)

- [ ] **Step 1: Extend the Playwright test for the new job**

Open `admin-panel/tests/cron-jobs.spec.ts` and add this `test.describe` block at the end:

```typescript
test.describe('Cron job: webhook-deliveries-retry', () => {
  let endpointId: string;
  const insertedLogIds: string[] = [];

  test.beforeAll(async () => {
    const random = Math.random().toString(36).slice(2, 8);
    const { data: endpoint } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({
        url: `https://example.com/cron-retry-${random}`,
        events: ['purchase.completed'],
        is_active: true,
        secret: `whsec_test_${random}`,
      })
      .select('id')
      .single();
    endpointId = endpoint!.id;
  });

  test.afterAll(async () => {
    if (insertedLogIds.length > 0) {
      await supabaseAdmin.from('webhook_logs').delete().in('id', insertedLogIds);
    }
    if (endpointId) {
      await supabaseAdmin.from('webhook_endpoints').delete().eq('id', endpointId);
    }
  });

  test('processes due retries and reports counts', async ({ request }) => {
    const past = new Date(Date.now() - 5_000).toISOString();
    const { data: row } = await supabaseAdmin
      .from('webhook_logs')
      .insert({
        endpoint_id: endpointId,
        event_type: 'purchase.completed',
        payload: { event: 'purchase.completed', timestamp: new Date().toISOString(), data: { test: true } },
        status: 'pending_retry',
        attempt_count: 1,
        max_attempts: 5,
        next_retry_at: past,
        http_status: 503,
        duration_ms: 0,
      })
      .select('id')
      .single();
    insertedLogIds.push(row!.id);

    const res = await request.get(cronUrl('webhook-deliveries-retry'), { headers: authHeader() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.job).toBe('webhook-deliveries-retry');
    expect(typeof body.processed).toBe('number');
    expect(body.processed).toBeGreaterThanOrEqual(1);

    // The row should no longer be 'pending_retry' with next_retry_at in the past;
    // example.com returns 200 OK for our request, so we expect status='success'.
    const { data: updated } = await supabaseAdmin
      .from('webhook_logs')
      .select('status, attempt_count')
      .eq('id', row!.id)
      .single();
    expect(['success', 'pending_retry', 'permanently_failed']).toContain(updated!.status);
    expect(updated!.attempt_count).toBeGreaterThanOrEqual(2);
  });

  test('returns processed=0 when no rows are due', async ({ request }) => {
    // Make sure there are no due rows (the previous test consumed them).
    const future = new Date(Date.now() + 60_000).toISOString();
    await supabaseAdmin
      .from('webhook_logs')
      .update({ next_retry_at: future })
      .eq('endpoint_id', endpointId)
      .eq('status', 'pending_retry');

    const res = await request.get(cronUrl('webhook-deliveries-retry'), { headers: authHeader() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
  });
});
```

- [ ] **Step 2: Add the handler in cron route**

Edit `admin-panel/src/app/api/cron/route.ts`:

1. Add import near top:
```typescript
import { getWebhookQueue } from '@/lib/services/webhook-queue';
import { WebhookDispatcher } from '@/lib/services/webhook-queue/dispatcher';
import { computeNextRetry, hasMoreAttempts } from '@/lib/services/webhook-queue/retry-policy';
```

2. Add the handler function before `JOB_REGISTRY`:
```typescript
async function handleWebhookDeliveriesRetry(): Promise<CronJobResult> {
  const adminClient = createAdminClient();
  const queue = getWebhookQueue();

  const due = await queue.pickDue(50);
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
          .select('id, url, secret, is_active')
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
          { id: endpoint.id, url: endpoint.url, secret: endpoint.secret },
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
```

3. Add to `JOB_REGISTRY`:
```typescript
const JOB_REGISTRY: Record<string, () => Promise<CronJobResult>> = {
  'access-expired': handleAccessExpired,
  'cleanup-webhook-logs': handleCleanupWebhookLogs,
  'webhook-deliveries-retry': handleWebhookDeliveriesRetry,
};
```

4. Update top-of-file JSDoc to document the new job.

- [ ] **Step 3: Run the cron-jobs Playwright test**

```bash
cd admin-panel
bunx playwright test cron-jobs.spec.ts
```
Expected: PASS (both new tests + existing tests).

- [ ] **Step 4: Typecheck + lint**

```bash
bun run typecheck && bun run lint
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/app/api/cron/route.ts \
        admin-panel/tests/cron-jobs.spec.ts
git commit -m "feat(cron): webhook-deliveries-retry worker"
```

---

## Task 9: REST API — POST `/api/v1/webhooks/logs/[logId]/replay`

**Files:**
- Create: `admin-panel/src/app/api/v1/webhooks/logs/[logId]/replay/route.ts`
- Test: `admin-panel/tests/api/webhook-deliveries.test.ts` (extend existing file)

- [ ] **Step 1: Add the failing test**

Append to `admin-panel/tests/api/webhook-deliveries.test.ts`:

```typescript
import { post, deleteTestApiKey } from './setup';

describe('POST /api/v1/webhooks/logs/[logId]/replay', () => {
  it('rejects requests without WEBHOOKS_WRITE scope', async () => {
    const res = await post('webhooks/logs/00000000-0000-0000-0000-000000000000/replay', {}, { scopes: ['webhooks:read'] });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown log id', async () => {
    const res = await post('webhooks/logs/00000000-0000-0000-0000-000000000000/replay', {}, { scopes: ['webhooks:write'] });
    expect(res.status).toBe(404);
  });

  it('replays a permanently_failed delivery: resets attempt_count, sets pending_retry, next_retry_at≈now', async () => {
    const random = Math.random().toString(36).slice(2, 8);
    const { data: endpoint } = await supabase
      .from('webhook_endpoints')
      .insert({
        url: `https://example.com/replay-${random}`,
        events: ['test.event'],
        is_active: true,
        secret: `whsec_test_${random}`,
      })
      .select('id')
      .single();

    const { data: row } = await supabase
      .from('webhook_logs')
      .insert({
        endpoint_id: endpoint!.id,
        event_type: 'test.event',
        payload: { x: 'replay' },
        status: 'permanently_failed',
        attempt_count: 5,
        max_attempts: 5,
        failed_permanently_at: new Date().toISOString(),
        http_status: 503,
        duration_ms: 0,
      })
      .select('id')
      .single();

    const res = await post(`webhooks/logs/${row!.id}/replay`, {}, { scopes: ['webhooks:write'] });
    expect(res.status).toBe(200);

    const { data: after } = await supabase
      .from('webhook_logs')
      .select('status, attempt_count, failed_permanently_at, next_retry_at')
      .eq('id', row!.id)
      .single();
    expect(after!.status).toBe('pending_retry');
    expect(after!.attempt_count).toBe(0);
    expect(after!.failed_permanently_at).toBeNull();
    expect(after!.next_retry_at).not.toBeNull();

    await supabase.from('webhook_logs').delete().eq('id', row!.id);
    await supabase.from('webhook_endpoints').delete().eq('id', endpoint!.id);
  });

  it('returns 409 when trying to replay a non-permanently_failed delivery', async () => {
    const random = Math.random().toString(36).slice(2, 8);
    const { data: endpoint } = await supabase
      .from('webhook_endpoints')
      .insert({
        url: `https://example.com/replay-409-${random}`,
        events: ['test.event'],
        is_active: true,
        secret: `whsec_test_${random}`,
      })
      .select('id')
      .single();
    const { data: row } = await supabase
      .from('webhook_logs')
      .insert({
        endpoint_id: endpoint!.id,
        event_type: 'test.event',
        payload: { x: 'wrong-state' },
        status: 'success',
        attempt_count: 1,
        max_attempts: 5,
        http_status: 200,
        duration_ms: 12,
      })
      .select('id')
      .single();

    const res = await post(`webhooks/logs/${row!.id}/replay`, {}, { scopes: ['webhooks:write'] });
    expect(res.status).toBe(409);

    await supabase.from('webhook_logs').delete().eq('id', row!.id);
    await supabase.from('webhook_endpoints').delete().eq('id', endpoint!.id);
  });
});
```

Note: This requires `post()` from `setup.ts` to accept a `{ scopes }` option that issues a temporary API key with that scope set. Check `setup.ts` and follow existing patterns (e.g. `tests/api/webhooks.test.ts` shows how scopes are exercised). If the helper does not exist, add it in step 2 alongside the route.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd admin-panel
bun run test:api -- tests/api/webhook-deliveries.test.ts
```
Expected: FAIL — replay route does not exist yet.

- [ ] **Step 3: Implement the route**

Create `admin-panel/src/app/api/v1/webhooks/logs/[logId]/replay/route.ts`:

```typescript
/**
 * Webhooks API v1 - Replay a permanently_failed delivery.
 *
 * POST /api/v1/webhooks/logs/:logId/replay
 *   - Requires scope webhooks:write
 *   - Only valid for status='permanently_failed' rows
 *   - Resets attempt_count to 0 and schedules immediate retry
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  successResponse,
  API_SCOPES,
} from '@/lib/api';
import { validateUUID } from '@/lib/validations/product';
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';

interface RouteParams {
  params: Promise<{ logId: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);
    const { logId } = await params;

    const idCheck = validateUUID(logId);
    if (!idCheck.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid log ID format');
    }

    const { data: log, error: fetchError } = await auth.supabase
      .from('webhook_logs')
      .select('id, status')
      .eq('id', logId)
      .single();

    if (fetchError || !log) {
      return apiError(request, 'NOT_FOUND', 'Webhook log not found');
    }

    if (log.status !== 'permanently_failed') {
      return apiError(
        request,
        'CONFLICT',
        `Cannot replay a delivery with status '${log.status}'. Only permanently_failed deliveries can be replayed.`,
      );
    }

    const queue = new SupabaseWebhookQueue(auth.supabase);
    await queue.replay(logId);

    return jsonResponse(successResponse({ status: 'enqueued' }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
```

Note: If `ErrorCodes` lacks `CONFLICT`, add `CONFLICT: 'CONFLICT'` to `admin-panel/src/lib/api/types.ts` and `CONFLICT: 409` to `ErrorHttpStatus` map.

- [ ] **Step 4: Run tests, expect pass**

```bash
bun run test:api -- tests/api/webhook-deliveries.test.ts
```
Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add admin-panel/src/app/api/v1/webhooks/logs/[logId]/replay/route.ts \
        admin-panel/tests/api/webhook-deliveries.test.ts \
        admin-panel/src/lib/api/types.ts
git commit -m "feat(api): POST /webhooks/logs/[id]/replay"
```

---

## Task 10: Frontend types + i18n keys

**Files:**
- Modify: `admin-panel/src/types/webhooks.ts`
- Modify: `admin-panel/src/messages/en.json` + `pl.json`

- [ ] **Step 1: Extend WebhookLog type**

Edit `admin-panel/src/types/webhooks.ts`:

```typescript
export interface WebhookLog {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: any;

  status: 'success' | 'failed' | 'retried' | 'archived' | 'pending_retry' | 'permanently_failed';
  http_status: number;
  response_body: string;
  error_message?: string;
  duration_ms: number;

  // New retry/DLQ fields
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string | null;
  failed_permanently_at: string | null;

  created_at: string;

  endpoint?: {
    id: string;
    url: string;
    description?: string;
    is_active: boolean;
  };
}
```

Also update the second `WebhookLog` definition in `admin-panel/src/types/index.ts:210` to match.

- [ ] **Step 2: Add i18n keys**

Edit `admin-panel/src/messages/en.json` — inside `admin.webhooks.logs` add:

```json
"filterPendingRetry": "Pending retry",
"filterPermanentlyFailed": "DLQ (permanently failed)",
"filterAllFailed": "All failed",
"replay": "Replay",
"replayConfirm": "Reset retry counter and re-queue this delivery?",
"replaySuccess": "Delivery requeued",
"replayError": "Failed to requeue delivery",
"forceRetry": "Retry now",
"forceRetrySuccess": "Retry scheduled for now",
"cancel": "Cancel retry",
"cancelSuccess": "Retry canceled",
"viewAllDlq": "View all DLQ →",
"attemptCount": "Attempts",
"attemptOf": "{count} of {max}",
"nextRetryAt": "Next retry",
"failedPermanentlyAt": "Failed permanently at",
"dlqPageTitle": "Webhook deliveries",
"dlqPageDescription": "Browse, replay, and cancel webhook deliveries across all endpoints."
```

Mirror these in `pl.json` with Polish translations (using the same keys):

```json
"filterPendingRetry": "Oczekuje na ponowienie",
"filterPermanentlyFailed": "DLQ (trwale nieudane)",
"filterAllFailed": "Wszystkie nieudane",
"replay": "Powtórz",
"replayConfirm": "Zresetować licznik prób i ponownie wstawić do kolejki?",
"replaySuccess": "Dostawa ponownie w kolejce",
"replayError": "Nie udało się ponownie wstawić dostawy",
"forceRetry": "Ponów teraz",
"forceRetrySuccess": "Próba zaplanowana na teraz",
"cancel": "Anuluj ponowienie",
"cancelSuccess": "Ponowienie anulowane",
"viewAllDlq": "Wszystkie DLQ →",
"attemptCount": "Próby",
"attemptOf": "{count} z {max}",
"nextRetryAt": "Następna próba",
"failedPermanentlyAt": "Trwale nieudane od",
"dlqPageTitle": "Dostawy webhooków",
"dlqPageDescription": "Przeglądaj, powtarzaj i anuluj dostawy webhooków dla wszystkich endpointów."
```

- [ ] **Step 3: Typecheck**

```bash
cd admin-panel
bun run typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/types/webhooks.ts \
        admin-panel/src/types/index.ts \
        admin-panel/src/messages/en.json \
        admin-panel/src/messages/pl.json
git commit -m "feat(webhooks): extend WebhookLog type and i18n for DLQ"
```

---

## Task 11: Extend `WebhookLogsTable` for new statuses + per-row actions

**Files:**
- Modify: `admin-panel/src/components/webhooks/WebhookLogsTable.tsx`

- [ ] **Step 1: Extend props + state**

Edit `admin-panel/src/components/webhooks/WebhookLogsTable.tsx`:

1. Update `WebhookLogsTableProps`:

```typescript
interface WebhookLogsTableProps {
  logs: WebhookLog[];
  onRetry: (logId: string) => void;
  retryingId: string | null;
  showEndpointColumn?: boolean;
  onRefresh?: () => void;
  // New actions for DLQ flows; optional so other call sites (drawer/failures panel) can omit.
  onReplay?: (logId: string) => void;
  onForceRetry?: (logId: string) => void;
  onCancel?: (logId: string) => void;
  replayingId?: string | null;
}
```

2. Update `getStatusBadge()` to handle two new statuses:

```typescript
if (log.status === 'pending_retry') {
  return (
    <span className="px-2 py-1 bg-sf-warning-soft text-sf-warning rounded text-xs font-medium border border-sf-warning/20">
      {t('filterPendingRetry')}
    </span>
  );
}
if (log.status === 'permanently_failed') {
  return (
    <span className="px-2 py-1 bg-sf-danger-soft text-sf-danger rounded text-xs font-medium border border-sf-danger/20">
      DLQ
    </span>
  );
}
```

3. In the actions cell, render new buttons:

```tsx
{log.status === 'permanently_failed' && onReplay && (
  <button
    onClick={(e) => { e.stopPropagation(); onReplay(log.id); }}
    disabled={replayingId === log.id}
    className="inline-flex items-center px-2.5 py-1.5 border text-xs font-medium rounded border-sf-border text-sf-accent bg-sf-accent-soft hover:bg-sf-hover disabled:opacity-50"
  >
    {replayingId === log.id ? '...' : t('replay')}
  </button>
)}
{log.status === 'pending_retry' && onForceRetry && (
  <button
    onClick={(e) => { e.stopPropagation(); onForceRetry(log.id); }}
    className="inline-flex items-center px-2.5 py-1.5 border text-xs font-medium rounded border-sf-border text-sf-accent bg-sf-raised hover:bg-sf-hover"
  >
    {t('forceRetry')}
  </button>
)}
{log.status === 'pending_retry' && onCancel && (
  <button
    onClick={(e) => { e.stopPropagation(); onCancel(log.id); }}
    className="inline-flex items-center px-2.5 py-1.5 border text-xs font-medium rounded border-sf-border text-sf-muted bg-sf-raised hover:text-sf-danger"
  >
    {t('cancel')}
  </button>
)}
```

4. Expand the detail row (when expanded) to also show `attempt_count`, `next_retry_at`, `failed_permanently_at`.

```tsx
<div className="md:col-span-2 grid grid-cols-3 gap-3 text-xs">
  <div>
    <span className="text-sf-muted">{t('attemptCount')}: </span>
    <span className="text-sf-heading font-mono">{t('attemptOf', { count: log.attempt_count, max: log.max_attempts })}</span>
  </div>
  {log.next_retry_at && (
    <div>
      <span className="text-sf-muted">{t('nextRetryAt')}: </span>
      <span className="text-sf-heading font-mono">{new Date(log.next_retry_at).toLocaleString()}</span>
    </div>
  )}
  {log.failed_permanently_at && (
    <div>
      <span className="text-sf-muted">{t('failedPermanentlyAt')}: </span>
      <span className="text-sf-heading font-mono">{new Date(log.failed_permanently_at).toLocaleString()}</span>
    </div>
  )}
</div>
```

- [ ] **Step 2: Lint + typecheck**

```bash
cd admin-panel
bun run typecheck && bun run lint
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add admin-panel/src/components/webhooks/WebhookLogsTable.tsx
git commit -m "feat(webhooks/ui): render pending_retry and DLQ actions in logs table"
```

---

## Task 12: `useWebhookDeliveries` hook + `WebhookDeliveriesPageContent` + page route

**Files:**
- Create: `admin-panel/src/hooks/useWebhookDeliveries.ts`
- Create: `admin-panel/src/components/WebhookDeliveriesPageContent.tsx`
- Create: `admin-panel/src/app/[locale]/dashboard/webhooks/deliveries/page.tsx`

- [ ] **Step 1: Implement the hook**

Create `admin-panel/src/hooks/useWebhookDeliveries.ts`:

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api/client';
import type { WebhookLog } from '@/types/webhooks';

export type DeliveryFilter =
  | 'permanently_failed'
  | 'pending_retry'
  | 'all_failed'
  | 'success'
  | 'failed'
  | 'archived'
  | 'retried'
  | 'all';

const FILTER_TO_QUERY: Record<DeliveryFilter, Record<string, string>> = {
  permanently_failed: { status: 'permanently_failed' },
  pending_retry: { status: 'pending_retry' },
  failed: { status: 'failed' },
  success: { status: 'success' },
  archived: { status: 'archived' },
  retried: { status: 'retried' },
  all_failed: { status: 'all_failed' },
  all: { status: 'all' },
};

export function useWebhookDeliveries() {
  const t = useTranslations('admin.webhooks.logs');
  const tCommon = useTranslations('common');

  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DeliveryFilter>('permanently_failed');
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params = { ...FILTER_TO_QUERY[filter], limit: '50' };
      const response = await api.list<WebhookLog>('webhooks/logs', params);
      setLogs(response.data || []);
    } catch (err) {
      console.error('[useWebhookDeliveries] fetch failed', err);
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [filter, t]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const replay = useCallback(async (logId: string) => {
    setReplayingId(logId);
    try {
      await api.postCustom(`webhooks/logs/${logId}/replay`, {});
      toast.success(t('replaySuccess'));
      await fetchLogs();
    } catch (err) {
      console.error(err);
      toast.error(t('replayError'));
    } finally {
      setReplayingId(null);
    }
  }, [fetchLogs, t]);

  const forceRetry = useCallback(async (logId: string) => {
    setActingId(logId);
    try {
      await api.postCustom(`webhooks/logs/${logId}/force-retry`, {});
      toast.success(t('forceRetrySuccess'));
      await fetchLogs();
    } catch (err) {
      console.error(err);
      toast.error(tCommon('error'));
    } finally {
      setActingId(null);
    }
  }, [fetchLogs, t, tCommon]);

  const cancel = useCallback(async (logId: string) => {
    setActingId(logId);
    try {
      await api.postCustom(`webhooks/logs/${logId}/cancel`, {});
      toast.success(t('cancelSuccess'));
      await fetchLogs();
    } catch (err) {
      console.error(err);
      toast.error(tCommon('error'));
    } finally {
      setActingId(null);
    }
  }, [fetchLogs, t, tCommon]);

  return { logs, loading, filter, setFilter, replay, forceRetry, cancel, replayingId, actingId, refresh: fetchLogs };
}
```

- [ ] **Step 2: Extend webhooks logs list endpoint to accept `pending_retry`, `permanently_failed`, `all_failed`**

Edit `admin-panel/src/app/api/v1/webhooks/logs/route.ts`:

Change the validStatuses array and add the `all_failed` branch:

```typescript
const validStatuses = ['success', 'failed', 'archived', 'retried', 'pending_retry', 'permanently_failed'];
if (status === 'all_failed') {
  query = query.in('status', ['failed', 'pending_retry', 'permanently_failed']);
} else if (status !== 'all') {
  if (validStatuses.includes(status)) {
    query = query.eq('status', status);
  } else {
    return apiError(request, 'INVALID_INPUT', `Invalid status. Valid values: ${validStatuses.join(', ')}, all_failed, all`);
  }
}
```

Also extend the JSDoc comment.

- [ ] **Step 3: Add force-retry + cancel endpoints**

Create `admin-panel/src/app/api/v1/webhooks/logs/[logId]/force-retry/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight, jsonResponse, apiError, authenticate, handleApiError, successResponse, API_SCOPES,
} from '@/lib/api';
import { validateUUID } from '@/lib/validations/product';
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';

export async function OPTIONS(request: NextRequest) { return handleCorsPreFlight(request); }

export async function POST(request: NextRequest, { params }: { params: Promise<{ logId: string }> }) {
  try {
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);
    const { logId } = await params;
    const idCheck = validateUUID(logId);
    if (!idCheck.isValid) return apiError(request, 'INVALID_INPUT', 'Invalid log ID format');

    const { data: log } = await auth.supabase
      .from('webhook_logs').select('id, status').eq('id', logId).single();
    if (!log) return apiError(request, 'NOT_FOUND', 'Webhook log not found');
    if (log.status !== 'pending_retry') {
      return apiError(request, 'CONFLICT', `Cannot force-retry a delivery with status '${log.status}'. Only pending_retry deliveries are eligible.`);
    }

    const queue = new SupabaseWebhookQueue(auth.supabase);
    await queue.forceRetryNow(logId);
    return jsonResponse(successResponse({ status: 'rescheduled' }), request);
  } catch (error) { return handleApiError(error, request); }
}
```

Create `admin-panel/src/app/api/v1/webhooks/logs/[logId]/cancel/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight, jsonResponse, apiError, authenticate, handleApiError, successResponse, API_SCOPES,
} from '@/lib/api';
import { validateUUID } from '@/lib/validations/product';
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';

export async function OPTIONS(request: NextRequest) { return handleCorsPreFlight(request); }

export async function POST(request: NextRequest, { params }: { params: Promise<{ logId: string }> }) {
  try {
    const auth = await authenticate(request, [API_SCOPES.WEBHOOKS_WRITE]);
    const { logId } = await params;
    const idCheck = validateUUID(logId);
    if (!idCheck.isValid) return apiError(request, 'INVALID_INPUT', 'Invalid log ID format');

    const { data: log } = await auth.supabase
      .from('webhook_logs').select('id, status').eq('id', logId).single();
    if (!log) return apiError(request, 'NOT_FOUND', 'Webhook log not found');
    if (log.status !== 'pending_retry') {
      return apiError(request, 'CONFLICT', `Cannot cancel a delivery with status '${log.status}'. Only pending_retry deliveries are eligible.`);
    }

    const queue = new SupabaseWebhookQueue(auth.supabase);
    await queue.cancel(logId);
    return jsonResponse(successResponse({ status: 'canceled' }), request);
  } catch (error) { return handleApiError(error, request); }
}
```

- [ ] **Step 4: Implement the page content client component**

Create `admin-panel/src/components/WebhookDeliveriesPageContent.tsx`:

```typescript
'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useWebhookDeliveries, type DeliveryFilter } from '@/hooks/useWebhookDeliveries';
import WebhookLogsTable from './webhooks/WebhookLogsTable';

const FILTER_ORDER: DeliveryFilter[] = [
  'permanently_failed',
  'pending_retry',
  'all_failed',
  'success',
  'failed',
  'retried',
  'archived',
  'all',
];

export default function WebhookDeliveriesPageContent() {
  const t = useTranslations('admin.webhooks.logs');
  const tPage = useTranslations('admin.webhooks');
  const { logs, loading, filter, setFilter, replay, forceRetry, cancel, replayingId, actingId } = useWebhookDeliveries();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-sf-heading">{t('dlqPageTitle')}</h1>
        <p className="text-sm text-sf-muted">{t('dlqPageDescription')}</p>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        {FILTER_ORDER.map((value) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`px-3 py-2 text-xs font-medium border-2 ${
              filter === value ? 'border-sf-accent text-sf-accent bg-sf-accent-soft' : 'border-sf-border-medium text-sf-body bg-sf-base hover:bg-sf-hover'
            }`}
          >
            {t(filterLabelKey(value))}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sf-accent" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-sf-muted border-2 border-dashed border-sf-border-medium">
          {t('noLogs')}
        </div>
      ) : (
        <WebhookLogsTable
          logs={logs}
          showEndpointColumn
          onRetry={() => { /* legacy /retry path not used in DLQ */ }}
          retryingId={null}
          onReplay={replay}
          onForceRetry={forceRetry}
          onCancel={cancel}
          replayingId={replayingId}
          onRefresh={() => {}}
        />
      )}
    </div>
  );
}

function filterLabelKey(filter: DeliveryFilter): string {
  switch (filter) {
    case 'permanently_failed': return 'filterPermanentlyFailed';
    case 'pending_retry': return 'filterPendingRetry';
    case 'all_failed': return 'filterAllFailed';
    case 'success': return 'filterSuccess';
    case 'failed': return 'filterFailed';
    case 'retried': return 'filterRetried';
    case 'archived': return 'filterArchived';
    case 'all': return 'filterAll';
  }
}
```

- [ ] **Step 5: Implement the page route (server component)**

Create `admin-panel/src/app/[locale]/dashboard/webhooks/deliveries/page.tsx`:

```typescript
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import WebhookDeliveriesPageContent from '@/components/WebhookDeliveriesPageContent';

export default async function WebhookDeliveriesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const isAdmin = user.user_metadata?.is_admin === true;
  if (!isAdmin) redirect('/dashboard');

  return <WebhookDeliveriesPageContent />;
}
```

- [ ] **Step 6: Add "View all DLQ →" link in `WebhookFailuresPanel`**

Edit `admin-panel/src/components/WebhookFailuresPanel.tsx`. Add at the bottom of the panel (after the WebhookLogsTable):

```tsx
import Link from 'next/link';
// ... in JSX, after the table:
<div className="mt-3 text-right">
  <Link href="/dashboard/webhooks/deliveries" className="text-xs text-sf-accent hover:underline">
    {t('viewAllDlq')}
  </Link>
</div>
```

- [ ] **Step 7: Typecheck + lint + build**

```bash
cd admin-panel
bun run typecheck && bun run lint && bun run build
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add admin-panel/src/hooks/useWebhookDeliveries.ts \
        admin-panel/src/components/WebhookDeliveriesPageContent.tsx \
        admin-panel/src/components/WebhookFailuresPanel.tsx \
        admin-panel/src/app/[locale]/dashboard/webhooks/deliveries/page.tsx \
        admin-panel/src/app/api/v1/webhooks/logs/route.ts \
        admin-panel/src/app/api/v1/webhooks/logs/[logId]/force-retry/route.ts \
        admin-panel/src/app/api/v1/webhooks/logs/[logId]/cancel/route.ts
git commit -m "feat(webhooks/ui): DLQ deliveries page with replay/force-retry/cancel"
```

---

## Task 13: Playwright E2E — replay flow (UI)

**Files:**
- Create: `admin-panel/tests/webhook-dlq-replay.spec.ts`

- [ ] **Step 1: Write the spec**

Create `admin-panel/tests/webhook-dlq-replay.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { supabaseAdmin, loginAsAdmin } from './helpers/admin-auth';

test.describe('Webhook DLQ replay (UI + API)', () => {
  let endpointId: string;
  let logId: string;

  test.beforeAll(async () => {
    const random = Math.random().toString(36).slice(2, 8);
    const { data: endpoint, error } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({
        url: `https://example.com/dlq-ui-${random}`,
        events: ['purchase.completed'],
        is_active: true,
        secret: `whsec_test_${random}`,
        description: 'DLQ UI test',
      })
      .select('id')
      .single();
    if (error) throw error;
    endpointId = endpoint!.id;

    const { data: log, error: logErr } = await supabaseAdmin
      .from('webhook_logs')
      .insert({
        endpoint_id: endpointId,
        event_type: 'purchase.completed',
        payload: { event: 'purchase.completed', timestamp: new Date().toISOString(), data: { test: 'dlq' } },
        status: 'permanently_failed',
        attempt_count: 5,
        max_attempts: 5,
        failed_permanently_at: new Date().toISOString(),
        http_status: 503,
        response_body: 'Service Unavailable',
        error_message: 'HTTP 503',
        duration_ms: 22,
      })
      .select('id')
      .single();
    if (logErr) throw logErr;
    logId = log!.id;
  });

  test.afterAll(async () => {
    if (logId) await supabaseAdmin.from('webhook_logs').delete().eq('id', logId);
    if (endpointId) await supabaseAdmin.from('webhook_endpoints').delete().eq('id', endpointId);
  });

  test('DLQ page lists permanently_failed delivery and Replay resets state', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/en/dashboard/webhooks/deliveries');
    await expect(page.getByRole('heading', { name: /webhook deliveries/i })).toBeVisible();

    // Default filter is permanently_failed; the row should appear.
    const row = page.locator('tr', { hasText: 'purchase.completed' }).first();
    await expect(row).toBeVisible();
    await expect(row.locator('text=DLQ')).toBeVisible();

    // Click Replay.
    await row.getByRole('button', { name: /replay/i }).click();
    await expect(page.locator('text=/Delivery requeued/i')).toBeVisible();

    // After replay the row should disappear from permanently_failed filter.
    await expect(page.locator('tr', { hasText: 'purchase.completed' })).toHaveCount(0);

    // Verify DB state directly.
    const { data: updated } = await supabaseAdmin
      .from('webhook_logs')
      .select('status, attempt_count, failed_permanently_at, next_retry_at')
      .eq('id', logId)
      .single();
    expect(updated!.status).toBe('pending_retry');
    expect(updated!.attempt_count).toBe(0);
    expect(updated!.failed_permanently_at).toBeNull();
    expect(updated!.next_retry_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the spec**

```bash
cd admin-panel
bunx playwright test webhook-dlq-replay.spec.ts --workers=1
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add admin-panel/tests/webhook-dlq-replay.spec.ts
git commit -m "test(webhooks/e2e): DLQ replay UI flow"
```

---

## Task 14: Playwright E2E — concurrent worker invocation does not double-dispatch

**Files:**
- Create: `admin-panel/tests/webhook-retry-concurrent.spec.ts`

- [ ] **Step 1: Write the spec**

Create `admin-panel/tests/webhook-retry-concurrent.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { supabaseAdmin } from './helpers/admin-auth';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3777';
const CRON_SECRET = process.env.CRON_SECRET || 'dev-cron-secret-change-in-production';

test.describe('Concurrent webhook-deliveries-retry worker invocations', () => {
  let endpointId: string;
  const insertedLogIds: string[] = [];

  test.beforeAll(async () => {
    const random = Math.random().toString(36).slice(2, 8);
    const { data: endpoint } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({
        url: 'https://example.com/concurrent-test',
        events: ['purchase.completed'],
        is_active: true,
        secret: `whsec_test_${random}`,
      })
      .select('id')
      .single();
    endpointId = endpoint!.id;
  });

  test.afterAll(async () => {
    if (insertedLogIds.length > 0) {
      await supabaseAdmin.from('webhook_logs').delete().in('id', insertedLogIds);
    }
    if (endpointId) await supabaseAdmin.from('webhook_endpoints').delete().eq('id', endpointId);
  });

  test('two parallel worker calls together process each row only once', async ({ request }) => {
    const past = new Date(Date.now() - 5_000).toISOString();
    const rows = await Promise.all(
      Array.from({ length: 5 }).map(async (_, i) => {
        const { data } = await supabaseAdmin
          .from('webhook_logs')
          .insert({
            endpoint_id: endpointId,
            event_type: 'purchase.completed',
            payload: { event: 'purchase.completed', timestamp: new Date().toISOString(), data: { i } },
            status: 'pending_retry',
            attempt_count: 1,
            max_attempts: 5,
            next_retry_at: past,
            http_status: 503,
            duration_ms: 0,
          })
          .select('id')
          .single();
        return data!.id;
      }),
    );
    insertedLogIds.push(...rows);

    const url = `${BASE_URL}/api/cron?job=webhook-deliveries-retry`;
    const headers = { Authorization: `Bearer ${CRON_SECRET}` };

    const [res1, res2] = await Promise.all([
      request.get(url, { headers }),
      request.get(url, { headers }),
    ]);
    expect([res1.status(), res2.status()].sort()).toEqual([200, 200]);

    const body1 = await res1.json();
    const body2 = await res2.json();

    // Together the two invocations process each of the 5 rows exactly once.
    expect((body1.processed ?? 0) + (body2.processed ?? 0)).toBe(5);

    // Each row should have attempt_count >= 2 (one retry attempt) and not still be 'pending_retry'
    // with next_retry_at in the past.
    for (const id of rows) {
      const { data } = await supabaseAdmin
        .from('webhook_logs')
        .select('attempt_count, status')
        .eq('id', id)
        .single();
      expect(data!.attempt_count).toBe(2);
      expect(['success', 'pending_retry', 'permanently_failed']).toContain(data!.status);
    }
  });
});
```

- [ ] **Step 2: Run**

```bash
cd admin-panel
bunx playwright test webhook-retry-concurrent.spec.ts --workers=1
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add admin-panel/tests/webhook-retry-concurrent.spec.ts
git commit -m "test(webhooks/e2e): concurrent worker invocations do not double-dispatch"
```

---

## Task 15: Full regression — run the entire suite + scan for cleanup

**Files:** (none directly; verifies everything green)

- [ ] **Step 1: Unit + API**

```bash
cd admin-panel
bun run test:unit
bun run test:api
```
Expected: ALL PASS. Scan the output for any warning lines (deprecation, flaky, etc.) — fix them if attributable to this branch.

- [ ] **Step 2: Build + lint + typecheck**

```bash
bun run typecheck && bun run lint && bun run build
```
Expected: ALL PASS, no warnings.

- [ ] **Step 3: Playwright targeted regressions**

```bash
bunx playwright test webhook-dispatch.spec.ts ssrf-webhook.spec.ts api-v1-webhooks.spec.ts cron-jobs.spec.ts webhook-dlq-replay.spec.ts webhook-retry-concurrent.spec.ts --workers=1
```
Expected: ALL PASS.

- [ ] **Step 4: Scan for unused exports / dead code**

```bash
cd admin-panel
grep -rn "WebhookService.retry\b" src tests --include="*.ts" --include="*.tsx"
```
Verify there are no orphan call sites broken by the refactor. If anything is dead, remove it now.

- [ ] **Step 5: Commit any leftover cleanup**

```bash
git add -p
git commit -m "chore(webhooks): cleanup after DLQ feature"
```

---

## Task 16: Documentation

**Files:**
- Modify (or Create): `docs/webhooks.md`
- Modify: `FEATURES.md` (add section "Webhook delivery & DLQ")
- Modify: `BACKLOG.md` (mark task done)

- [ ] **Step 1: Author or extend `docs/webhooks.md`**

If `docs/webhooks.md` does not exist, create it. Add or extend with this section:

```markdown
## Retry policy and DLQ

When a webhook delivery fails (network error, non-2xx response, SSRF block), Sellf retries with exponential backoff before declaring the delivery permanently failed:

| Attempt | Delay before next retry |
|--------:|------------------------:|
| 1 → 2   |                    1 min |
| 2 → 3   |                    5 min |
| 3 → 4   |                   30 min |
| 4 → 5   |                    2 hrs |
| 5 → 6   |                   12 hrs (none after this; DLQ) |

After the 5th failed attempt the delivery enters the **dead-letter queue** (status `permanently_failed`). It stays in the DLQ until an admin clicks **Replay** in `/dashboard/webhooks/deliveries`, at which point the attempt counter resets and the worker re-queues the delivery for an immediate retry. The cron job `webhook-deliveries-retry` runs every minute and uses `FOR UPDATE SKIP LOCKED` plus a 60s lease so concurrent invocations never deliver the same row twice.

### Headers

Every retried request includes `X-Sellf-Retry-Attempt: <n>` so your receiver can detect retries.

### Admin actions per status

| Status               | Actions                          |
|----------------------|----------------------------------|
| `success`            | Resend                            |
| `pending_retry`      | Force retry now, Cancel           |
| `permanently_failed` | Replay, Archive                   |
| `failed` (legacy)    | Retry, Archive                    |

### Operator setup

Add this cron entry on your Sellf host (PM2/cron/systemd):

```
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$SELLF_URL/api/cron?job=webhook-deliveries-retry" > /dev/null
```
```

- [ ] **Step 2: Update `FEATURES.md`**

Append a one-line entry under the Webhooks section noting "Automatic retry with exponential backoff + Dead-letter queue with Replay UI (`/dashboard/webhooks/deliveries`)".

- [ ] **Step 3: Update `BACKLOG.md`**

Move the webhook DLQ entry from "in progress" to "done".

- [ ] **Step 4: Commit**

```bash
git add docs/webhooks.md FEATURES.md BACKLOG.md
git commit -m "docs(webhooks): retry policy, DLQ replay UI, operator setup"
```

---

## Acceptance criteria (mirrored from source task)

- [x] Migration applied on local Supabase; verifiable via `\d+ seller_main.webhook_logs`.
- [x] `WebhookService.trigger` delegates to dispatcher + queue (no direct INSERT).
- [x] Failed first delivery lands in `pending_retry` with correct `next_retry_at`.
- [x] `cron-jobs.spec.ts` confirms `webhook-deliveries-retry` picks due rows and advances state.
- [x] After 5 failed attempts, delivery enters `permanently_failed`.
- [x] `/dashboard/webhooks/deliveries` lists DLQ rows with filter chips.
- [x] Replay resets state; row returns to retry cycle.
- [x] `webhook-retry-concurrent.spec.ts` confirms no double-dispatch under parallel worker invocations.
- [x] All existing tests stay green (`bun run test:unit`, `bun run test:api`, Playwright targeted regressions).
- [x] `WEBHOOK_QUEUE_DRIVER=supabase` is the default and equivalent to today's persistence semantics.
- [x] `docs/webhooks.md` documents retry policy + Replay UI + operator setup.
