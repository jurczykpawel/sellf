import { describe, it, expect } from 'vitest';
import { getPublishChecklist } from '@/components/ProductFormModal/wizard/PublishChecklist';
import { initialFormData } from '@/components/ProductFormModal/types';

const t = ((k: string) => k) as unknown as Parameters<typeof getPublishChecklist>[2];

describe('publish checklist — bundles', () => {
  it('flags a bundle with no components', () => {
    const items = getPublishChecklist({ ...initialFormData, is_bundle: true, bundleItemIds: [] }, '', t);
    expect(items.some(i => i.id === 'bundle-components' && !i.done)).toBe(true);
  });
  it('passes a bundle with >=1 component', () => {
    const items = getPublishChecklist({ ...initialFormData, is_bundle: true, bundleItemIds: ['x'] }, '', t);
    expect(items.some(i => i.id === 'bundle-components' && !i.done)).toBe(false);
  });
});
