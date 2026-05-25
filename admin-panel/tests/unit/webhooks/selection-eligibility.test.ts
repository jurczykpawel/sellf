import { describe, it, expect } from 'vitest';
import { computeEligibility } from '@/lib/webhooks/selection-eligibility';
import type { WebhookLog } from '@/types/webhooks';

function log(id: string, status: WebhookLog['status']): WebhookLog {
  return {
    id,
    status,
    event_type: 'test.event',
    payload: {},
    created_at: new Date().toISOString(),
    http_status: 0,
    duration_ms: 0,
    request_body: null,
    response_body: null,
    error_message: null,
    endpoint_id: 'ep',
    attempt_count: 1,
    max_attempts: 5,
    next_retry_at: null,
    failed_permanently_at: null,
  } as WebhookLog;
}

describe('computeEligibility', () => {
  it('empty selection yields zeros for all actions', () => {
    expect(computeEligibility([], new Set())).toEqual({
      replayIds: [],
      forceRetryIds: [],
      cancelIds: [],
    });
  });

  it('routes permanently_failed selections to replayIds only', () => {
    const logs = [log('a', 'permanently_failed'), log('b', 'permanently_failed')];
    const selected = new Set(['a', 'b']);
    expect(computeEligibility(logs, selected)).toEqual({
      replayIds: ['a', 'b'],
      forceRetryIds: [],
      cancelIds: [],
    });
  });

  it('routes pending_retry selections to BOTH forceRetryIds and cancelIds', () => {
    const logs = [log('a', 'pending_retry'), log('b', 'pending_retry')];
    const selected = new Set(['a', 'b']);
    expect(computeEligibility(logs, selected)).toEqual({
      replayIds: [],
      forceRetryIds: ['a', 'b'],
      cancelIds: ['a', 'b'],
    });
  });

  it('splits a mixed selection: DLQ → replay, pending → force/cancel', () => {
    const logs = [
      log('dlq1', 'permanently_failed'),
      log('dlq2', 'permanently_failed'),
      log('p1', 'pending_retry'),
      log('p2', 'pending_retry'),
      log('p3', 'pending_retry'),
    ];
    const selected = new Set(['dlq1', 'dlq2', 'p1', 'p2', 'p3']);
    expect(computeEligibility(logs, selected)).toEqual({
      replayIds: ['dlq1', 'dlq2'],
      forceRetryIds: ['p1', 'p2', 'p3'],
      cancelIds: ['p1', 'p2', 'p3'],
    });
  });

  it('ignores selected ids that no longer appear in logs (filter stale)', () => {
    const logs = [log('a', 'pending_retry')];
    const selected = new Set(['a', 'stale-id-from-previous-filter']);
    expect(computeEligibility(logs, selected)).toEqual({
      replayIds: [],
      forceRetryIds: ['a'],
      cancelIds: ['a'],
    });
  });

  it('ignores selections with non-actionable statuses (success/archived/etc.)', () => {
    const logs = [
      log('ok', 'success'),
      log('arch', 'archived'),
      log('retried', 'retried'),
      log('legacy', 'failed'),
      log('dlq', 'permanently_failed'),
    ];
    const selected = new Set(['ok', 'arch', 'retried', 'legacy', 'dlq']);
    expect(computeEligibility(logs, selected)).toEqual({
      replayIds: ['dlq'],
      forceRetryIds: [],
      cancelIds: [],
    });
  });

  it('preserves selection order from logs array (deterministic for UI/toast counts)', () => {
    const logs = [
      log('c', 'permanently_failed'),
      log('a', 'permanently_failed'),
      log('b', 'permanently_failed'),
    ];
    const selected = new Set(['a', 'b', 'c']);
    // Output order tracks logs[] order, not Set insertion order
    expect(computeEligibility(logs, selected).replayIds).toEqual(['c', 'a', 'b']);
  });
});
