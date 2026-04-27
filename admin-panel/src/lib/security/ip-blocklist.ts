/**
 * Shared private-IP classifier used by URL validators and outbound HTTP agents.
 * Returns true for any address that should be unreachable from outbound webhooks.
 */

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateIPv4(address: string): boolean {
  const match = address.match(IPV4_REGEX);
  if (!match) return false;

  const [, a, b, c, d] = match.map(Number);
  if ([a, b, c, d].some((octet) => octet < 0 || octet > 255 || Number.isNaN(octet))) {
    return false;
  }

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
}

function normalizeIPv6(address: string): string {
  return address.replace(/^\[|\]$/g, '').toLowerCase();
}

function isPrivateIPv6(address: string): boolean {
  const addr = normalizeIPv6(address);

  if (addr === '::' || addr === '::1') return true;       // unspecified + loopback

  // IPv4-mapped (::ffff:a.b.c.d) — extract embedded IPv4 and recurse
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);

  // Hex-form IPv4-mapped (::ffff:7f00:1) — 4 trailing hex octets after ::ffff:
  const hexMapped = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    if (Number.isFinite(high) && Number.isFinite(low)) {
      const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
      return isPrivateIPv4(ipv4);
    }
  }

  if (addr.startsWith('fe80:') || addr.startsWith('fe80::')) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true;                       // fc00::/7 unique-local

  return false;
}

/** True if the literal IP belongs to a private, loopback, link-local, or reserved range. */
export function isPrivateOrReservedIp(address: string): boolean {
  if (!address) return true;
  if (address.includes(':')) return isPrivateIPv6(address);
  return isPrivateIPv4(address);
}
