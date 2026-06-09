import { describe, expect, it } from 'vitest';

import { GET } from '@/app/embed/v1/checkout.js/route';

async function getEmbedScript(): Promise<string> {
  const response = await GET();
  return await response.text();
}

describe('GET /embed/v1/checkout.js — provider-aware captcha loader', () => {
  it('does not hardcode a single captcha provider script URL', async () => {
    const script = await getEmbedScript();
    const turnstileLiteralCount = (script.match(/challenges\.cloudflare\.com\/turnstile/g) || []).length;
    expect(turnstileLiteralCount).toBe(0);
  });

  it('reads captcha.provider from the API response to dispatch', async () => {
    const script = await getEmbedScript();
    expect(script).toMatch(/captcha\.provider/);
    expect(script).toMatch(/['"]turnstile['"]/);
    expect(script).toMatch(/['"]altcha['"]/);
  });

  it('uses captcha.scriptUrl from the API response — no hardcoded URLs', async () => {
    const script = await getEmbedScript();
    expect(script).toMatch(/captcha\.scriptUrl/);
  });

  it('passes captcha.challengeUrl through to the ALTCHA widget', async () => {
    const script = await getEmbedScript();
    expect(script).toMatch(/captcha\.challengeUrl/);
  });

  it('keeps turnstileToken field on the submit payload (backward-compat naming)', async () => {
    const script = await getEmbedScript();
    expect(script).toMatch(/turnstileToken/);
  });

  it('mounts the ALTCHA widget invisibly and auto-solves (matches in-app; no unstyled checkbox to click)', async () => {
    const script = await getEmbedScript();
    // The embed loads the `external` ALTCHA build (no bundled CSS); a visible
    // widget renders unstyled. Invisible + auto-solve sidesteps styling entirely
    // and mirrors the in-app AltchaWidget config.
    expect(script).toMatch(/setAttribute\(\s*['"]auto['"]\s*,\s*['"]onload['"]\s*\)/);
    expect(script).toMatch(/setAttribute\(\s*['"]display['"]\s*,\s*['"]invisible['"]\s*\)/);
    expect(script).toMatch(/setAttribute\(\s*['"]hidelogo['"]/);
    expect(script).toMatch(/setAttribute\(\s*['"]hidefooter['"]/);
  });
});
