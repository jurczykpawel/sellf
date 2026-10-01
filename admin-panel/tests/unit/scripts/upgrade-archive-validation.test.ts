import { describe, it, expect, beforeAll } from 'vitest';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/upgrade.sh');
const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, 'utf8');
const WORKFLOW_SOURCE = readFileSync(path.resolve(__dirname, '../../../../.github/workflows/build-release.yml'), 'utf8');

/**
 * upgrade.sh runs as a single monolithic `main()` (network calls, PM2,
 * systemd) so it can't be exercised end-to-end in a unit test. Instead we
 * extract the release-verification blocks verbatim (by sentinel comment)
 * and run them for real against crafted fixtures, so this test fails the
 * moment the extracted logic in upgrade.sh itself changes shape or drifts
 * from what's asserted here.
 */
const MARKER_SUFFIX = ' — extracted verbatim by tests/unit/scripts/upgrade-archive-validation.test.ts';

function extractBlock(name: string): string {
  const startMarker = `# ${name}:start${MARKER_SUFFIX}`;
  const endMarker = `# ${name}:end`;
  const start = SCRIPT_SOURCE.indexOf(startMarker);
  const end = SCRIPT_SOURCE.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not find block between "${startMarker}" and "${endMarker}" in upgrade.sh`);
  }
  return SCRIPT_SOURCE.slice(start + startMarker.length, end);
}

function extractKeyBlock(): string {
  const start = SCRIPT_SOURCE.indexOf('# release-signing-key:start');
  const end = SCRIPT_SOURCE.indexOf('# release-signing-key:end');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not find the release-signing-key block in upgrade.sh');
  }
  return SCRIPT_SOURCE.slice(start, end);
}

const PUBKEY_FILE_PATH = path.resolve(__dirname, '../../../scripts/release-signing-key.pub.pem');

const DEFAULT_INSTALLED_VERSION = '2026.9.2';
const DEFAULT_RELEASE_VERSION = '2026.10.0';

let workDir: string;
let harnessPath: string;
// Throwaway Ed25519 key pairs generated per test run — never a real release key.
let signingKey: string;
let signingPub: string;
let otherKey: string;

function generateKeyPair(dir: string, name: string): { key: string; pub: string } {
  const key = path.join(dir, `${name}.key.pem`);
  const pub = path.join(dir, `${name}.pub.pem`);
  execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', key]);
  execFileSync('openssl', ['pkey', '-in', key, '-pubout', '-out', pub]);
  return { key, pub };
}

function signFile(keyPath: string, filePath: string): string {
  const sigPath = `${filePath}.sig`;
  execFileSync('openssl', ['pkeyutl', '-sign', '-inkey', keyPath, '-rawin', '-in', filePath, '-out', sigPath]);
  return sigPath;
}

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'sellf-upgrade-harness-'));

  const primary = generateKeyPair(workDir, 'release');
  signingKey = primary.key;
  signingPub = primary.pub;
  otherKey = generateKeyPair(workDir, 'other').key;

  // The harness receives the trusted public key as a file argument; in
  // upgrade.sh it comes from the RELEASE_SIGNING_PUBKEY constant embedded in
  // the installed script.
  const harness = `#!/usr/bin/env bash
set -euo pipefail
ARCHIVE="$1"
MANIFEST_FILE="$2"
TMP_DIR="$3"
SIGNATURE_FILE="$4"
RELEASE_SIGNING_PUBKEY="$(cat "$5")"
INSTALL_DIR="$6"
TAG_NAME="$7"
write_error() { echo "WRITE_ERROR: $1"; exit 1; }
write_progress() { echo "PROGRESS: $1 $3"; }
log() { echo "LOG: $*"; }

${extractBlock('signature-verification')}
${extractBlock('manifest-parse')}
${extractBlock('version-check')}
${extractBlock('checksum-validation')}
${extractBlock('tar-validation')}

echo "ACCEPTED"
`;
  harnessPath = path.join(workDir, 'harness.sh');
  writeFileSync(harnessPath, harness);
  chmodSync(harnessPath, 0o755);
});

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function uniqueDir(prefix: string): string {
  return mkdtempSync(path.join(workDir, `${prefix}-`));
}

/** Builds a tar.gz whose single top-level directory is filled by `build`. */
function buildArchive(build: (fixtureDir: string) => void = (dir) => writeFileSync(path.join(dir, 'hello.txt'), 'hi')): string {
  const parent = uniqueDir('fixture');
  const fixtureDir = path.join(parent, 'content');
  execFileSync('mkdir', ['-p', fixtureDir]);
  build(fixtureDir);
  const archive = path.join(parent, 'sellf-build.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', parent, 'content']);
  return archive;
}

function writeManifest(dir: string, content: string): string {
  const manifest = path.join(dir, 'sellf-build.manifest');
  writeFileSync(manifest, content);
  return manifest;
}

function manifestFor(version: string, sha: string): string {
  return `version=${version}\nsha256=${sha}\n`;
}

/** An install dir holding version.txt (the way upgrade.sh and the deploy scripts leave it). */
function installDirWith(files: { versionTxt?: string; packageJsonVersion?: string }): string {
  const dir = uniqueDir('install');
  if (files.versionTxt !== undefined) writeFileSync(path.join(dir, 'version.txt'), files.versionTxt);
  if (files.packageJsonVersion !== undefined) {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'sellf-admin', version: files.packageJsonVersion }));
  }
  return dir;
}

interface ReleaseOptions {
  version?: string;
  installed?: string;
  archive?: string;
}

/** A signed release (archive + manifest + signature) and an install dir at `installed`. */
function buildRelease(options: ReleaseOptions = {}) {
  const archive = options.archive ?? buildArchive();
  const version = options.version ?? DEFAULT_RELEASE_VERSION;
  const manifest = writeManifest(path.dirname(archive), manifestFor(version, sha256File(archive)));
  const signature = signFile(signingKey, manifest);
  const installDir = installDirWith({ versionTxt: `${options.installed ?? DEFAULT_INSTALLED_VERSION}\n` });
  // GitHub tags carry a leading v; the manifest version does not.
  return { archive, manifest, signature, installDir, tag: `v${version}` };
}

interface HarnessOptions {
  /** Signature file to pass; `null` = no signature downloaded. */
  signatureFile?: string | null;
  /** Public key the harness trusts; defaults to the test key pair's public half. */
  pubKeyFile?: string;
  installDir?: string;
  tag?: string;
  env?: NodeJS.ProcessEnv;
}

function runHarness(release: ReturnType<typeof buildRelease>, options: HarnessOptions = {}) {
  // The extracted upgrade.sh blocks `rm -rf "$TMP_DIR"` on every exit path —
  // give each invocation its own disposable scratch dir so it never deletes
  // the harness script or other tests' fixtures.
  const scratchDir = mkdtempSync(path.join(tmpdir(), 'sellf-upgrade-scratch-'));
  const signatureFile =
    options.signatureFile === undefined
      ? release.signature
      : options.signatureFile === null
        ? path.join(scratchDir, 'absent.sig')
        : options.signatureFile;
  return execFileAsync(
    'bash',
    [
      harnessPath,
      release.archive,
      release.manifest,
      scratchDir,
      signatureFile,
      options.pubKeyFile ?? signingPub,
      options.installDir ?? release.installDir,
      options.tag ?? release.tag,
    ],
    { env: { ...process.env, ...options.env } },
  );
}

/** Expects the harness to stop via write_error with a message containing `message`. */
function expectRejection(promise: Promise<unknown>, message: string) {
  const escaped = message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return expect(promise).rejects.toMatchObject({ stdout: expect.stringMatching(new RegExp(`WRITE_ERROR: .*${escaped}`)) });
}

describe('upgrade.sh release verification (extracted verbatim from scripts/upgrade.sh)', () => {
  describe('script structure', () => {
    it('verifies the signature, then reads the manifest, then checks the version, before downloading the archive', () => {
      const signatureStart = SCRIPT_SOURCE.indexOf('# signature-verification:start');
      const manifestStart = SCRIPT_SOURCE.indexOf('# manifest-parse:start');
      const versionStart = SCRIPT_SOURCE.indexOf('# version-check:start');
      const archiveDownload = SCRIPT_SOURCE.indexOf('-o "$ARCHIVE" "$DOWNLOAD_URL"');
      const checksumStart = SCRIPT_SOURCE.indexOf('# checksum-validation:start');
      const tarStart = SCRIPT_SOURCE.indexOf('# tar-validation:start');
      const extractCall = SCRIPT_SOURCE.indexOf('tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"');

      expect(signatureStart).toBeGreaterThan(-1);
      expect(manifestStart).toBeGreaterThan(signatureStart);
      expect(versionStart).toBeGreaterThan(manifestStart);
      expect(archiveDownload).toBeGreaterThan(versionStart);
      expect(checksumStart).toBeGreaterThan(archiveDownload);
      expect(tarStart).toBeGreaterThan(checksumStart);
      expect(extractCall).toBeGreaterThan(tarStart);
    });

    it('fails closed when the release has no manifest or no signature asset', () => {
      expect(SCRIPT_SOURCE).toContain('No sellf-build.manifest asset found in latest release');
      expect(SCRIPT_SOURCE).toContain('No sellf-build.manifest.sig asset found in latest release');
    });

    it('validates the manifest and signature asset origins the same way as the tarball', () => {
      expect(SCRIPT_SOURCE).toContain('if ! [[ "$MANIFEST_URL" =~ ^https://github\\.com/ ]]; then');
      expect(SCRIPT_SOURCE).toContain('if ! [[ "$SIGNATURE_URL" =~ ^https://github\\.com/ ]]; then');
    });

    it('has no environment switch that relaxes signature verification', () => {
      expect(SCRIPT_SOURCE).not.toContain('SELLF_ALLOW_UNSIGNED_RELEASE');
      expect(WORKFLOW_SOURCE).not.toContain('SELLF_ALLOW_UNSIGNED_RELEASE');
    });

    it('takes the trusted public key from the installed script, before anything from the download is used', () => {
      const keyStart = SCRIPT_SOURCE.indexOf('# release-signing-key:start');
      const download = SCRIPT_SOURCE.indexOf('# ===== STEP 2: DOWNLOAD =====');
      expect(keyStart).toBeGreaterThan(-1);
      expect(keyStart).toBeLessThan(download);
      const keyBlock = extractKeyBlock();
      expect(keyBlock).toContain('-----BEGIN PUBLIC KEY-----');
      expect(keyBlock).toContain('-----END PUBLIC KEY-----');
    });

    it('ships scripts/release-signing-key.pub.pem identical to the key embedded in upgrade.sh', () => {
      expect(existsSync(PUBKEY_FILE_PATH)).toBe(true);
      const embedded = extractKeyBlock().match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/)?.[0];
      expect(embedded).toBeDefined();
      expect(readFileSync(PUBKEY_FILE_PATH, 'utf8').trim()).toBe(embedded);
    });

  });

  describe('signature over the manifest', () => {
    it('accepts a release whose manifest carries a valid signature from the trusted key', async () => {
      const { stdout } = await runHarness(buildRelease());
      expect(stdout).toContain('ACCEPTED');
    });

    it('rejects a manifest whose version line was changed after signing', async () => {
      const release = buildRelease({ version: '2026.10.0' });
      writeFileSync(release.manifest, manifestFor('2026.11.0', sha256File(release.archive)));
      await expectRejection(runHarness(release, { tag: 'v2026.11.0' }), 'Release signature is not valid');
    });

    it('rejects a manifest whose sha256 line was changed after signing', async () => {
      const release = buildRelease();
      writeFileSync(release.manifest, manifestFor(release.tag, '1'.repeat(64)));
      await expectRejection(runHarness(release), 'Release signature is not valid');
    });

    it('rejects a release with no signature', async () => {
      await expectRejection(runHarness(buildRelease(), { signatureFile: null }), 'Release signature missing');
    });

    it('rejects a release with no signature even when SELLF_ALLOW_UNSIGNED_RELEASE=1 is set', async () => {
      await expectRejection(
        runHarness(buildRelease(), { signatureFile: null, env: { SELLF_ALLOW_UNSIGNED_RELEASE: '1' } }),
        'Release signature missing',
      );
    });

    it('rejects a signature made by a different key', async () => {
      const release = buildRelease();
      const otherDir = uniqueDir('other-sig');
      const copy = writeManifest(otherDir, readFileSync(release.manifest, 'utf8'));
      const sig = signFile(otherKey, copy);
      await expectRejection(runHarness(release, { signatureFile: sig }), 'Release signature is not valid');
    });

    it('refuses a signed release while the embedded public key is still the placeholder', async () => {
      const placeholder = path.join(workDir, 'placeholder.pub.pem');
      writeFileSync(
        placeholder,
        '-----BEGIN PUBLIC KEY-----\nREPLACE_WITH_RELEASE_SIGNING_PUBLIC_KEY\n-----END PUBLIC KEY-----\n',
      );
      await expectRejection(runHarness(buildRelease(), { pubKeyFile: placeholder }), 'Release signing public key is not configured');
    });

    it('fails closed with a clear message when openssl cannot handle Ed25519', async () => {
      const release = buildRelease();
      // A stand-in openssl that, like LibreSSL builds without Ed25519, cannot load the key.
      const fakeBin = mkdtempSync(path.join(tmpdir(), 'sellf-fake-openssl-'));
      writeFileSync(path.join(fakeBin, 'openssl'), '#!/usr/bin/env bash\necho "unsupported algorithm" >&2\nexit 1\n');
      chmodSync(path.join(fakeBin, 'openssl'), 0o755);
      await expectRejection(
        runHarness(release, { env: { PATH: `${fakeBin}:${process.env.PATH}` } }),
        'openssl on this server cannot verify Ed25519 signatures',
      );
    });
  });

  describe('manifest format', () => {
    async function runWithSignedManifest(content: string) {
      const release = buildRelease();
      writeFileSync(release.manifest, content);
      signFile(signingKey, release.manifest);
      return runHarness(release);
    }

    it('rejects a signed manifest with an extra line', async () => {
      const release = buildRelease();
      await expectRejection(
        runWithSignedManifest(`${manifestFor(release.tag, sha256File(release.archive))}note=x\n`),
        'Malformed release manifest',
      );
    });

    it('rejects a signed manifest with the lines in a different order', async () => {
      await expectRejection(
        runWithSignedManifest(`sha256=${'a'.repeat(64)}\nversion=${DEFAULT_RELEASE_VERSION}\n`),
        'Malformed release manifest',
      );
    });

    it('rejects a signed manifest whose sha256 is not 64 lowercase hex characters', async () => {
      await expectRejection(runWithSignedManifest(manifestFor(DEFAULT_RELEASE_VERSION, 'not-a-hash')), 'Malformed release manifest');
    });

    it('rejects a signed manifest whose version is not YYYY.M.patch', async () => {
      await expectRejection(runWithSignedManifest(manifestFor('2026.10', 'a'.repeat(64))), 'Malformed release manifest');
    });

    it('rejects a signed manifest whose version carries a leading v', async () => {
      await expectRejection(runWithSignedManifest(manifestFor('v2026.10.0', 'a'.repeat(64))), 'Malformed release manifest');
    });

    it('rejects a signed manifest with a trailing blank line', async () => {
      await expectRejection(runWithSignedManifest(`${manifestFor(DEFAULT_RELEASE_VERSION, 'a'.repeat(64))}\n`), 'Malformed release manifest');
    });

    it('rejects a manifest whose version differs from the release tag', async () => {
      await expectRejection(runHarness(buildRelease({ version: '2026.10.0' }), { tag: 'v2026.10.1' }), 'does not match the release tag');
    });
  });

  describe('installed version comparison', () => {
    it('accepts a release newer than the installed version', async () => {
      const { stdout } = await runHarness(buildRelease({ version: '2026.9.3', installed: '2026.9.2' }));
      expect(stdout).toContain('ACCEPTED');
    });

    it('refuses a release older than the installed version', async () => {
      await expectRejection(
        runHarness(buildRelease({ version: '2026.9.1', installed: '2026.9.2' })),
        'Release 2026.9.1 is older than the installed version 2026.9.2',
      );
    });

    it('refuses an older release even when SELLF_ALLOW_UNSIGNED_RELEASE=1 is set', async () => {
      await expectRejection(
        runHarness(buildRelease({ version: '2026.9.1', installed: '2026.9.2' }), { env: { SELLF_ALLOW_UNSIGNED_RELEASE: '1' } }),
        'is older than the installed version',
      );
    });

    // The admin UI offers "Reinstall" when the instance is up to date, so a
    // release equal to the installed one goes through the normal install path
    // (signature, hash and archive checks included).
    it('reinstalls a release equal to the installed version through the normal install path', async () => {
      const { stdout } = await runHarness(buildRelease({ version: '2026.9.2', installed: '2026.9.2' }));
      expect(stdout).toContain('is already installed; reinstalling');
      expect(stdout).toContain('Checksum OK');
      expect(stdout).toContain('ACCEPTED');
    });

    it('still verifies the signature when reinstalling the installed version', async () => {
      const release = buildRelease({ version: '2026.9.2', installed: '2026.9.2' });
      writeFileSync(release.manifest, manifestFor('2026.9.2', '1'.repeat(64)));
      await expectRejection(runHarness(release), 'Release signature is not valid');
    });

    it('does not gate the in-app upgrade route on a newer version being available (admin UI "Reinstall")', () => {
      // SystemUpdateSettings shows "Reinstall" when up to date and POSTs to this
      // route; the version decision belongs to upgrade.sh alone.
      const routeSource = readFileSync(path.resolve(__dirname, '../../../src/app/api/v1/system/upgrade/route.ts'), 'utf8');
      expect(routeSource).toContain("'bash', ...scriptArgs");
      expect(routeSource).not.toMatch(/isNewerVersion|update_available/);
      const settingsSource = readFileSync(path.resolve(__dirname, '../../../src/components/settings/SystemUpdateSettings.tsx'), 'utf8');
      expect(settingsSource).toMatch(/!updateInfo\.update_available[\s\S]*?onClick=\{startUpgrade\}[\s\S]*?settings\.reinstall/);
    });

    it('compares YYYY.M.patch numerically across a month boundary (2026.10.0 is newer than 2026.9.10)', async () => {
      const { stdout } = await runHarness(buildRelease({ version: '2026.10.0', installed: '2026.9.10' }));
      expect(stdout).toContain('ACCEPTED');
      await expectRejection(
        runHarness(buildRelease({ version: '2026.9.10', installed: '2026.10.0' })),
        'is older than the installed version',
      );
    });

    it('compares the patch number numerically (2026.9.10 is newer than 2026.9.9)', async () => {
      const { stdout } = await runHarness(buildRelease({ version: '2026.9.10', installed: '2026.9.9' }));
      expect(stdout).toContain('ACCEPTED');
    });

    it('accepts an installed version recorded with a v prefix', async () => {
      const { stdout } = await runHarness(buildRelease({ version: '2026.10.0', installed: 'v2026.9.2' }));
      expect(stdout).toContain('ACCEPTED');
    });

    it('accepts a release tag without the v prefix', async () => {
      const { stdout } = await runHarness(buildRelease({ version: '2026.10.0' }), { tag: '2026.10.0' });
      expect(stdout).toContain('ACCEPTED');
    });

    it('accepts a version.txt with a trailing carriage return', async () => {
      const release = buildRelease({ version: '2026.9.1' });
      const installDir = installDirWith({ versionTxt: '2026.9.0\r\n' });
      const { stdout } = await runHarness(release, { installDir });
      expect(stdout).toContain('ACCEPTED');
    });

    it('falls back to package.json when version.txt is absent', async () => {
      const release = buildRelease({ version: '2026.9.1' });
      const installDir = installDirWith({ packageJsonVersion: '2026.9.2' });
      await expectRejection(runHarness(release, { installDir }), 'is older than the installed version 2026.9.2');
    });

    it('refuses to install when the installed version cannot be determined', async () => {
      const release = buildRelease();
      const installDir = installDirWith({ versionTxt: 'unknown\n' });
      await expectRejection(runHarness(release, { installDir }), 'Could not determine the installed version');
    });
  });

  describe('archive checksum and contents', () => {
    it('rejects an archive whose contents do not match the signed manifest', async () => {
      const release = buildRelease();
      const replacement = buildArchive((dir) => writeFileSync(path.join(dir, 'hello.txt'), 'different'));
      execFileSync('cp', [replacement, release.archive]);
      await expectRejection(runHarness(release), 'Security: checksum mismatch');
    });

    it('rejects an archive containing a symlink even with a correct checksum', async () => {
      const archive = buildArchive((dir) => {
        writeFileSync(path.join(dir, 'hello.txt'), 'hi');
        execFileSync('ln', ['-s', '/etc/passwd', path.join(dir, 'evil-link')]);
      });
      await expectRejection(runHarness(buildRelease({ archive })), "Security: archive contains a non-regular entry (type 'l')");
    });

    it('rejects an archive entry whose path would extract outside the target directory, even with a correct checksum', async () => {
      const parent = uniqueDir('fixture');
      execFileSync('mkdir', ['-p', path.join(parent, 'content')]);
      writeFileSync(path.join(parent, 'content', 'evil.txt'), 'hi');
      const archive = path.join(parent, 'sellf-build.tar.gz');
      // Rewrite the stored entry name to escape the extraction root without
      // needing a real file outside the fixture directory.
      execFileSync('tar', ['-s', ',evil.txt,../evil.txt,', '-czf', archive, '-C', parent, path.join('content', 'evil.txt')]);
      await expectRejection(runHarness(buildRelease({ archive })), 'Security: archive contains an unsafe path');
    });

    it('rejects an archive entry whose path ends in a bare parent-dir segment (no trailing slash after it), even with a correct checksum', async () => {
      const parent = uniqueDir('fixture');
      execFileSync('mkdir', ['-p', path.join(parent, 'content')]);
      writeFileSync(path.join(parent, 'content', 'evil.txt'), 'hi');
      const archive = path.join(parent, 'sellf-build.tar.gz');
      // Rewrite the stored entry name to end in "/.." — e.g. "public/.." —
      // which the earlier `*/../*` pattern misses because nothing follows
      // the "..".
      execFileSync('tar', ['-s', ',evil.txt,public/..,', '-czf', archive, '-C', parent, path.join('content', 'evil.txt')]);
      await expectRejection(runHarness(buildRelease({ archive })), 'Security: archive contains an unsafe path');
    });

    it('refuses an archive that cannot be listed (corrupt or not actually gzip), even with a correct checksum', async () => {
      const parent = uniqueDir('fixture');
      const archive = path.join(parent, 'sellf-build.tar.gz');
      writeFileSync(archive, 'not a valid gzip/tar archive at all');
      await expectRejection(runHarness(buildRelease({ archive })), 'Security: unable to read archive contents');
    });

    it('refuses an archive with zero listable entries, even with a correct checksum', async () => {
      const parent = uniqueDir('fixture');
      const archive = path.join(parent, 'sellf-build.tar.gz');
      execFileSync('tar', ['-czf', archive, '-T', '/dev/null']);
      await expectRejection(runHarness(buildRelease({ archive })), 'Security: archive contains no entries');
    });
  });
});
