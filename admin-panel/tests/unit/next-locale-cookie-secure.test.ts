import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const proxySource = readFileSync(
  resolve(__dirname, '../../src/proxy.ts'),
  'utf-8'
);

const siteMenuSource = readFileSync(
  resolve(__dirname, '../../src/components/SiteMenu.tsx'),
  'utf-8'
);

describe('NEXT_LOCALE cookie Secure flag', () => {
  it('proxy.ts rewrites NEXT_LOCALE with secure:true in production', () => {
    expect(proxySource).toContain("intlResponse.cookies.has('NEXT_LOCALE')");
    expect(proxySource).toMatch(/secure:\s*true/);
    expect(proxySource).toContain("process.env.NODE_ENV === 'production'");
  });

  it('SiteMenu client-side write attaches Secure on https pages', () => {
    expect(siteMenuSource).toContain("window.location.protocol === 'https:'");
    expect(siteMenuSource).toMatch(/`NEXT_LOCALE=\$\{newLocale\}[^`]*\$\{secure\}`/);
  });
});
