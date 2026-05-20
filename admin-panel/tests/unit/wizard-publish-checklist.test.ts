import { describe, it, expect } from 'vitest';
import { getPublishChecklist } from '@/components/ProductFormModal/wizard/PublishChecklist';
import { initialFormData } from '@/components/ProductFormModal/types';

const t = ((key: string) => key) as unknown as Parameters<typeof getPublishChecklist>[2];

describe('getPublishChecklist', () => {
  it('standard product: name + price required, both missing -> two unmet items', () => {
    const items = getPublishChecklist({ ...initialFormData, price: 49 }, '', t);
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.name?.ok).toBe(false);
    expect(byKey.price?.ok).toBe(false);
  });

  it('standard product: name + price filled -> all met', () => {
    const items = getPublishChecklist(
      { ...initialFormData, name: 'My Product', price: 49 },
      '49,99',
      t,
    );
    expect(items.every((i) => i.ok)).toBe(true);
  });

  it('subscription: requires recurring_price, not price', () => {
    const items = getPublishChecklist(
      {
        ...initialFormData,
        name: 'Sub',
        product_type: 'subscription',
        recurring_price: 49,
      },
      '',
      t,
    );
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.recurring_price?.ok).toBe(true);
    expect(byKey.price).toBeUndefined();
  });

  it('subscription with recurring_price=0 fails the checklist', () => {
    const items = getPublishChecklist(
      {
        ...initialFormData,
        name: 'Sub',
        product_type: 'subscription',
        recurring_price: 0,
      },
      '',
      t,
    );
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.recurring_price?.ok).toBe(false);
  });

  it('lead-magnet (free, no PWYW): requires a content item, not a price', () => {
    const items = getPublishChecklist(
      { ...initialFormData, name: 'Free PDF' },
      '',
      t,
    );
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.content?.ok).toBe(false);
    expect(byKey.price).toBeUndefined();
  });

  it('lead-magnet with content items passes', () => {
    const items = getPublishChecklist(
      {
        ...initialFormData,
        name: 'Free PDF',
        content_config: {
          content_items: [
            {
              id: '1',
              type: 'download_link',
              title: 'PDF',
              config: { download_url: 'https://example.com/file.pdf' },
            },
          ],
        },
      },
      '',
      t,
    );
    expect(items.every((i) => i.ok)).toBe(true);
  });

  it('tip-jar: requires name only (price is configured via suggested amounts elsewhere)', () => {
    const items = getPublishChecklist(
      {
        ...initialFormData,
        name: 'Donations',
        checkout_template: 'tip-jar',
        allow_custom_price: true,
      },
      '',
      t,
    );
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.name?.ok).toBe(true);
    expect(byKey.price).toBeUndefined();
    expect(byKey.recurring_price).toBeUndefined();
    expect(byKey.content).toBeUndefined();
  });
});
