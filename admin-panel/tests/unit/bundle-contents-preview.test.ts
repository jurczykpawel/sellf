/**
 * Coverage for the public checkout "This bundle includes:" block
 * (BundleContentsPreview). The component renders the component list in both
 * pricing modes and an adaptive savings line only when the bundle is cheaper
 * than buying the components separately.
 *
 * Rendered with renderToStaticMarkup in the node test env (same approach as
 * markdown-sanitize.test.ts) — no jsdom/RTL. next-intl is satisfied with a
 * NextIntlClientProvider carrying inline messages for the keys under test.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import BundleContentsPreview, {
  type BundleComponentSummary,
} from '@/app/[locale]/checkout/[slug]/components/BundleContentsPreview';

const messages = {
  checkout: {
    bundleIncludes: 'This bundle includes:',
    bundleSavings: 'Save {amount} ({pct}% off)',
  },
};

function render(props: {
  bundlePrice: number;
  currency: string;
  components: BundleComponentSummary[];
}): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'en', messages },
      createElement(BundleContentsPreview, props),
    ),
  );
}

function makeComponent(
  overrides: Partial<BundleComponentSummary> & Pick<BundleComponentSummary, 'id' | 'name' | 'price'>,
): BundleComponentSummary {
  return {
    icon: '📦',
    slug: overrides.id,
    ...overrides,
  };
}

const components: BundleComponentSummary[] = [
  makeComponent({ id: 'a', name: 'Course A', icon: '🎓', price: 60 }),
  makeComponent({ id: 'b', name: 'Course B', icon: '📘', price: 40 }),
];

describe('BundleContentsPreview', () => {
  it('always lists the component names + icons', () => {
    const html = render({ bundlePrice: 80, currency: 'USD', components });
    expect(html).toContain('This bundle includes:');
    expect(html).toContain('Course A');
    expect(html).toContain('Course B');
    expect(html).toContain('🎓');
    expect(html).toContain('📘');
  });

  it('savings mode: bundlePrice < componentsSum → struck-through sum + save %', () => {
    // sum = 100, bundle = 80 → save $20 (20% off)
    const html = render({ bundlePrice: 80, currency: 'USD', components });
    expect(html).toContain('line-through');
    expect(html).toContain('$100.00'); // components sum
    expect(html).toContain('Save $20.00 (20% off)');
  });

  it('included mode: bundlePrice >= componentsSum → NO savings claim', () => {
    // sum = 100, bundle = 120 → not a saving
    const html = render({ bundlePrice: 120, currency: 'USD', components });
    expect(html).toContain('This bundle includes:');
    expect(html).toContain('Course A');
    expect(html).not.toContain('line-through');
    expect(html).not.toContain('% off)');
    expect(html).not.toContain('bundle-savings');
  });

  it('included mode at exact parity (bundlePrice === componentsSum)', () => {
    const html = render({ bundlePrice: 100, currency: 'USD', components });
    expect(html).not.toContain('% off)');
  });

  it('weights PWYW components by custom_price_min, not price', () => {
    // PWYW component: price 0 but suggested min 30; other 40 → sum 70, bundle 50 → save 20 (~29%)
    const pwyw: BundleComponentSummary[] = [
      makeComponent({ id: 'p', name: 'Pay What You Want', price: 0, allow_custom_price: true, custom_price_min: 30 }),
      makeComponent({ id: 'q', name: 'Fixed', price: 40 }),
    ];
    const html = render({ bundlePrice: 50, currency: 'USD', components: pwyw });
    expect(html).toContain('$70.00'); // weighted sum
    expect(html).toContain('29% off'); // round(20/70*100)=29
  });
});
