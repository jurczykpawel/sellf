// Anonymize `customer_name` from payment_transactions before exposing it on
// the public /api/public/products/[slug]/recent-supporters endpoint.
//
// Rules:
//  - Pierwsze słowo z customer_name (np. "Jan Kowalski" → "Jan").
//  - Jeśli customer_name jest pusty / wygląda jak email / jest złożony
//    głównie z cyfr lub symboli → fallback z fixed listy ("Tajemniczy fan",
//    "Tajemniczy dobroczyńca", "Tajemniczy patron"). Hashujemy seed (np.
//    transaction id) żeby ten sam wpis zawsze pokazywał ten sam nick — kasa
//    by się rozjeżdżała przy każdym fetchu i klient zauważał.

const ANONYMOUS_FALLBACKS = [
  'Tajemniczy fan',
  'Tajemniczy dobroczyńca',
  'Tajemniczy patron',
  'Sekretny fan',
  'Anonimowy mecenas',
] as const;

const FIRST_WORD = /^\S+/;
// Looks-like-an-email: presence of `@` anywhere is enough — emails should
// never reach this function via customer_name in the first place, but Mailpit /
// test data sometimes does. Defense in depth.
const LOOKS_LIKE_EMAIL = /@/;
// "Real name" requires at least one letter (Unicode). Strings made entirely
// of digits, whitespace, or punctuation are rejected.
const HAS_LETTER = /\p{L}/u;

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

export function anonymizeSupporterName(
  customerName: string | null | undefined,
  seed: string,
): string {
  const fallback = ANONYMOUS_FALLBACKS[hashSeed(seed) % ANONYMOUS_FALLBACKS.length];
  if (!customerName) return fallback;
  const trimmed = customerName.trim();
  if (trimmed.length === 0) return fallback;
  if (LOOKS_LIKE_EMAIL.test(trimmed)) return fallback;
  if (!HAS_LETTER.test(trimmed)) return fallback;
  const match = trimmed.match(FIRST_WORD);
  const firstWord = match ? match[0] : trimmed;
  // Cap length so an aggressive-but-letter-containing fake name like
  // "A".repeat(500) can't blow up the UI.
  return firstWord.slice(0, 30);
}
