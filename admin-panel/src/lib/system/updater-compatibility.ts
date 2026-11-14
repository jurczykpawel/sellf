/** Signed updater requirements, checked before the privileged launcher runs.
 * The installed script is the trust anchor, including during signing-key rotation.
 * @see scripts/upgrade.sh @see scripts/ci/write-release-manifests.sh
 */
import { verify } from 'crypto';
import { readFileSync } from 'fs';
import {
  fetchLatestReleaseTag, fetchReleaseAsset, isReleaseTag, ReleaseFetchError, toUpdateFailure,
} from '@/lib/system/github-release';
import { findUpgradeScript } from '@/lib/system/upgrade-runtime-server';
import type { UpgradeCapability, UpdaterCompatibility } from '@/lib/system/upgrade-runtime';
import type { UpdateFailure } from '@/lib/system/update-failure';

const RECOVERY = 'Update Sellf through Stackpilot: ./local/deploy.sh sellf --ssh=<server> --update';

export function readInstalledUpdater(): { version: number; publicKey: string } {
  const script = findUpgradeScript();
  if (!script) throw new Error('Installed updater not found');
  const source = readFileSync(script, 'utf8');
  const match = source.match(/^UPDATER_VERSION=([1-9][0-9]{0,8})$/m);
  if (!match && /^UPDATER_VERSION=/m.test(source)) throw new Error('Invalid updater version');
  const keyBlock = source.match(/^# release-signing-key:start\n([\s\S]*?)^# release-signing-key:end/m)?.[1];
  const publicKey = keyBlock?.match(/-----BEGIN PUBLIC KEY-----\n[\s\S]*?-----END PUBLIC KEY-----/)?.[0];
  if (!publicKey) throw new Error('Installed release key not found');
  return { version: match ? Number(match[1]) : 1, publicKey };
}

function verificationFailed(version: number, failure: UpdateFailure): UpdaterCompatibility {
  return {
    version, compatible: false, reason: 'verification_failed', failure,
    message: `Could not verify the signed updater requirement. Retry the check or use Stackpilot. ${RECOVERY}`,
  };
}

const absent = (error: unknown): boolean => error instanceof ReleaseFetchError && error.failure.code === 'release_asset_missing';

/** Signed manifest pair: v2 when either v2 file exists, legacy only when both are absent. */
async function fetchSignedManifest(tag: string): Promise<{ v2: boolean; manifest: Buffer; signature: Buffer }> {
  const [manifest, signature] = await Promise.allSettled([
    fetchReleaseAsset(tag, 'sellf-build.v2.manifest'), fetchReleaseAsset(tag, 'sellf-build.v2.manifest.sig'),
  ]);
  if (manifest.status === 'fulfilled' && signature.status === 'fulfilled') {
    return { v2: true, manifest: manifest.value, signature: signature.value };
  }
  const rejected = [manifest, signature].filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected.length === 2 && rejected.every(result => absent(result.reason))) {
    const [legacyManifest, legacySignature] = await Promise.all([
      fetchReleaseAsset(tag, 'sellf-build.manifest'), fetchReleaseAsset(tag, 'sellf-build.manifest.sig'),
    ]);
    return { v2: false, manifest: legacyManifest, signature: legacySignature };
  }
  throw rejected.find(result => !absent(result.reason))?.reason ?? rejected[0].reason;
}

export async function getUpdaterCompatibility(tag: string): Promise<UpdaterCompatibility> {
  let version = 1;
  try {
    const installed = readInstalledUpdater();
    version = installed.version;
    if (!isReleaseTag(tag)) throw new ReleaseFetchError({ code: 'release_lookup_invalid', details: {} });
    const { v2, manifest, signature } = await fetchSignedManifest(tag);
    if (!verify(null, manifest, installed.publicKey, signature)) {
      throw new ReleaseFetchError({ code: 'signature_invalid', details: {} });
    }
    const pattern = v2
      ? /^version=([0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9})\nsha256=[a-f0-9]{64}\nmin_updater_version=([1-9][0-9]{0,8})\n$/
      : /^version=([0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9})\nsha256=[a-f0-9]{64}\n$/;
    const match = pattern.exec(manifest.toString('utf8'));
    if (!match || match[0].length !== manifest.length || match[1] !== tag.replace(/^v/, '')) {
      throw new ReleaseFetchError({ code: 'manifest_invalid', details: {} });
    }
    const minimum = v2 ? Number(match[2]) : 1;
    return {
      version, min_updater_version: minimum, compatible: version >= minimum,
      ...(version < minimum ? { reason: 'too_old' as const, message: `This release requires updater ${minimum} (installed: ${version}). ${RECOVERY}` } : {}),
    };
  } catch (error) {
    return verificationFailed(version, toUpdateFailure(error, 'updater_unreadable'));
  }
}

/** Fresh official metadata only; notification URL overrides cannot authorize an upgrade. */
export async function checkLatestUpdaterCompatibility(): Promise<UpdaterCompatibility> {
  let tag: string;
  try {
    tag = await fetchLatestReleaseTag();
  } catch (error) {
    let version = 1;
    try { version = readInstalledUpdater().version; } catch { /* reported as version 1 */ }
    return verificationFailed(version, toUpdateFailure(error));
  }
  return getUpdaterCompatibility(tag);
}

/** Recompare cached signed requirements against the script currently on disk. */
export function refreshUpdaterCompatibility(updater?: UpdaterCompatibility): UpdaterCompatibility | undefined {
  if (!updater) return undefined;
  try {
    const { version } = readInstalledUpdater();
    const minimum = updater.min_updater_version;
    if (minimum === undefined) return { ...updater, version };
    return { version, min_updater_version: minimum, compatible: version >= minimum,
      ...(version < minimum ? { reason: 'too_old' as const, message: `This release requires updater ${minimum} (installed: ${version}). ${RECOVERY}` } : {}),
    };
  } catch {
    return { ...updater, compatible: false, reason: 'verification_failed', message: `Could not read the installed updater. ${RECOVERY}` };
  }
}

export function withUpdaterCompatibility(upgrade: UpgradeCapability, updater?: UpdaterCompatibility): UpgradeCapability {
  return upgrade.mode === 'in-place' && updater && !updater.compatible ? { ...upgrade, mode: 'manual' } : upgrade;
}
