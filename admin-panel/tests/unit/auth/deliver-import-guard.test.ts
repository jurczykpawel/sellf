import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(__dirname, '../../../src');
const ALLOWED_FILES = [
  path.join('src', 'lib', 'auth', 'magic-link', 'deliver.ts'),
  path.join('src', 'lib', 'auth', 'magic-link', 'request.ts'),
];

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

describe('deliverMagicLink import scope', () => {
  it('is imported only by the magic-link request gateway', () => {
    const offenders: string[] = [];
    for (const file of collectFiles(SRC_DIR)) {
      const relative = path.relative(path.resolve(__dirname, '../../..'), file);
      if (ALLOWED_FILES.includes(relative)) continue;
      const content = readFileSync(file, 'utf8');
      if (/magic-link\/deliver['"]/.test(content)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });
});

describe('no-restricted-imports guard for the deliver module', () => {
  it('flags a direct import of deliverMagicLink outside request.ts', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const code = "import { deliverMagicLink } from '@/lib/auth/magic-link/deliver';\ndeliverMagicLink;\n";
    const results = await eslint.lintText(code, { filePath: 'src/components/__deliver-import-guard.tsx' });
    const messages = results.flatMap((r) => r.messages);
    const importErrors = messages.filter((m) => m.ruleId === 'no-restricted-imports');
    expect(importErrors.length).toBe(1);
  });

  it('does not flag the import inside request.ts', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const results = await eslint.lintFiles([
      path.join(process.cwd(), 'src', 'lib', 'auth', 'magic-link', 'request.ts'),
    ]);
    const messages = results.flatMap((r) => r.messages);
    const importErrors = messages.filter((m) => m.ruleId === 'no-restricted-imports');
    expect(importErrors.length).toBe(0);
  });
});
