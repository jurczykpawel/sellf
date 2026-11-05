import type { Page } from '@playwright/test';

/** Surface checkout transport errors while the test is still on the failed step. */
export function assertStripeTransport(page: Page): void {
  page.on('requestfailed', request => {
    const error = request.failure()?.errorText;
    const url = new URL(request.url());
    if (!error || error === 'net::ERR_ABORTED' || ![
      'js.stripe.com', 'api.stripe.com', 'checkout.stripe.com',
    ].includes(url.hostname)) return;
    throw new Error(`Stripe checkout transport: ${error} (${url.origin}${url.pathname})`);
  });
}
