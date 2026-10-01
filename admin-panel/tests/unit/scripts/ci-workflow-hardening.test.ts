import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const WORKFLOWS_DIR = path.resolve(__dirname, '../../../../.github/workflows');
const buildRelease = readFileSync(path.join(WORKFLOWS_DIR, 'build-release.yml'), 'utf8');
const syncKsef = readFileSync(path.join(WORKFLOWS_DIR, 'sync-ksef-example.yml'), 'utf8');
const lintMigrations = readFileSync(path.join(WORKFLOWS_DIR, 'lint-migrations.yml'), 'utf8');

// Every third-party action reference in these workflows must be pinned to a
// full commit SHA ("owner/repo@<40-hex-chars>"), not a mutable tag — a tag
// can be moved to point at different, unreviewed code after the workflow is
// merged. actions/* and docker/* (first-party GitHub/Docker orgs) are lower
// risk but pinned here too for consistency; trufflesecurity is pinned
// pre-existing and covered by the same regex.
function unpinnedThirdPartyActions(source: string): string[] {
  const matches = [...source.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@([^\s#]+)/g)];
  return matches
    .filter(([, , ref]) => !/^[0-9a-f]{40}$/.test(ref))
    .map(([, action, ref]) => `${action}@${ref}`);
}

describe('build-release.yml hardening', () => {
  it('pins every third-party action to a full commit SHA', () => {
    expect(unpinnedThirdPartyActions(buildRelease)).toEqual([]);
  });

  it('publishes the plain sha256 checksum next to the release tarball', () => {
    expect(buildRelease).toContain('sha256sum sellf-build.tar.gz > sellf-build.tar.gz.sha256');
  });

  it('publishes a signed manifest (version without v + tarball sha256) next to the release tarball', () => {
    expect(buildRelease).toContain(
      "printf 'version=%s\\nsha256=%s\\n' \"$MANIFEST_VERSION\" \"$(sha256sum sellf-build.tar.gz | awk '{print $1}')\" > sellf-build.manifest",
    );
    expect(buildRelease).toContain('MANIFEST_VERSION="${RELEASE_VERSION#v}"');
    expect(buildRelease).toContain('-in sellf-build.manifest -out sellf-build.manifest.sig');
    expect(buildRelease).toContain(
      'gh release upload "${{ steps.version.outputs.VERSION }}" sellf-build.tar.gz sellf-build.tar.gz.sha256 sellf-build.manifest sellf-build.manifest.sig',
    );
    expect(buildRelease).toMatch(
      /files:\s*\|\s*\n\s*sellf-build\.tar\.gz\s*\n\s*sellf-build\.tar\.gz\.sha256\s*\n\s*sellf-build\.manifest\s*\n\s*sellf-build\.manifest\.sig/,
    );
    expect(buildRelease).not.toContain('sellf-build.tar.gz.sha256.sig');
  });

  it('only signs strict YYYY.M.patch tags that match admin-panel/package.json', () => {
    expect(buildRelease).toContain('if ! [[ "$RELEASE_VERSION" =~ ^v?[0-9]+\\.[0-9]+\\.[0-9]+$ ]]; then');
    expect(buildRelease).toContain('PACKAGE_VERSION="$(node -p "require(\'./admin-panel/package.json\').version")"');
    expect(buildRelease).toContain('if [ "$MANIFEST_VERSION" != "$PACKAGE_VERSION" ]; then');
  });

  it('runs a blocking bun audit against the real admin-panel bun.lock, not npm audit on a generated lockfile', () => {
    expect(buildRelease).not.toContain('package-lock-only');
    expect(buildRelease).not.toContain('npm audit');
    expect(buildRelease).toMatch(/Dependency audit \(admin-panel\)[\s\S]*?run: bun audit --audit-level=high/);
  });

  it('does not silently swallow the admin-panel dependency audit result', () => {
    const adminAuditBlock = buildRelease.slice(
      buildRelease.indexOf('Dependency audit (admin-panel)'),
      buildRelease.indexOf('Dependency audit (mcp-server)')
    );
    expect(adminAuditBlock).not.toMatch(/^\s*continue-on-error:/m);
  });
});

describe('build-release.yml docker job hardening', () => {
  // Job bodies, sliced by their top-level YAML keys (2-space indent). `docker`
  // is followed immediately by the new `sign-image` job in the same file.
  const dockerJobStart = buildRelease.indexOf('\n  docker:\n');
  const signImageJobStart = buildRelease.indexOf('\n  sign-image:\n');
  const dockerJob = buildRelease.slice(dockerJobStart, signImageJobStart === -1 ? undefined : signImageJobStart);
  const signImageJob = signImageJobStart === -1 ? '' : buildRelease.slice(signImageJobStart);

  it('exposes the pushed image digest and version as job outputs', () => {
    expect(dockerJob).toContain('id: build');
    expect(dockerJob).toMatch(/outputs:\s*\n\s*digest:\s*\$\{\{\s*steps\.build\.outputs\.digest\s*\}\}/);
    expect(dockerJob).toMatch(/outputs:\s*\n[\s\S]*?version:\s*\$\{\{\s*steps\.version\.outputs\.VERSION\s*\}\}/);
  });

  it('validates the release version before logging in to GHCR or pushing', () => {
    const validateIdx = dockerJob.indexOf('if ! [[ "$RELEASE_VERSION" =~ ^v?[0-9]+\\.[0-9]+\\.[0-9]+$ ]]; then');
    const loginIdx = dockerJob.indexOf('Login to GHCR');
    const pushIdx = dockerJob.indexOf('Build and push');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(loginIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(loginIdx);
    expect(validateIdx).toBeLessThan(pushIdx);
    expect(dockerJob).toContain('PACKAGE_VERSION="$(node -p "require(\'./admin-panel/package.json\').version")"');
  });

  it('only pushes the latest tag on a real release event, never on a manual re-run', () => {
    expect(dockerJob).toContain("type=raw,value=latest,enable=${{ github.event_name == 'release' }}");
  });

  it('pins every third-party action to a full commit SHA', () => {
    expect(unpinnedThirdPartyActions(dockerJob)).toEqual([]);
  });
});

describe('build-release.yml sign-image job', () => {
  const signImageJobStart = buildRelease.indexOf('\n  sign-image:\n');
  const signImageJob = signImageJobStart === -1 ? '' : buildRelease.slice(signImageJobStart);

  it('exists and depends on both the build and docker jobs', () => {
    expect(signImageJob).not.toBe('');
    expect(signImageJob).toMatch(/needs:\s*\[\s*build\s*,\s*docker\s*\]/);
  });

  it('refuses to run without the release signing key', () => {
    expect(signImageJob).toContain('RELEASE_SIGNING_KEY');
    expect(signImageJob).toMatch(/if \[ -z "\$\{RELEASE_SIGNING_KEY:-\}" \]; then/);
  });

  it('validates the image digest shape before writing the manifest', () => {
    expect(signImageJob).toMatch(/\^sha256:\[0-9a-f\]\{64\}\$/);
  });

  it('writes a two-line image manifest with version and image digest reference', () => {
    expect(signImageJob).toContain("printf 'version=%s\\nimage=ghcr.io/%s/sellf@%s\\n'");
  });

  it('signs the image manifest and verifies it against the embedded release key before upload', () => {
    expect(signImageJob).toContain('sign-manifest.sh sign sellf-image.manifest sellf-image.manifest.sig');
    expect(signImageJob).toContain('sign-manifest.sh verify sellf-image.manifest sellf-image.manifest.sig');
  });

  it('uploads both the image manifest and its signature to the release', () => {
    expect(signImageJob).toMatch(/gh release upload[\s\S]*sellf-image\.manifest[\s\S]*sellf-image\.manifest\.sig/);
  });

  it('pins every third-party action to a full commit SHA', () => {
    expect(unpinnedThirdPartyActions(signImageJob)).toEqual([]);
  });
});

describe('lint-migrations.yml hardening', () => {
  it('pins bun to an explicit version instead of "latest"', () => {
    expect(lintMigrations).not.toContain('bun-version: latest');
    expect(lintMigrations).toContain('bun-version: 1.3.14');
  });

  it('pins its actions to full commit SHAs', () => {
    expect(unpinnedThirdPartyActions(lintMigrations)).toEqual([]);
  });
});

describe('sync-ksef-example.yml hardening', () => {
  it('opens a pull request instead of pushing straight to main', () => {
    expect(syncKsef).not.toMatch(/\bgit push\b/);
    expect(syncKsef).not.toContain('git commit');
    expect(syncKsef).toContain('create-pull-request');
  });

  it('requests pull-requests:write instead of only contents:write', () => {
    expect(syncKsef).toMatch(/permissions:\s*\n\s*contents:\s*write\s*\n\s*pull-requests:\s*write/);
  });

  it('pins its actions to full commit SHAs', () => {
    expect(unpinnedThirdPartyActions(syncKsef)).toEqual([]);
  });
});
