import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const auditSource = readFileSync(
  resolve(__dirname, '../../src/lib/actions/security-audit.ts'),
  'utf-8'
);

const layoutSource = readFileSync(
  resolve(__dirname, '../../src/app/layout.tsx'),
  'utf-8'
);

describe('security-audit app-url check', () => {
  it('reads the same env var that layout.tsx uses for metadataBase', () => {
    // layout.tsx is the source of truth for OG meta tags via metadataBase.
    expect(layoutSource).toContain('metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL');
    // The audit must check the same variable, not the unrelated NEXT_PUBLIC_APP_URL.
    const checkAppUrlBlock = auditSource.slice(
      auditSource.indexOf('async function checkAppUrl'),
      auditSource.indexOf('// ===== Environment Variable Checks =====')
    );
    expect(checkAppUrlBlock).toContain('NEXT_PUBLIC_SITE_URL');
    expect(checkAppUrlBlock).not.toContain('NEXT_PUBLIC_APP_URL');
  });

  it('mentions reverse proxy in the fix hint so deployers do not blame the proxy', () => {
    const checkAppUrlBlock = auditSource.slice(
      auditSource.indexOf('async function checkAppUrl'),
      auditSource.indexOf('// ===== Environment Variable Checks =====')
    );
    expect(checkAppUrlBlock.toLowerCase()).toMatch(/reverse[- ]proxy|proxy/);
  });
});
