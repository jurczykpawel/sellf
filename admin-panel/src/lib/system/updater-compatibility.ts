/** Signed updater requirements, checked before the privileged launcher runs.
 * The installed script is the trust anchor, including during signing-key rotation.
 * @see scripts/upgrade.sh @see scripts/ci/write-release-manifests.sh
 */
import { verify } from 'crypto';
import { readFileSync } from 'fs';
import { findUpgradeScript } from '@/lib/system/upgrade-runtime-server';
import type { UpgradeCapability, UpdaterCompatibility } from '@/lib/system/upgrade-runtime';

const REPO = 'jurczykpawel/sellf';
const RECOVERY = 'Update Sellf through Stackpilot: ./local/deploy.sh sellf --ssh=<server> --update';

interface ReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}
interface ReleaseMetadata {
  tag_name?: unknown;
  assets?: ReleaseAsset[];
}

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

async function fetchAsset(url: string): Promise<Buffer> {
  const response = await fetch(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Release asset unavailable');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Release asset has no body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) throw new Error('Release asset too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

export async function getUpdaterCompatibility(release: ReleaseMetadata): Promise<UpdaterCompatibility> {
  let version = 1;
  try {
    const installed = readInstalledUpdater();
    version = installed.version;
    if (typeof release.tag_name !== 'string' || !/^v?[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$/.test(release.tag_name)) {
      throw new Error('Invalid release tag');
    }
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const v2 = assets.some(asset => asset.name === 'sellf-build.v2.manifest' || asset.name === 'sellf-build.v2.manifest.sig');
    const name = v2 ? 'sellf-build.v2.manifest' : 'sellf-build.manifest';
    const prefix = `https://github.com/${REPO}/releases/download/${release.tag_name}/`;
    const assetUrl = (assetName: string): string => {
      const matches = assets.filter(asset => asset.name === assetName);
      if (matches.length !== 1 || matches[0].browser_download_url !== prefix + assetName) throw new Error('Invalid manifest asset');
      return prefix + assetName;
    };
    const manifestUrl = assetUrl(name);
    const signatureUrl = assetUrl(name + '.sig');
    const [manifest, signature] = await Promise.all([
      fetchAsset(manifestUrl), fetchAsset(signatureUrl),
    ]);
    if (!verify(null, manifest, installed.publicKey, signature)) throw new Error('Invalid release signature');
    const pattern = v2
      ? /^version=([0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9})\nsha256=[a-f0-9]{64}\nmin_updater_version=([1-9][0-9]{0,8})\n$/
      : /^version=([0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9})\nsha256=[a-f0-9]{64}\n$/;
    const match = pattern.exec(manifest.toString('utf8'));
    if (!match || match[0].length !== manifest.length || match[1] !== release.tag_name.replace(/^v/, '')) throw new Error('Malformed release manifest');
    const minimum = v2 ? Number(match[2]) : 1;
    return {
      version, min_updater_version: minimum, compatible: version >= minimum,
      ...(version < minimum ? { reason: 'too_old' as const, message: `This release requires updater ${minimum} (installed: ${version}). ${RECOVERY}` } : {}),
    };
  } catch {
    return { version, compatible: false, reason: 'verification_failed', message: `Could not verify the signed updater requirement. Retry the check or use Stackpilot. ${RECOVERY}` };
  }
}

/** Fresh official metadata only; notification URL overrides cannot authorize an upgrade. */
export async function checkLatestUpdaterCompatibility(): Promise<UpdaterCompatibility> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github.v3+json' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Release metadata unavailable');
    return await getUpdaterCompatibility(await response.json());
  } catch {
    return { version: 1, compatible: false, reason: 'verification_failed', message: `Could not verify the signed updater requirement. ${RECOVERY}` };
  }
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
