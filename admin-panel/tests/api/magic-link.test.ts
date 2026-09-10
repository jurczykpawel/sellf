/**
 * API Integration Test: magic-link gateway
 *
 * Exercises the full path: solve an ALTCHA challenge, request a magic link
 * through /api/auth/magic-link, confirm delivery in Mailpit, and follow the
 * link through /auth/callback.
 */
import { describe, it, expect } from 'vitest';
import { createChallenge, solveChallenge } from 'altcha-lib/v1';
import { API_URL } from './setup';
import { waitForEmail } from '../helpers/mailpit';

async function getAltchaPayload(): Promise<string> {
  const response = await fetch(`${API_URL}/api/captcha/challenge`);
  const challenge = await response.json();

  const { promise } = solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm);
  const solution = await promise;
  if (!solution) throw new Error('Failed to solve ALTCHA challenge');

  return btoa(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      number: solution.number,
      salt: challenge.salt,
      signature: challenge.signature,
    }),
  );
}

function extractHref(html: string): string | null {
  const match = html.match(/href="([^"]+)"/);
  return match ? match[1].replace(/&amp;/g, '&') : null;
}

describe('Magic-link gateway', () => {
  it('sends a login magic link with a token_hash callback link', async () => {
    const email = `gw-${Date.now()}@example.com`;
    const captchaToken = await getAltchaPayload();

    const response = await fetch(`${API_URL}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, captchaToken, flow: 'login' }),
    });
    expect(response.status).toBe(200);

    const message = await waitForEmail(email);
    const href = extractHref(message.HTML || '');
    expect(href).toBeTruthy();
    expect(href).toContain('/auth/callback?flow=login');
    expect(href).toContain('token_hash=');
    expect(href).not.toContain('/auth/v1/verify');
    expect(href).not.toContain('redirect_to=');

    const linkUrl = new URL(href!);
    const rewritten = new URL(API_URL);
    linkUrl.protocol = rewritten.protocol;
    linkUrl.host = rewritten.host;

    const callbackResponse = await fetch(linkUrl.toString(), { redirect: 'manual' });
    expect(callbackResponse.status).toBeGreaterThanOrEqual(300);
    expect(callbackResponse.status).toBeLessThan(400);
    const location = callbackResponse.headers.get('location') || '';
    expect(location).not.toContain('/login?error=');
    // Fresh, non-admin signup: no redirect_to was requested, so the callback
    // falls back to its own role-based default rather than always /dashboard.
    expect(location).toContain('/my-products');
    expect(callbackResponse.headers.get('set-cookie')).toBeTruthy();
  });

  it('rejects an unsolved captcha token and never sends an email', async () => {
    const email = `gw-bad-${Date.now()}@example.com`;

    const response = await fetch(`${API_URL}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, captchaToken: 'garbage', flow: 'login' }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('captcha_failed');

    const search = await fetch(
      `http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const data = await search.json();
    expect(data.messages || []).toHaveLength(0);
  });

  it('sends a free-product magic link whose redirect targets the product access page', async () => {
    const email = `gw-free-${Date.now()}@example.com`;
    const captchaToken = await getAltchaPayload();

    const response = await fetch(`${API_URL}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, captchaToken, flow: 'free_product', productSlug: 'free-tutorial' }),
    });
    expect(response.status).toBe(200);

    const message = await waitForEmail(email);
    const href = extractHref(message.HTML || '');
    expect(href).toBeTruthy();
    const redirectTo = decodeURIComponent(href!.split('redirect_to=')[1].split('&token_hash=')[0]);
    expect(redirectTo).toBe('/auth/product-access?product=free-tutorial');
  });
});
