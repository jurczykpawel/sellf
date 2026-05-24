import type { WebhookLog } from '@/types/webhooks';

export interface BatchEligibility {
  replayIds: string[];
  forceRetryIds: string[];
  cancelIds: string[];
}

// Splits the user's selection into the three batch actions, mirroring exactly
// what the per-id REST endpoints accept:
//   POST /webhooks/logs/:id/replay      → status='permanently_failed' only
//   POST /webhooks/logs/:id/force-retry → status='pending_retry' only
//   POST /webhooks/logs/:id/cancel      → status='pending_retry' only
// Stale selections (ids not in the current log list) are silently dropped.
export function computeEligibility(
  logs: WebhookLog[],
  selectedIds: Set<string>,
): BatchEligibility {
  const replayIds: string[] = [];
  const forceRetryIds: string[] = [];
  const cancelIds: string[] = [];
  for (const log of logs) {
    if (!selectedIds.has(log.id)) continue;
    if (log.status === 'permanently_failed') {
      replayIds.push(log.id);
    } else if (log.status === 'pending_retry') {
      forceRetryIds.push(log.id);
      cancelIds.push(log.id);
    }
  }
  return { replayIds, forceRetryIds, cancelIds };
}
