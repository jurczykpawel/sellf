/**
 * Outbound HTTP agent that re-checks the resolved peer at connect time
 * via a custom dns.lookup, rejecting private/reserved targets.
 *
 * Use via: fetch(url, { dispatcher: getSsrfSafeAgent() })
 */

import type { LookupAddress, LookupOptions } from 'node:dns';
import { Agent } from 'undici';
import { isPrivateOrReservedIp } from './ip-blocklist';

export class SsrfBlockedError extends Error {
  readonly hostname: string;
  readonly address: string;

  constructor(hostname: string, address: string) {
    super(`Blocked: ${hostname} → ${address}`);
    this.name = 'SsrfBlockedError';
    this.hostname = hostname;
    this.address = address;
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

// Loaded lazily via a dynamic import(), never a static top-level `import
// dns from 'node:dns'`: this module is reachable from lib/tracking/index.ts
// (a barrel that ALSO re-exports client-side tracking code), so a static
// Node-builtin import here gets pulled into browser bundle analysis and
// Turbopack cannot bundle 'node:dns' for the browser (hard build failure,
// not just a warning). A dynamic import() only resolves when this function
// actually runs — server-side, at real connection time. Same pattern
// lib/validations/webhook.ts already uses for its own DNS-based SSRF check.
let dnsModulePromise: Promise<typeof import('node:dns')> | undefined;
function loadDns(): Promise<typeof import('node:dns')> {
  if (!dnsModulePromise) dnsModulePromise = import('node:dns');
  return dnsModulePromise;
}

function ssrfSafeLookup(
  hostname: string,
  options: LookupOptions | LookupCallback,
  callback?: LookupCallback
): void {
  const cb = (typeof options === 'function' ? options : callback) as LookupCallback;
  const opts: LookupOptions = typeof options === 'function' ? {} : options;

  loadDns()
    .then((dns) => {
      dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
        if (err) {
          cb(err, '', 0);
          return;
        }

        const list = Array.isArray(addresses) ? addresses : [addresses as unknown as LookupAddress];
        const blocked = list.find((addr) => isPrivateOrReservedIp(addr.address));
        if (blocked) {
          cb(new SsrfBlockedError(hostname, blocked.address), '', 0);
          return;
        }

        if (opts.all) {
          cb(null, list, 0);
        } else {
          const first = list[0];
          cb(null, first.address, first.family);
        }
      });
    })
    .catch((err: unknown) => {
      cb(err as NodeJS.ErrnoException, '', 0);
    });
}

let cachedAgent: Agent | null = null;

/** Lazy singleton — undici Agent with private-IP-rejecting connect lookup. */
export function getSsrfSafeAgent(): Agent {
  if (cachedAgent) return cachedAgent;
  cachedAgent = new Agent({
    connect: {
      // undici's connect.lookup uses the same callback signature as dns.lookup
      lookup: ssrfSafeLookup,
    },
  });
  return cachedAgent;
}

/**
 * Read at most `maxChars` characters of a response body, then stop pulling
 * more bytes — instead of `response.text()`, which always buffers the
 * entire body in memory first and only lets the caller truncate it
 * afterwards. That matters for responses from URLs we don't control
 * (webhook endpoints, ad-platform/GTM containers): a slow or hostile peer
 * can otherwise stream an unbounded amount of data into memory during the
 * request's timeout window before a `.substring()` ever runs.
 */
export async function readBoundedText(
  // `body` is typed loosely on purpose: DOM's lib.dom ReadableStream<T> and
  // undici's/node:stream/web's ReadableStream<T> are structurally
  // incompatible in TS's BYOB-reader typings even though they behave
  // identically at runtime (both are Web Streams). Callers pass either a
  // native fetch Response or an undici Response.
  response: { body: unknown },
  maxChars: number
): Promise<string> {
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let result = '';
  try {
    while (result.length < maxChars) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
  } catch {
    // Partial read is still useful for logging/error messages — return
    // whatever was collected before the stream errored.
  } finally {
    await reader.cancel().catch(() => {});
  }
  return result.slice(0, maxChars);
}
