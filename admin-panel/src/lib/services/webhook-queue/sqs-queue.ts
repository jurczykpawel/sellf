import type {
  AttemptResult,
  DueDelivery,
  FirstAttemptInput,
  IWebhookDeliveryQueue,
  RecordedDelivery,
} from './types';

function notImplemented(method: string): never {
  throw new Error(`SqsWebhookQueue.${method} is not implemented yet`);
}

export class SqsWebhookQueue implements IWebhookDeliveryQueue {
  async recordFirstAttempt(_input: FirstAttemptInput): Promise<RecordedDelivery> {
    notImplemented('recordFirstAttempt');
  }
  async pickDue(_limit: number): Promise<DueDelivery[]> {
    notImplemented('pickDue');
  }
  async markDelivered(_deliveryId: string, _result: AttemptResult): Promise<void> {
    notImplemented('markDelivered');
  }
  async markFailed(_deliveryId: string, _result: AttemptResult, _nextRetryAt: Date): Promise<void> {
    notImplemented('markFailed');
  }
  async markPermanentlyFailed(_deliveryId: string, _result: AttemptResult): Promise<void> {
    notImplemented('markPermanentlyFailed');
  }
  async replay(_deliveryId: string): Promise<void> {
    notImplemented('replay');
  }
  async forceRetryNow(_deliveryId: string): Promise<void> {
    notImplemented('forceRetryNow');
  }
  async cancel(_deliveryId: string): Promise<void> {
    notImplemented('cancel');
  }
}
