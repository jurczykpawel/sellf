import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/storefront-templates/fixtures';
import { STOREFRONT_TEMPLATES } from '@/lib/storefront-templates/registry';
import { registryEntrySchema } from '@/lib/storefront-templates/schemas';
import { resolveSelection } from '@/lib/storefront-templates/resolver';

vi.mock('../../../package.json', () => ({ version: '2026.11.1-rc.1', default: { version: '2026.11.1-rc.1' } }));

describe('storefront templates on a release candidate', () => {
  it.each(Object.keys(STOREFRONT_TEMPLATES))('selects %s with valid base-version metadata', (id) => {
    const templateId = id as keyof typeof STOREFRONT_TEMPLATES;
    expect(STOREFRONT_TEMPLATES[templateId].minSellf).toBe('2026.11.1');
    expect(registryEntrySchema.safeParse(STOREFRONT_TEMPLATES[templateId]).success).toBe(true);
    expect(resolveSelection({ ...DEFAULT_CONFIG, templateId }, [templateId])).toMatchObject({ templateId, diagnostic: null });
  });

  it('supports its base version but refuses a later requirement', () => {
    const original = STOREFRONT_TEMPLATES.default.minSellf;
    try {
      STOREFRONT_TEMPLATES.default.minSellf = '2026.11.1';
      expect(resolveSelection(DEFAULT_CONFIG).diagnostic).toBeNull();
      STOREFRONT_TEMPLATES.default.minSellf = '2026.11.2';
      expect(resolveSelection(DEFAULT_CONFIG).diagnostic).toBe('UNSUPPORTED');
    } finally { STOREFRONT_TEMPLATES.default.minSellf = original; }
  });
});
