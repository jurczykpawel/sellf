import { describe, it, expect } from 'vitest';
import { maskWebhookSecret } from '@/lib/webhooks/mask';

describe('maskWebhookSecret', () => {
  it('keeps the prefix and replaces the rest for whsec_ secrets', () => {
    expect(maskWebhookSecret('whsec_909e8935194549c9b23d79dec8220179')).toBe('whsec_••••••••••••••••');
  });

  it('keeps the prefix for any letters_underscore format', () => {
    expect(maskWebhookSecret('sf_abcdef0123')).toBe('sf_••••••••••••••••');
  });

  it('returns dots only for legacy hex-only secrets (no prefix)', () => {
    expect(maskWebhookSecret('909e8935194549c9b23d79dec8220179')).toBe('••••••••••••••••');
  });

  it('handles missing secrets', () => {
    expect(maskWebhookSecret(undefined)).toBe('••••••••••••••••');
    expect(maskWebhookSecret(null)).toBe('••••••••••••••••');
    expect(maskWebhookSecret('')).toBe('••••••••••••••••');
  });
});
