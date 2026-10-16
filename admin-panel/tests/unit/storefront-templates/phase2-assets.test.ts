/** Public reference asset budget. @see docs/templates/phase2-contracts.md */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const root = 'tests/fixtures/storefront-sections/phase2';
function files(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
it('keeps twelve named baselines within the public fixture budget using bundled fonts', () => {
  const paths = files(root);
  const expected = ['a', 'b', 'c', 'offer'].flatMap(concept => ['desktop-1440', 'mobile-390', 'card-detail'].map(crop => `${concept}-${crop}.png`)).sort();
  expect(readdirSync(join(root, 'snapshots')).sort()).toEqual(expected);
  expect(paths.some(path => /\.(woff2?|ttf|otf)$/.test(path))).toBe(false);
  expect(paths.reduce((bytes, path) => bytes + statSync(path).size, 0)).toBeLessThanOrEqual(1_500_000);
});
