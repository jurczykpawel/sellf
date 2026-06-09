import { describe, it, expect } from 'vitest';
import { gtmLoaderBaseUrl } from '@/lib/tracking/gtm';

describe('gtmLoaderBaseUrl', () => {
  it('always loads gtm.js from Google\'s CDN', () => {
    expect(gtmLoaderBaseUrl()).toBe('https://www.googletagmanager.com');
  });

  it('ignores gtm_server_container_url — sGTM is transport-only and 400s on gtm.js', () => {
    expect(
      gtmLoaderBaseUrl({ gtm_server_container_url: 'https://t.techskills.academy' }),
    ).toBe('https://www.googletagmanager.com');
    expect(
      gtmLoaderBaseUrl({ gtm_server_container_url: 'https://t.techskills.academy/' }),
    ).toBe('https://www.googletagmanager.com');
  });
});
