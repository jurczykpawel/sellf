/** Authentic signed requirements and the installed trust anchor. */
import { generateKeyPairSync, sign } from 'crypto';
import { readFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('fs', () => ({ readFileSync: vi.fn() }));
vi.mock('@/lib/system/upgrade-runtime-server', () => ({ findUpgradeScript: () => '/install/scripts/upgrade.sh' }));
import { checkLatestUpdaterCompatibility, getUpdaterCompatibility, readInstalledUpdater, refreshUpdaterCompatibility } from '@/lib/system/updater-compatibility';
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' });
const prefix = 'https://github.com/jurczykpawel/sellf/releases/download/v2026.11.0/';
const release = (v2 = true) => ({ tag_name: 'v2026.11.0', assets: (v2 ? ['sellf-build.v2.manifest', 'sellf-build.v2.manifest.sig'] : ['sellf-build.manifest', 'sellf-build.manifest.sig']).map(name => ({ name, browser_download_url: prefix + name })) });
const manifest = (minimum?: string) => `version=2026.11.0\nsha256=${'a'.repeat(64)}\n${minimum === undefined ? '' : `min_updater_version=${minimum}\n`}`;
function installed(version?: string) {
  vi.mocked(readFileSync).mockReturnValue(`${version === undefined ? '' : `UPDATER_VERSION=${version}\n`}# release-signing-key:start\n${publicKey}# release-signing-key:end\n`);
}
function serve(text: string) {
  const signature = sign(null, Buffer.from(text), keys.privateKey);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('.sig') ? signature : text)));
}
beforeEach(() => { installed('2'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('signed updater compatibility', () => {
  it('treats the unversioned 10.6 script as updater 1', () => {
    expect(readInstalledUpdater().version).toBe(2); installed(); expect(readInstalledUpdater().version).toBe(1);
  });
  it.each(['1', '2', '3'])('compares the signed minimum %s before launch', async minimum => {
    serve(manifest(minimum));
    expect(await getUpdaterCompatibility(release())).toMatchObject({ version: 2, min_updater_version: Number(minimum), compatible: Number(minimum) <= 2 });
  });
  it('keeps legacy and updater-1 bridge releases compatible', async () => {
    installed(); serve(manifest());
    expect(await getUpdaterCompatibility(release(false))).toMatchObject({ version: 1, min_updater_version: 1, compatible: true });
    serve(manifest('1')); expect((await getUpdaterCompatibility(release())).compatible).toBe(true);
  });
  it.each(['0', '-1', 'abc', '2\nextra=1', '999999999999999999999'])('rejects malformed signed minimum %j', async minimum => {
    serve(manifest(minimum)); expect(await getUpdaterCompatibility(release())).toMatchObject({ compatible: false, reason: 'verification_failed' });
  });
  it('does not trust an unsigned change to the minimum', async () => {
    serve(manifest('1')); vi.mocked(fetch).mockResolvedValueOnce(new Response(manifest('3')));
    expect(await getUpdaterCompatibility(release())).toMatchObject({ compatible: false, reason: 'verification_failed' });
  });
  it('rejects another release version even when signed', async () => {
    serve(manifest('1').replace('2026.11.0', '2026.10.6')); expect((await getUpdaterCompatibility(release())).compatible).toBe(false);
  });
  it('refuses an incomplete v2 pair instead of using legacy assets', async () => {
    serve(manifest('1')); const metadata = release(); metadata.assets.pop(); metadata.assets.push(...release(false).assets);
    expect((await getUpdaterCompatibility(metadata)).compatible).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects origins outside the official tagged release', async () => {
    serve(manifest('1')); const metadata = release(); metadata.assets[0].browser_download_url = 'http://127.0.0.1/private';
    expect((await getUpdaterCompatibility(metadata)).compatible).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it('recompares cached signed requirements with the installed file', async () => {
    serve(manifest('2'));
    const cached = await getUpdaterCompatibility(release());
    installed();
    expect(refreshUpdaterCompatibility(cached)).toMatchObject({ version: 1, min_updater_version: 2, compatible: false });
  });
  it('bounds asset bodies' , async () => { serve('x'.repeat(5000)); expect((await getUpdaterCompatibility(release())).compatible).toBe(false); });
  it('ignores the notification override for authorization', async () => {
    vi.stubEnv('SELLF_UPDATE_CHECK_URL', 'http://localhost/fixture'); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect((await checkLatestUpdaterCompatibility()).compatible).toBe(false);
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/jurczykpawel/sellf/releases/latest', expect.any(Object));
  });
});
