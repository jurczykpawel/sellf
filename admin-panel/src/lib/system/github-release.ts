/**
 * Official Sellf release lookups through github.com pages and release files.
 * api.github.com allows 60 requests per hour per address, and servers behind a
 * shared NAT exhaust it; the release redirect and release files are not counted.
 * Failures carry the same codes and details as scripts/upgrade.sh progress files.
 *
 * @see scripts/upgrade.sh (github-release block)
 * @see src/lib/system/update-failure.ts
 */

import type { UpdateFailure } from '@/lib/system/update-failure';

export const SELLF_GITHUB_REPO = 'jurczykpawel/sellf';
const GITHUB_BASE = `https://github.com/${SELLF_GITHUB_REPO}`;
const RELEASE_TAG = /^v?[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$/;
const TIMEOUT_MS = 5000;
const ERROR_BODY_LIMIT = 4096;

export class ReleaseFetchError extends Error {
  constructor(public readonly failure: UpdateFailure) {
    super(failure.code);
    this.name = 'ReleaseFetchError';
  }
}

export function isReleaseTag(tag: string): boolean {
  return RELEASE_TAG.test(tag);
}

export function releaseTagUrl(tag: string): string {
  return `${GITHUB_BASE}/releases/tag/${tag}`;
}

async function readBounded(response: Response, limit: number): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

function retryAt(response: Response): string | undefined {
  const retryAfter = response.headers.get('retry-after')?.trim();
  if (retryAfter && /^[0-9]{1,6}$/.test(retryAfter)) {
    return new Date(Date.now() + Number(retryAfter) * 1000).toISOString();
  }
  const reset = response.headers.get('x-ratelimit-reset')?.trim();
  if (reset && /^[0-9]{9,11}$/.test(reset)) return new Date(Number(reset) * 1000).toISOString();
  return undefined;
}

async function githubMessage(response: Response): Promise<string | undefined> {
  if (!response.headers.get('content-type')?.includes('json')) return undefined;
  try {
    const body = await readBounded(response, ERROR_BODY_LIMIT);
    const message = body ? (JSON.parse(body.toString('utf8')) as { message?: unknown }).message : undefined;
    if (typeof message !== 'string') return undefined;
    const printable = [...message].filter(character => character >= ' ' && character !== '\u007f').join('');
    return printable.slice(0, 200) || undefined;
  } catch {
    return undefined;
  }
}

async function httpFailure(response: Response, asset?: string): Promise<ReleaseFetchError> {
  if (response.status === 404 && asset) {
    return new ReleaseFetchError({ code: 'release_asset_missing', details: { http_status: 404, asset } });
  }
  const message = await githubMessage(response);
  const retry = retryAt(response);
  return new ReleaseFetchError({
    code: 'github_http',
    details: {
      http_status: response.status,
      ...(message ? { github_message: message } : {}),
      ...(retry ? { retry_at: retry } : {}),
    },
  });
}

async function request(url: string, redirect: RequestRedirect): Promise<Response> {
  try {
    return await fetch(url, { cache: 'no-store', redirect, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ReleaseFetchError({ code: 'github_unreachable', details: {} });
  }
}

/** Tag of the latest published release, read from the github.com redirect. */
export async function fetchLatestReleaseTag(): Promise<string> {
  const response = await request(`${GITHUB_BASE}/releases/latest`, 'manual');
  if (response.status < 300 || response.status >= 400) {
    if (response.ok || response.status === 404) {
      throw new ReleaseFetchError({ code: 'release_lookup_invalid', details: {} });
    }
    throw await httpFailure(response);
  }
  const prefix = `${GITHUB_BASE}/releases/tag/`;
  const location = response.headers.get('location') ?? '';
  const tag = location.startsWith(prefix) ? location.slice(prefix.length) : '';
  if (!isReleaseTag(tag)) throw new ReleaseFetchError({ code: 'release_lookup_invalid', details: {} });
  return tag;
}

/** A small release file (manifest or signature) of the given official release. */
export async function fetchReleaseAsset(tag: string, name: string, limit = 4096): Promise<Buffer> {
  if (!isReleaseTag(tag)) throw new ReleaseFetchError({ code: 'release_lookup_invalid', details: {} });
  const response = await request(`${GITHUB_BASE}/releases/download/${tag}/${name}`, 'follow');
  if (!response.ok) throw await httpFailure(response, name);
  let body: Buffer | null;
  try {
    body = await readBounded(response, limit);
  } catch {
    throw new ReleaseFetchError({ code: 'github_unreachable', details: { asset: name } });
  }
  if (!body) throw new ReleaseFetchError({ code: 'release_lookup_invalid', details: { asset: name } });
  return body;
}

export function toUpdateFailure(error: unknown, fallbackCode = 'release_lookup_invalid'): UpdateFailure {
  return error instanceof ReleaseFetchError ? error.failure : { code: fallbackCode, details: {} };
}
