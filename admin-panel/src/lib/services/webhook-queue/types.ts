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
  deliveryKey?: string | null;
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
