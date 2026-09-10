import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(__dirname, '../../../src');
const ALLOWED_FILE = path.join('src', 'lib', 'auth', 'magic-link', 'deliver.ts');

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('signInWithOtp usage', () => {
  it('is called only from the magic-link delivery gateway', () => {
    const offenders: string[] = [];
    for (const file of collectFiles(SRC_DIR)) {
      const relative = path.relative(path.resolve(__dirname, '../../..'), file);
      if (relative === ALLOWED_FILE) continue;
      const content = readFileSync(file, 'utf8');
      if (content.includes('signInWithOtp')) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });
});
