// @vitest-environment happy-dom

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useWindowDimensions } from '@/app/[locale]/p/[slug]/payment-status/hooks/useWindowDimensions';

function DimensionsProbe() {
  const { width, height } = useWindowDimensions();
  return createElement('span', null, `${width}x${height}`);
}

describe('useWindowDimensions hydration contract', () => {
  it('uses the same zero-sized snapshot for SSR and the first client render', () => {
    window.innerWidth = 1280;
    window.innerHeight = 720;

    expect(renderToString(createElement(DimensionsProbe))).toContain('0x0');
  });
});
