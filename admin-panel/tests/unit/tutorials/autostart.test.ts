import { afterEach, describe, expect, it, vi } from 'vitest';
import { tutorialAutostartEnabled, AUTOSTART_COOKIE } from '@/lib/tutorials/autostart';

afterEach(() => vi.unstubAllEnvs());

describe('tutorial auto-start', () => {
  it('is on for normal deployments', () => {
    vi.stubEnv('E2E_MODE', 'false');
    expect(tutorialAutostartEnabled(undefined)).toBe(true);
  });

  it('stays off on automated test servers unless a test opts in', () => {
    vi.stubEnv('E2E_MODE', 'true');
    expect(tutorialAutostartEnabled(undefined)).toBe(false);
    expect(tutorialAutostartEnabled('off')).toBe(false);
    expect(tutorialAutostartEnabled('on')).toBe(true);
    expect(AUTOSTART_COOKIE).toBe('sellf_tutorial_autostart');
  });
});
