import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const SNIPPET = "supabase.auth.signInWithOtp({ email: 'a' })";

describe('no-restricted-syntax guard for signInWithOtp', () => {
  it('flags signInWithOtp usage outside the magic-link delivery gateway', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'eslint-otp-guard-'));
    const targetDir = path.join(process.cwd(), 'src', 'components');
    const targetFile = path.join(targetDir, `__test-otp-guard-${Date.now()}.tsx`);

    try {
      writeFileSync(targetFile, `export function Foo() {\n  ${SNIPPET};\n}\n`);
      const results = await eslint.lintFiles([targetFile]);
      const messages = results.flatMap((r) => r.messages);
      const otpErrors = messages.filter((m) => m.ruleId === 'no-restricted-syntax');
      expect(otpErrors.length).toBe(1);
    } finally {
      rmSync(targetFile, { force: true });
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not flag signInWithOtp inside deliver.ts', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const results = await eslint.lintFiles([
      path.join(process.cwd(), 'src', 'lib', 'auth', 'magic-link', 'deliver.ts'),
    ]);
    const messages = results.flatMap((r) => r.messages);
    const otpErrors = messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(otpErrors.length).toBe(0);
  });
});
