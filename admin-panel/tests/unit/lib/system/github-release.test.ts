/** Release lookups through github.com pages and release files, never api.github.com. @see src/lib/system/github-release.ts */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLatestReleaseTag, fetchReleaseAsset, ReleaseFetchError } from '@/lib/system/github-release';

const LATEST = 'https://github.com/jurczykpawel/sellf/releases/latest';
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ReleaseFetchError);
    return (error as ReleaseFetchError).failure;
  }
  throw new Error('Expected a release fetch failure');
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('fetchLatestReleaseTag', () => {
  it('reads the tag from the github.com redirect without following it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirect('https://github.com/jurczykpawel/sellf/releases/tag/v2026.11.2')));
    expect(await fetchLatestReleaseTag()).toBe('v2026.11.2');
    expect(fetch).toHaveBeenCalledWith(LATEST, expect.objectContaining({ redirect: 'manual', cache: 'no-store' }));
  });

  it.each([
    ['another repository', 'https://github.com/someone/else/releases/tag/v2026.11.2'],
    ['a malformed tag', 'https://github.com/jurczykpawel/sellf/releases/tag/v2026.11.2/../../x'],
    ['a prerelease suffix', 'https://github.com/jurczykpawel/sellf/releases/tag/v2026.11.2-rc1'],
  ])('rejects a redirect to %s', async (_, location) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirect(location)));
    expect(await failure(fetchLatestReleaseTag())).toEqual({ code: 'release_lookup_invalid', details: {} });
  });

  it('reports GitHub status, message and reset time', async () => {
    const reset = Math.floor(Date.UTC(2026, 10, 12, 14, 27) / 1000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'API rate limit exceeded for 203.0.113.7.', documentation_url: 'https://docs.github.com' }),
      { status: 429, headers: { 'content-type': 'application/json', 'x-ratelimit-reset': String(reset) } },
    )));
    expect(await failure(fetchLatestReleaseTag())).toEqual({
      code: 'github_http',
      details: { http_status: 429, github_message: 'API rate limit exceeded for 203.0.113.7.', retry_at: '2026-11-12T14:27:00.000Z' },
    });
  });

  it('turns retry-after seconds into a retry time and ignores non-JSON bodies', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 12, 14, 0), toFake: ['Date'] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>busy</html>', { status: 503, headers: { 'retry-after': '120' } })));
    expect(await failure(fetchLatestReleaseTag())).toEqual({
      code: 'github_http', details: { http_status: 503, retry_at: '2026-11-12T14:02:00.000Z' },
    });
  });

  it('reports a network failure separately', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await failure(fetchLatestReleaseTag())).toEqual({ code: 'github_unreachable', details: {} });
  });

  it('reports a repository without a published release', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('releases page', { status: 200 })));
    expect(await failure(fetchLatestReleaseTag())).toEqual({ code: 'release_lookup_invalid', details: {} });
  });
});

describe('fetchReleaseAsset', () => {
  it('downloads a bounded release file by tag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('version=2026.11.2\n')));
    expect((await fetchReleaseAsset('v2026.11.2', 'sellf-build.v2.manifest')).toString()).toBe('version=2026.11.2\n');
    expect(fetch).toHaveBeenCalledWith(
      'https://github.com/jurczykpawel/sellf/releases/download/v2026.11.2/sellf-build.v2.manifest',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('names the missing file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    expect(await failure(fetchReleaseAsset('v2026.11.2', 'sellf-build.v2.manifest.sig'))).toEqual({
      code: 'release_asset_missing', details: { http_status: 404, asset: 'sellf-build.v2.manifest.sig' },
    });
  });

  it('refuses oversized files', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(5000))));
    expect(await failure(fetchReleaseAsset('v2026.11.2', 'sellf-build.v2.manifest'))).toEqual({
      code: 'release_lookup_invalid', details: { asset: 'sellf-build.v2.manifest' },
    });
  });

  it('never uses api.github.com', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
    await fetchReleaseAsset('v2026.11.2', 'sellf-build.manifest');
    vi.mocked(fetch).mockResolvedValue(redirect('https://github.com/jurczykpawel/sellf/releases/tag/v2026.11.2'));
    await fetchLatestReleaseTag();
    for (const [url] of vi.mocked(fetch).mock.calls) expect(String(url)).not.toContain('api.github.com');
  });
});
