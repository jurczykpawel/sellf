/**
 * Outbound HTTP agent that re-checks the resolved peer at connect time
 * via a custom dns.lookup, rejecting private/reserved targets.
 *
 * Use via: fetch(url, { dispatcher: getSsrfSafeAgent() })
 */

import dns, { LookupAddress } from 'node:dns';
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

function ssrfSafeLookup(
  hostname: string,
  options: dns.LookupOptions | LookupCallback,
  callback?: LookupCallback
): void {
  const cb = (typeof options === 'function' ? options : callback) as LookupCallback;
  const opts: dns.LookupOptions = typeof options === 'function' ? {} : options;

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
