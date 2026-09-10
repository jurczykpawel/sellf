import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import path from 'path';

const SNIPPET = "supabase.auth.signInWithOtp({ email: 'a' })";

describe('no-restricted-syntax guard for signInWithOtp', () => {
  it('flags signInWithOtp usage outside the magic-link delivery gateway', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const code = `export function Foo() {\n  ${SNIPPET};\n}\n`;
    const results = await eslint.lintText(code, { filePath: 'src/components/__otp-guard.tsx' });
    const messages = results.flatMap((r) => r.messages);
    const otpErrors = messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(otpErrors.length).toBe(1);
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
