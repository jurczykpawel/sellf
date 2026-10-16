/** Shipped author examples use the same contracts as the offline checker. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTemplate } from '@/lib/storefront-templates/check';
import { DEFAULT_CONFIG, D_CONFIG, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { parseBoundedJson } from '@/lib/storefront-templates/json';

const directory = resolve(process.cwd(), '../skills/sellf-template-author/examples');
describe('shipped author examples', () => {
  for (const [name, canonical] of [['default', DEFAULT_CONFIG], ['d', D_CONFIG]] as const) {
    it(`checks the complete ${name} starter with bounded public bindings`, () => {
      const parsed = parseBoundedJson(readFileSync(resolve(directory, `${name}.json`)));
      expect(parsed.valid).toBe(true);
      if (!parsed.valid) return;
      expect(parsed.data).toEqual(canonical);
      const checked = checkTemplate(parsed.data, 'publish', PUBLIC_FIXTURE);
      expect(checked.valid, JSON.stringify(checked.errors)).toBe(true);
      expect(checked.errors).toEqual([]);
      if (name === 'd') expect(checked.warnings.some(issue => issue.code === 'TRANSLATION_FALLBACK')).toBe(true);
    });
  }
});
