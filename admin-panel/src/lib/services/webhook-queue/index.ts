import type { IWebhookDeliveryQueue } from './types';
import { SupabaseWebhookQueue } from './supabase-queue';
import { SqsWebhookQueue } from './sqs-queue';

export type {
  IWebhookDeliveryQueue,
  AttemptResult,
  DueDelivery,
  FirstAttemptInput,
  RecordedDelivery,
} from './types';
export { WebhookDispatcher } from './dispatcher';
export {
  computeNextRetry,
  hasMoreAttempts,
  DEFAULT_MAX_ATTEMPTS,
  RETRY_DELAYS_SECONDS,
} from './retry-policy';
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
