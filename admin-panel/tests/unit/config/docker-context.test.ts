/**
 * The Docker build runs `next build`, which type-checks every file the tsconfig includes.
 * A file that ships in the build context must not import from a path .dockerignore drops
 * (e.g. a Playwright config importing ./tests/...), or the image build fails.
 * @see ../../../../.dockerignore
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const repo = resolve(__dirname, '../../../..');
const app = join(repo, 'admin-panel');
const ignored = readFileSync(join(repo, '.dockerignore'), 'utf8').split('\n')
  .map(line => line.trim()).filter(line => line && !line.startsWith('#'));

function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*');
  return new RegExp(`^${body}(?:/.*)?$`);
}
const isIgnored = (path: string) => ignored.some(glob => globToRegExp(glob).test(path));

it('root-level and script TypeScript files in the Docker context import nothing the context drops', () => {
  const offenders: string[] = [];
  const files = [...readdirSync(app), ...readdirSync(join(app, 'scripts')).map(name => `scripts/${name}`)];
  for (const file of files.filter(name => /\.tsx?$/.test(name))) {
    if (isIgnored(`admin-panel/${file}`)) continue;
    const source = readFileSync(join(app, file), 'utf8');
    for (const [, spec] of source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = join('admin-panel', file, '..', spec).replace(/\\/g, '/');
      if (isIgnored(target)) offenders.push(`${file} -> ${spec}`);
    }
  }
  expect(offenders).toEqual([]);
});
