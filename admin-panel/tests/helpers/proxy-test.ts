/** A safelisted language tag identifies independent clients to the local production-test proxy. */
import { randomBytes } from 'node:crypto';
import { test as base, expect } from '@playwright/test';

export { expect };
export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders, locale }, use) => {
    const id = randomBytes(8).toString('hex');
    await use({ 'accept-language': `${locale || 'en-US'}, x-sellf-${id.slice(0, 8)}-${id.slice(8)};q=0.1`, ...extraHTTPHeaders });
  },
});
