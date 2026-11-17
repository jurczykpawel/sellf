/**
 * Canonicalize an email address for rate-limit bucket keys.
 *
 * Trim + lowercase, then fold only the variants a known provider delivers to one
 * inbox: Gmail/Googlemail ignore dots and a `+tag` in the local part; the other
 * listed providers document `+tag` subaddressing. Any other domain keeps its full
 * local part — its mail server may treat `sales+uk@` and `sales+pl@` as separate
 * mailboxes.
 *
 * The result MUST NOT be used as a contact address — only as a stable
 * identity key for enumeration-resistant rate limiting.
 */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/** Providers with documented `+tag` subaddressing (one inbox per local part before `+`). */
const PLUS_ALIAS_DOMAINS = new Set([
  ...GMAIL_DOMAINS,
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
  'fastmail.com', 'fastmail.fm',
]);

export function canonicalizeEmailForBucket(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at < 1) return normalized;

  let local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);

  if (PLUS_ALIAS_DOMAINS.has(domain)) {
    const plus = local.indexOf('+');
    if (plus > 0) local = local.slice(0, plus);
  }
  if (GMAIL_DOMAINS.has(domain)) local = local.replace(/\./g, '');

  return `${local}@${domain}`;
}
