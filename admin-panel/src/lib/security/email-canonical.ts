/**
 * Canonicalize an email address for rate-limit bucket keys.
 *
 * Trim + lowercase, strip the +subaddress (RFC 5233 — honoured by Gmail,
 * Outlook, ProtonMail, Fastmail, …), and drop dots in the local-part for
 * Gmail/Googlemail addresses (Gmail treats `u.s.e.r@gmail.com` and
 * `user@gmail.com` as the same mailbox).
 *
 * The result MUST NOT be used as a contact address — only as a stable
 * identity key for enumeration-resistant rate limiting.
 */
export function canonicalizeEmailForBucket(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at < 1) return normalized;

  let local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);

  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
  }

  return `${local}@${domain}`;
}
