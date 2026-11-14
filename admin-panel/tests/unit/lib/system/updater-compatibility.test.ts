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
const TAG = 'v2026.11.0';
const manifest = (minimum?: string) => `version=2026.11.0\nsha256=${'a'.repeat(64)}\n${minimum === undefined ? '' : `min_updater_version=${minimum}\n`}`;
function installed(version?: string) {
  vi.mocked(readFileSync).mockReturnValue(`${version === undefined ? '' : `UPDATER_VERSION=${version}\n`}# release-signing-key:start\n${publicKey}# release-signing-key:end\n`);
}
/** Serves `text` as the manifest; `missing` file names answer 404 like github.com. */
function serve(text: string, missing: string[] = []) {
  const signature = sign(null, Buffer.from(text), keys.privateKey);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/releases/latest')) return new Response(null, { status: 302, headers: { location: 'https://github.com/jurczykpawel/sellf/releases/tag/v2026.11.0' } });
    if (missing.some(name => url === prefix + name)) return new Response('Not Found', { status: 404 });
    return new Response(url.endsWith('.sig') ? signature : text);
  }));
}
const legacy = ['sellf-build.v2.manifest', 'sellf-build.v2.manifest.sig'];
beforeEach(() => { installed('2'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('signed updater compatibility', () => {
  it('treats the unversioned 10.6 script as updater 1', () => {
    expect(readInstalledUpdater().version).toBe(2); installed(); expect(readInstalledUpdater().version).toBe(1);
  });
  it.each(['1', '2', '3'])('compares the signed minimum %s before launch', async minimum => {
    serve(manifest(minimum));
    expect(await getUpdaterCompatibility(TAG)).toMatchObject({ version: 2, min_updater_version: Number(minimum), compatible: Number(minimum) <= 2 });
  });
  it('keeps legacy and updater-1 bridge releases compatible', async () => {
    installed(); serve(manifest(), legacy);
    expect(await getUpdaterCompatibility(TAG)).toMatchObject({ version: 1, min_updater_version: 1, compatible: true });
    expect(fetch).toHaveBeenCalledWith(prefix + 'sellf-build.manifest', expect.any(Object));
    serve(manifest('1')); expect((await getUpdaterCompatibility(TAG)).compatible).toBe(true);
  });
  it.each(['0', '-1', 'abc', '2\nextra=1', '999999999999999999999'])('rejects malformed signed minimum %j', async minimum => {
    serve(manifest(minimum)); expect(await getUpdaterCompatibility(TAG)).toMatchObject({ compatible: false, reason: 'verification_failed' });
  });
  it('does not trust an unsigned change to the minimum', async () => {
    serve(manifest('1')); vi.mocked(fetch).mockResolvedValueOnce(new Response(manifest('3')));
    expect(await getUpdaterCompatibility(TAG)).toMatchObject({ compatible: false, reason: 'verification_failed', failure: { code: 'signature_invalid' } });
  });
  it('rejects another release version even when signed', async () => {
    serve(manifest('1').replace('2026.11.0', '2026.10.6')); expect((await getUpdaterCompatibility(TAG)).compatible).toBe(false);
  });
  it.each([['sellf-build.v2.manifest.sig'], ['sellf-build.v2.manifest']])('refuses an incomplete v2 pair (missing %s) instead of using legacy assets', async missingFile => {
    serve(manifest('1'), [missingFile]);
    expect(await getUpdaterCompatibility(TAG)).toMatchObject({
      compatible: false, reason: 'verification_failed',
      failure: { code: 'release_asset_missing', details: { http_status: 404, asset: missingFile } },
    });
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).not.toContain(prefix + 'sellf-build.manifest');
  });
  it('requests only release files of the official repository by tag', async () => {
    serve(manifest('1'));
    await getUpdaterCompatibility(TAG);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url).sort()).toEqual([prefix + 'sellf-build.v2.manifest', prefix + 'sellf-build.v2.manifest.sig']);
  });
  it.each(['v2026.11.0/../x', '2026.11', 'v2026.11.0-rc1'])('rejects the release tag %j without any request', async tag => {
    serve(manifest('1'));
    expect((await getUpdaterCompatibility(tag)).compatible).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('passes the GitHub failure through for the panel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"Server Error"}', { status: 500, headers: { 'content-type': 'application/json' } })));
    expect(await getUpdaterCompatibility(TAG)).toMatchObject({ compatible: false, failure: { code: 'github_http', details: { http_status: 500, github_message: 'Server Error' } } });
  });
  it('recompares cached signed requirements with the installed file', async () => {
    serve(manifest('2'));
    const cached = await getUpdaterCompatibility(TAG);
    installed();
    expect(refreshUpdaterCompatibility(cached)).toMatchObject({ version: 1, min_updater_version: 2, compatible: false });
  });
  it('bounds asset bodies' , async () => { serve('x'.repeat(5000)); expect((await getUpdaterCompatibility(TAG)).compatible).toBe(false); });
  it('ignores the notification override for authorization', async () => {
    vi.stubEnv('SELLF_UPDATE_CHECK_URL', 'http://localhost/fixture'); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await checkLatestUpdaterCompatibility()).toMatchObject({ compatible: false, failure: { code: 'github_unreachable' } });
    expect(fetch).toHaveBeenCalledWith('https://github.com/jurczykpawel/sellf/releases/latest', expect.objectContaining({ redirect: 'manual' }));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('checks the latest official release without api.github.com', async () => {
    serve(manifest('1'));
    expect(await checkLatestUpdaterCompatibility()).toMatchObject({ compatible: true, min_updater_version: 1 });
    for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toContain('api.github.com');
  });
});
