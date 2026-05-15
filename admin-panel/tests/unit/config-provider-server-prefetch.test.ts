import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ConfigProvider used to render "Loading configuration..." on every page until
// the client fetched /api/runtime-config. The config only depends on server
// env vars — we can build it during the server render and seed the provider
// so loading is false on the first paint.

const providerSource = readFileSync(
  resolve(__dirname, '../../src/components/providers/config-provider.tsx'),
  'utf-8',
);
const layoutSource = readFileSync(
  resolve(__dirname, '../../src/app/layout.tsx'),
  'utf-8',
);
const configBuilderSource = readFileSync(
  resolve(__dirname, '../../src/lib/runtime-config.ts'),
  'utf-8',
);
const routeSource = readFileSync(
  resolve(__dirname, '../../src/app/api/runtime-config/route.ts'),
  'utf-8',
);

describe('ConfigProvider accepts a server-built initialConfig', () => {
  it('declares an initialConfig prop on ConfigProvider', () => {
    expect(providerSource).toMatch(/initialConfig\?:\s*AppConfig(\s|\|)/);
  });

  it('seeds fetchedConfig from initialConfig so the first render has loading=false', () => {
    expect(providerSource).toMatch(/useState<AppConfig\s*\|\s*null>\(initialConfig\s*\?\?\s*null\)/);
  });

  it('skips the client fetch when initialConfig is present', () => {
    // The effect must early-return; setFetchSettled is seeded via useState init,
    // not called synchronously inside the effect (lint guard).
    expect(providerSource).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]+?if\s*\(initialConfig\)\s*return/);
    expect(providerSource).toMatch(/useState\(!!initialConfig\)/);
  });
});

describe('Layout passes server-built runtime config into ConfigProvider', () => {
  it('imports buildRuntimeConfig from the shared runtime-config module', () => {
    expect(layoutSource).toMatch(/from\s+['"]@\/lib\/runtime-config['"]/);
    expect(layoutSource).toMatch(/buildRuntimeConfig\s*\(/);
  });

  it('passes initialConfig down to ConfigProvider', () => {
    expect(layoutSource).toMatch(/<ConfigProvider[\s\S]*?initialConfig=\{/);
  });
});

describe('Shared runtime-config builder is the single source of truth', () => {
  it('exports buildRuntimeConfig() returning AppConfig shape', () => {
    expect(configBuilderSource).toMatch(/export function buildRuntimeConfig\s*\(/);
    expect(configBuilderSource).toContain('supabaseUrl');
    expect(configBuilderSource).toContain('stripePublishableKey');
    expect(configBuilderSource).toContain('captchaProvider');
  });

  it('runtime-config route uses the shared builder (no duplicated env reads)', () => {
    expect(routeSource).toContain("from '@/lib/runtime-config'");
    expect(routeSource).toMatch(/buildRuntimeConfig\s*\(/);
    // The handler must not duplicate env reads — those live in the builder.
    expect(routeSource).not.toMatch(/process\.env\.SUPABASE_URL/);
  });
});
