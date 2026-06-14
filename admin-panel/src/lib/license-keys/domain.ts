const DOMAIN_LABEL_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isIpLiteral(host: string): boolean {
  if (host.includes(':') || host.startsWith('[') || host.endsWith(']')) return true;
  return IPV4_PATTERN.test(host);
}

function isValidDomainHost(host: string): boolean {
  if (host.length > 253 || !host.includes('.') || isIpLiteral(host)) return false;
  return host.split('.').every((label) => DOMAIN_LABEL_PATTERN.test(label));
}

/** Normalize a buyer-supplied domain to the bare host used in license claims. */
export function normalizeLicenseDomain(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return undefined;

  let host: string;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.username || parsed.password) return undefined;
      host = parsed.hostname;
    } catch {
      return undefined;
    }
  } else {
    if (raw.includes('/') || raw.includes('?') || raw.includes('#') || raw.includes('@')) return undefined;
    const withoutWildcard = raw.startsWith('*.') ? raw.slice(2) : raw;
    try {
      const parsed = new URL(`https://${withoutWildcard}`);
      host = parsed.hostname;
    } catch {
      return undefined;
    }
  }

  const normalized = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return isValidDomainHost(normalized) ? normalized : undefined;
}

/** Policy A: an apex binding includes the apex and all of its subdomains. */
export function domainMatches(licensedDomain: unknown, instanceDomain: unknown): boolean {
  const licensed = normalizeLicenseDomain(licensedDomain);
  const instance = normalizeLicenseDomain(instanceDomain);
  if (!licensed || !instance) return false;
  return instance === licensed || instance.endsWith(`.${licensed}`);
}
