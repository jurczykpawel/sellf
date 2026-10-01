// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { buildGateScript } from '@/lib/loginwall/gate-snippet';
import { signGateToken } from '@/lib/loginwall/token';

const ORIGIN = 'https://sellf.example';
const SECRET = 'a'.repeat(64);
const SLUG = 'pro-kit';

function markup(): string {
  return `
    <div id="block" data-sellf-product="${SLUG}">
      <div data-has-access>OWNER CONTENT</div>
      <div data-no-access>BUY CTA</div>
      <div data-no-session>LOGIN CTA</div>
    </div>
    <button id="feat" data-sellf-feature="${SLUG}">Render B</button>
  `;
}

function run(opts: { authenticated: boolean; owned: string[]; rawToken?: string; hash?: string }) {
  document.body.innerHTML = markup();
  const token =
    opts.rawToken ??
    signGateToken({ userId: 'u1', authenticated: opts.authenticated, requested: [SLUG], owned: opts.owned, secret: SECRET }).token;
  window.location.hash = opts.hash ?? `#_sf_token=${token}`;
  // eslint-disable-next-line no-eval
  eval(buildGateScript({ slugs: [SLUG], sellfOrigin: ORIGIN }));
}

beforeEach(() => {
  // reset cross-test window state
  (window as unknown as Record<string, unknown>)._SF_GATE_EXECUTED = undefined;
  (window as unknown as Record<string, unknown>).SellfGate = undefined;
  window.location.hash = '';
  document.body.innerHTML = '';
});

describe('gate client runtime — display resolution', () => {
  it('owner: keeps has-access, removes the other branches, enables the feature', () => {
    run({ authenticated: true, owned: [SLUG] });
    const block = document.getElementById('block')!;
    expect(block.querySelector('[data-has-access]')).not.toBeNull();
    expect(block.querySelector('[data-no-access]')).toBeNull();
    expect(block.querySelector('[data-no-session]')).toBeNull();
    expect(block.classList.contains('sellf-has-access')).toBe(true);
    expect(block.classList.contains('sellf-processed')).toBe(true);
    const feat = document.getElementById('feat') as HTMLButtonElement;
    expect(feat.disabled).toBe(false);
    expect(feat.classList.contains('sellf-feature-enabled')).toBe(true);
  });

  it('authenticated non-owner: keeps no-access, locks the feature', () => {
    run({ authenticated: true, owned: [] });
    const block = document.getElementById('block')!;
    expect(block.querySelector('[data-no-access]')).not.toBeNull();
    expect(block.querySelector('[data-has-access]')).toBeNull();
    expect(block.querySelector('[data-no-session]')).toBeNull();
    expect(block.classList.contains('sellf-no-access')).toBe(true);
    const feat = document.getElementById('feat') as HTMLButtonElement;
    expect(feat.disabled).toBe(true);
    expect(feat.classList.contains('sellf-feature-locked')).toBe(true);
  });

  it('anonymous: keeps no-session branch', () => {
    run({ authenticated: false, owned: [] });
    const block = document.getElementById('block')!;
    expect(block.querySelector('[data-no-session]')).not.toBeNull();
    expect(block.querySelector('[data-has-access]')).toBeNull();
    expect(block.querySelector('[data-no-access]')).toBeNull();
    expect(block.classList.contains('sellf-no-session')).toBe(true);
  });

  it('malformed token: fails closed to no-session', () => {
    run({ authenticated: true, owned: [SLUG], rawToken: 'garbage.sig' });
    const block = document.getElementById('block')!;
    expect(block.classList.contains('sellf-no-session')).toBe(true);
    expect(block.querySelector('[data-has-access]')).toBeNull();
  });

  it('strips the token from the URL and preserves an unrelated fragment', () => {
    const token = signGateToken({ userId: 'u1', authenticated: true, requested: [SLUG], owned: [SLUG], secret: SECRET }).token;
    run({ authenticated: true, owned: [SLUG], hash: `#section&_sf_token=${token}` });
    expect(window.location.hash).toBe('#section');
    expect(window.location.hash).not.toContain('_sf_token');
  });

  it('exposes SellfGate.verify', () => {
    run({ authenticated: true, owned: [SLUG] });
    const gate = (window as unknown as Record<string, unknown>).SellfGate as { verify: unknown } | undefined;
    expect(typeof gate?.verify).toBe('function');
  });
});

describe('gate client runtime — SellfGate.verify()', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('calls the verify endpoint with the slug URL-encoded as a query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ access: true }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    run({ authenticated: true, owned: [SLUG] });
    const gate = (window as unknown as Record<string, unknown>).SellfGate as { verify: (slug: string) => Promise<boolean> };

    const result = await gate.verify('slug with spaces');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, unknown];
    expect(url).toBe(`${ORIGIN}/api/loginwall/verify?product=${encodeURIComponent('slug with spaces')}`);
  });

  it('resolves to false (not a rejected promise) when the fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;
    run({ authenticated: true, owned: [SLUG] });
    const gate = (window as unknown as Record<string, unknown>).SellfGate as { verify: (slug: string) => Promise<boolean> };

    await expect(gate.verify(SLUG)).resolves.toBe(false);
  });

  it('resolves to false when the response body is not valid JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ json: () => Promise.reject(new Error('bad json')) }) as unknown as typeof fetch;
    run({ authenticated: true, owned: [SLUG] });
    const gate = (window as unknown as Record<string, unknown>).SellfGate as { verify: (slug: string) => Promise<boolean> };

    await expect(gate.verify(SLUG)).resolves.toBe(false);
  });
});
