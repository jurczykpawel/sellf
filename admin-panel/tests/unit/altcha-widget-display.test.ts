/**
 * Locks the AltchaWidget rendering contract:
 *   - display="invisible" so the captcha runs in the background without
 *     showing the "Verified" box on the page (proof-of-work needs zero
 *     user interaction; the visible widget is unnecessary chrome).
 *   - challenge="/api/captcha/challenge" so the v3 widget actually
 *     fetches the challenge endpoint (not the legacy `challengeurl`).
 *   - hidelogo + hidefooter so no ALTCHA branding leaks through any
 *     accidental display fallback.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const WIDGET_FILE = join(__dirname, '../../src/components/captcha/AltchaWidget.tsx');

describe('AltchaWidget rendering contract', () => {
  const source = readFileSync(WIDGET_FILE, 'utf-8');

  it('renders altcha-widget with display="invisible"', () => {
    expect(source).toMatch(/display=["']invisible["']/);
  });

  it('uses the v3 challenge attribute (not the legacy challengeurl)', () => {
    expect(source).toMatch(/challenge=["']\/api\/captcha\/challenge["']/);
    expect(source).not.toMatch(/challengeurl=/);
  });

  it('hides the ALTCHA logo and footer attribution', () => {
    expect(source).toMatch(/hidelogo\b/);
    expect(source).toMatch(/hidefooter\b/);
  });

  it('does not pass v2-era floating attribute (deprecated in v3)', () => {
    expect(source).not.toMatch(/floating=["'](top|bottom|auto)["']/);
  });
});
