import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../');

describe('product page resolves server-side without a Suspense fallback', () => {
  it('no loading.tsx for /p/[slug] — React 19 streaming there left a duplicate hidden <div id="S:0"> in dev mode, breaking strict-mode locators across sequential navigations', () => {
    const path = resolve(root, 'src/app/[locale]/p/[slug]/loading.tsx');
    expect(existsSync(path)).toBe(false);
  });

  it('page.tsx uses local license state alongside the auth read', () => {
    const source = readFileSync(
      resolve(root, 'src/app/[locale]/p/[slug]/page.tsx'),
      'utf-8',
    );
    expect(source).toMatch(/Promise\.all\(\[\s*checkPublicFeature\(['"]watermark-removal['"]\),/);
    expect(source).toMatch(/Promise\.all\([\s\S]+?createClient\(\)/);
  });
});
