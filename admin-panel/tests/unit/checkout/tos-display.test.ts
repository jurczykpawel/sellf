import { describe, expect, it } from 'vitest';

import { shouldShowTosCheckbox } from '@/lib/checkout/tos-display';

describe('shouldShowTosCheckbox', () => {
  it('shows for a guest when the setting is ON', () => {
    expect(shouldShowTosCheckbox(true, true)).toBe(true);
  });
  it('hides when the setting is OFF, even for a guest', () => {
    expect(shouldShowTosCheckbox(false, true)).toBe(false);
  });
  it('hides for a logged-in buyer (already accepted at signup) even when ON', () => {
    expect(shouldShowTosCheckbox(true, false)).toBe(false);
  });
});
