import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
it('provides the supported webpack dev command for browser checks',()=>{
  const pkg=JSON.parse(readFileSync(resolve(__dirname,'../../../package.json'),'utf8'));
  expect(pkg.scripts['dev:webpack']).toBe('next dev --webpack');
});

afterEach(()=>vi.unstubAllEnvs());
it.each([['','','dev'],['1','','dev:webpack'],['1','1','start']])('selects browser server command for webpack=%s production=%s',async(webpack,production,script)=>{
  vi.stubEnv('PW_WEBPACK',webpack);vi.stubEnv('PW_PRODUCTION',production);vi.resetModules();
  const config=(await import('../../../playwright.config')).default;
  const servers=Array.isArray(config.webServer)?config.webServer:[config.webServer];
  const app=servers.find(server=>server?.command.includes('E2E_MODE=true'));
  expect(app?.command).toMatch(new RegExp(`bun run ${script}(?:\\s|$)`));
});
