import { validateWebhookUrlAsync } from '@/lib/validations/webhook';

export class UnsafeOutboundUrlError extends Error {
  readonly url: string;
  constructor(url: string, reason: string) {
    super(`Refused outbound to ${url}: ${reason}`);
    this.name = 'UnsafeOutboundUrlError';
    this.url = url;
  }
}

/**
 * Pre-flight an outbound URL before issuing a fetch. Layers on top of the
 * existing webhook URL validator so admin-controlled URLs (tracking
 * containers, FB endpoints, custom webhooks) all run through the same
 * private-IP guard.
 *
 * Throws UnsafeOutboundUrlError when the URL targets a private/reserved
 * address space or fails sync validation.
 */
export async function assertSafeOutboundUrl(url: string): Promise<void> {
  const result = await validateWebhookUrlAsync(url);
  if (!result.valid) {
    throw new UnsafeOutboundUrlError(url, result.error ?? 'unsafe url');
  }
}
