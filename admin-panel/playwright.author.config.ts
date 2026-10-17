/** Isolated publication acceptance with a local license fixture. */
import { generateKeyPairSync, createSign } from 'node:crypto';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const payload = Buffer.from(JSON.stringify({
  v: 1, kid: 'author-fixture', product: 'author-fixture', email: 'fixture@example.com', order: 'fixture',
  tier: 'business', domain: 'author.example.test', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
})).toString('base64url');
const token = `${payload}.${createSign('SHA256').update(payload).end().sign(privateKey).toString('base64url')}`;
export default defineConfig({
  ...base,
  testMatch: '**/storefront-author-flow.acceptance.ts',
  projects: [{ name: 'author', use: { browserName: 'chromium' } }],
  workers: 1,
  webServer: (Array.isArray(base.webServer) ? base.webServer : []).map(server => ({
    ...server,
    reuseExistingServer: false,
    env: {
      ...server.env,
      SITE_URL: 'http://author.example.test', NEXT_PUBLIC_SITE_URL: 'http://author.example.test',
      SELLF_LICENSE_PRODUCTS: 'author-fixture', SELLF_LICENSE_KEY: token,
      SELLF_JWKS_FALLBACK: JSON.stringify({ keys: [{ kid: 'author-fixture', alg: 'ES256', pem: publicKey.export({ type: 'spki', format: 'pem' }) }] }),
    },
  })),
});
