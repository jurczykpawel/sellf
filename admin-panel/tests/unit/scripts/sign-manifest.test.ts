import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * admin-panel/scripts/ci/sign-manifest.sh is the shared Ed25519 sign+verify
 * primitive released manifests use: sign with $RELEASE_SIGNING_KEY, verify
 * against the public key embedded in a given upgrade.sh (the trust anchor
 * already-installed servers hold). Exercised here against throwaway keys —
 * never a real release key.
 */
const SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/ci/sign-manifest.sh');

const KEY_MARKER_START = '# release-signing-key:start';
const KEY_MARKER_END = '# release-signing-key:end';

let workDir: string;
let signingKeyPath: string;
let otherKeyPath: string;

function generateKeyPair(dir: string, name: string): { key: string; pub: string } {
  const key = path.join(dir, `${name}.key.pem`);
  const pub = path.join(dir, `${name}.pub.pem`);
  execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', key]);
  execFileSync('openssl', ['pkey', '-in', key, '-pubout', '-out', pub]);
  return { key, pub };
}

/** A fake upgrade.sh carrying the given public key (or a placeholder) between the trust markers. */
function fakeUpgradeSh(dir: string, name: string, pubKeyPath: string | 'placeholder'): string {
  const pubBlock =
    pubKeyPath === 'placeholder'
      ? 'REPLACE_WITH_RELEASE_SIGNING_PUBLIC_KEY'
      : readFileSync(pubKeyPath, 'utf8').trim();
  const file = path.join(dir, `${name}.sh`);
  writeFileSync(
    file,
    `#!/usr/bin/env bash\n${KEY_MARKER_START}\n${pubBlock}\n${KEY_MARKER_END}\necho "not the real upgrade.sh"\n`,
  );
  return file;
}

function sign(manifestPath: string, sigPath: string, key: string): { status: number | null; stderr: string } {
  const result = execFileSync('bash', [SCRIPT_PATH, 'sign', manifestPath, sigPath], {
    env: { ...process.env, RELEASE_SIGNING_KEY: key },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: 0, stderr: result.toString() };
}

function verify(manifestPath: string, sigPath: string, upgradeShPath: string): number {
  try {
    execFileSync('bash', [SCRIPT_PATH, 'verify', manifestPath, sigPath, upgradeShPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return 0;
  } catch (error) {
    const err = error as { status?: number | null };
    return err.status ?? 1;
  }
}

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'sellf-sign-manifest-'));
  const primary = generateKeyPair(workDir, 'release');
  const other = generateKeyPair(workDir, 'other');
  signingKeyPath = primary.key;
  otherKeyPath = other.key;
  (globalThis as unknown as { __pubkeys: Record<string, string> }).__pubkeys = {
    release: primary.pub,
    other: other.pub,
  };
});

describe('sign-manifest.sh', () => {
  it('signs a manifest and verifies against the matching embedded key', () => {
    const dir = mkdtempSync(path.join(workDir, 'case-'));
    const manifest = path.join(dir, 'sellf-image.manifest');
    writeFileSync(manifest, 'version=2026.10.0\nimage=ghcr.io/example/sellf@sha256:' + 'a'.repeat(64) + '\n');
    const sig = `${manifest}.sig`;
    const key = readFileSync(signingKeyPath, 'utf8');

    sign(manifest, sig, key);

    const pubs = (globalThis as unknown as { __pubkeys: Record<string, string> }).__pubkeys;
    const upgradeSh = fakeUpgradeSh(dir, 'upgrade', pubs.release);

    expect(verify(manifest, sig, upgradeSh)).toBe(0);
  });

  it('rejects a manifest tampered with after signing', () => {
    const dir = mkdtempSync(path.join(workDir, 'case-'));
    const manifest = path.join(dir, 'sellf-image.manifest');
    writeFileSync(manifest, 'version=2026.10.0\nimage=ghcr.io/example/sellf@sha256:' + 'b'.repeat(64) + '\n');
    const sig = `${manifest}.sig`;
    const key = readFileSync(signingKeyPath, 'utf8');

    sign(manifest, sig, key);
    // Tamper after signing.
    writeFileSync(manifest, 'version=2099.1.0\nimage=ghcr.io/example/sellf@sha256:' + 'c'.repeat(64) + '\n');

    const pubs = (globalThis as unknown as { __pubkeys: Record<string, string> }).__pubkeys;
    const upgradeSh = fakeUpgradeSh(dir, 'upgrade', pubs.release);

    expect(verify(manifest, sig, upgradeSh)).not.toBe(0);
  });

  it('rejects a signature verified against the wrong embedded key', () => {
    const dir = mkdtempSync(path.join(workDir, 'case-'));
    const manifest = path.join(dir, 'sellf-image.manifest');
    writeFileSync(manifest, 'version=2026.10.0\nimage=ghcr.io/example/sellf@sha256:' + 'd'.repeat(64) + '\n');
    const sig = `${manifest}.sig`;
    const key = readFileSync(signingKeyPath, 'utf8');

    sign(manifest, sig, key);

    const pubs = (globalThis as unknown as { __pubkeys: Record<string, string> }).__pubkeys;
    const wrongUpgradeSh = fakeUpgradeSh(dir, 'upgrade-wrong', pubs.other);

    expect(verify(manifest, sig, wrongUpgradeSh)).not.toBe(0);
  });

  it('refuses to verify against a placeholder embedded key', () => {
    const dir = mkdtempSync(path.join(workDir, 'case-'));
    const manifest = path.join(dir, 'sellf-image.manifest');
    writeFileSync(manifest, 'version=2026.10.0\nimage=ghcr.io/example/sellf@sha256:' + 'e'.repeat(64) + '\n');
    const sig = `${manifest}.sig`;
    const key = readFileSync(signingKeyPath, 'utf8');

    sign(manifest, sig, key);

    const placeholderUpgradeSh = fakeUpgradeSh(dir, 'upgrade-placeholder', 'placeholder');

    expect(verify(manifest, sig, placeholderUpgradeSh)).not.toBe(0);
  });

  it('refuses to sign when RELEASE_SIGNING_KEY is missing', () => {
    const dir = mkdtempSync(path.join(workDir, 'case-'));
    const manifest = path.join(dir, 'sellf-image.manifest');
    writeFileSync(manifest, 'version=2026.10.0\nimage=ghcr.io/example/sellf@sha256:' + 'f'.repeat(64) + '\n');
    const sig = `${manifest}.sig`;

    expect(() =>
      execFileSync('bash', [SCRIPT_PATH, 'sign', manifest, sig], {
        env: { ...process.env, RELEASE_SIGNING_KEY: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ).toThrow();
  });

  it('rejects an unrecognized subcommand', () => {
    const dir = mkdtempSync(path.join(workDir, 'case-'));
    const manifest = path.join(dir, 'sellf-image.manifest');
    writeFileSync(manifest, 'x');

    expect(() =>
      execFileSync('bash', [SCRIPT_PATH, 'bogus', manifest], { stdio: ['ignore', 'pipe', 'pipe'] }),
    ).toThrow();
  });
});
