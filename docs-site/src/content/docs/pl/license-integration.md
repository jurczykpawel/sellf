---
title: Sprzedaż licencji do Twojej aplikacji
description: Jak dodać płatne klucze licencyjne do własnej aplikacji przez Sellf. Konfiguracja w panelu, dostarczenie klucza kupującemu, kod weryfikacji offline, cofanie licencji i gotowy prompt dla agenta AI.
---

Tworzysz aplikację (narzędzie do samodzielnego hostowania, wtyczkę, program na komputer) i chcesz, żeby kupujący odblokowywał ją kluczem licencyjnym. Sellf obsługuje sprzedaż i wystawia klucz. Twoja aplikacja sprawdza klucz sama, bez pytania Sellfa przy każdym sprawdzeniu.

Ta strona jest dla twórcy takiej aplikacji. Jeśli wolisz zlecić to agentowi AI, skopiuj [prompt dla agenta](#prompt-dla-agenta-ai) na dole strony.

Techniczny opis formatu dla agentów i narzędzi (po angielsku): [`/llms/license-integration.md`](/llms/license-integration.md).

## Jak to działa

1. Kupujący płaci za Twój produkt w Sellfie.
2. Sellf tworzy **klucz licencyjny**: krótki tekst podpisany Twoim prywatnym kluczem podpisującym. W kluczu jest zapisane, jakiego produktu dotyczy, email kupującego, plan (poziom licencji) i data wygaśnięcia.
3. Kupujący dostaje klucz (na stronie produktu, mailem albo przez Twój własny system mailowy).
4. Kupujący wkleja klucz do Twojej aplikacji. Aplikacja sprawdza podpis Twoim kluczem **publicznym** i odczytuje z niego plan. Do tego nie potrzeba połączenia z siecią.
5. Co jakiś czas aplikacja pyta Sellfa, czy licencja nie została cofnięta (zwrot pieniędzy, chargeback). Wysyła przy tym tylko 4 znaki skrótu, nigdy sam klucz.

Wymagania: licencja Sellf **Pro** na instancji, na której sprzedajesz (wystawianie kluczy to funkcja Pro). Webhooki są opcjonalne; do dodania webhooka wystarczy licencja Registered.

## Konfiguracja w Sellfie

### 1. Utwórz klucz podpisujący

Wejdź w **Ustawienia → Licencja** (`/dashboard/settings?tab=license`) i w sekcji **Klucz podpisujący licencje** kliknij **Wygeneruj klucz**. Sellf utworzy parę kluczy EC P-256, a klucz prywatny zapisze zaszyfrowany na serwerze. Zamiast tego możesz **Wgraj klucz**: własny klucz prywatny EC P-256 w formacie PKCS8 PEM (`-----BEGIN PRIVATE KEY-----`).

Potem panel pokazuje:

- **Identyfikator klucza**: wartość `kid`, zapisywaną w każdym kluczu licencyjnym.
- **Adres JWKS**: `https://your-sellf.example/api/licenses/jwks?seller=<id-sprzedawcy>`. Stąd aplikacja pobiera klucze publiczne. Wartość `seller` to Twój identyfikator sprzedawcy; będzie potrzebny w aplikacji.

:::caution[Zmiana klucza podpisującego]
Sellf publikuje tylko bieżący klucz podpisujący. Gdy wygenerujesz albo wgrasz nowy, stary klucz publiczny znika z adresu JWKS, więc licencje nim podpisane przestają przechodzić weryfikację w aplikacjach, które korzystają z tej listy. Zmieniaj klucz tylko świadomie albo zachowaj stary klucz publiczny w aplikacji (kod niżej przyjmuje go przez `addTrustedKeys`).
:::

### 2. Włącz licencje w produkcie

Otwórz produkt, przejdź do sekcji **Klucz licencyjny** i włącz **Wystaw klucz licencyjny przy zakupie**. Pola opcjonalne:

- **Poziom licencji**: dowolny tekst zapisywany w kluczu, np. `pro` albo `team`. To aplikacja decyduje, co odblokowuje każdy poziom.
- **Ważność (dni)**: od 1 do 36500. Puste pole oznacza klucz bezterminowy.

Zapisz sobie **slug** produktu. Jest w każdym kluczu, a aplikacja powinna przyjmować tylko klucze z własnym slugiem.

Jeśli licencja ma działać tylko na stronie kupującego, dodaj w sekcji **Pola dodatkowe** produktu pole **Dodaj domenę licencji**. Kupujący wpisze domenę przy zakupie, a klucz obejmie tę domenę i wszystkie jej subdomeny.

### 3. Jak klucz trafia do kupującego

- **Strona produktu**: zalogowany kupujący widzi klucz na stronie produktu w Sellfie. Cofniętego klucza strona już nie pokazuje.
- **Mail z Sellfa**: gdy w **Ustawienia → Sklep → Maile do kupujących** włączone jest **Wysyłaj maile do kupujących przez Supabase**, Sellf wysyła klucz mailem razem z linkiem do logowania.
- **Twój własny mail**: zasubskrybuj webhook `license.issued`. Zawiera `licenseKey`, email i język kupującego. Zobacz [Maile do kupujących](/pl/buyer-emails/).
- **Ręcznie**: wystaw klucz w zakładce **Licencje** w panelu albo przez `POST /api/v1/licenses` (zobacz [API](/pl/api/)). Przydaje się do testów, prezentów i obsługi klienta.

## Weryfikacja klucza w aplikacji

Aplikacja potrzebuje od sprzedawcy trzech wartości, zapisanych w konfiguracji:

| Ustawienie | Przykład | Skąd wziąć |
|---|---|---|
| `SELLF_URL` | `https://your-sellf.example` | Adres sklepu w Sellfie |
| `SELLF_SELLER_ID` | `0b6c…` (UUID) | Część `seller=` z adresu JWKS |
| Slug produktu | `my-app-pro` | Produkt w Sellfie |

Jak wygląda klucz: `<payload>.<podpis>`. Payload to JSON zakodowany w base64url, na przykład:

```json
{ "v": 1, "kid": "3f9a1c0b7e2d4a65", "product": "my-app-pro", "email": "buyer@example.com",
  "order": "pi_3PxExample", "tier": "pro", "iat": 1762790400, "exp": 1794326400 }
```

`exp` ma wartość `null`, gdy klucz nie wygasa. `domain` pojawia się tylko wtedy, gdy produkt prosi o domenę licencji. Pełna lista pól jest w [opisie technicznym](/llms/license-integration.md#claims).

### TypeScript / Node

Jeden plik, bez zależności, Node 18+ albo Bun. Skopiuj go do projektu jako `sellf-license.ts`. Komentarze w kodzie są po angielsku, tak jak w wersji angielskiej tej strony.

```ts
// sellf-license.ts — verify a Sellf license key inside your app.
// Node 18+ (or Bun), no dependencies.
import { createHash, createVerify } from 'node:crypto';

export interface LicenseClaims {
  v: 1;
  kid: string;          // which signing key was used
  product: string;      // product slug in Sellf
  email: string;        // buyer email
  order: string;        // opaque order id the license belongs to (used for revocation)
  tier: string | null;  // "License tier" set on the product, or null
  iat: number;          // issued at, Unix seconds
  exp: number | null;   // expires at, Unix seconds; null = never expires
  domain?: string;      // present only when the buyer entered a license domain
  [claim: string]: unknown; // custom checkout fields arrive as custom_<field_id>
}

export interface SellfPublicKey { kid: string; alg: string; pem: string }

export type LicenseCheck =
  | { valid: true; claims: LicenseClaims }
  | { valid: false; reason: 'malformed' | 'unknown_key' | 'signature' | 'expired' | 'wrong_product' | 'wrong_domain' | 'revoked' | 'keys_unavailable' };

/** 1. Offline check: signature, expiry, product and domain. */
export function verifyLicenseKey(
  token: string,
  keys: SellfPublicKey[],
  expect: { product: string; domain?: string; now?: Date },
): LicenseCheck {
  const dot = typeof token === 'string' ? token.trim().indexOf('.') : -1;
  if (dot <= 0) return { valid: false, reason: 'malformed' };
  const payload = token.trim().slice(0, dot);
  const signature = token.trim().slice(dot + 1);
  if (!signature) return { valid: false, reason: 'malformed' };

  let claims: LicenseClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (
    claims?.v !== 1 || typeof claims.kid !== 'string' || typeof claims.product !== 'string' ||
    typeof claims.order !== 'string' || typeof claims.iat !== 'number' ||
    !(claims.exp === null || typeof claims.exp === 'number')
  ) return { valid: false, reason: 'malformed' };

  const key = keys.find((k) => k.kid === claims.kid);
  if (!key) return { valid: false, reason: 'unknown_key' };

  // ECDSA P-256 + SHA-256 over the base64url payload string (not the decoded JSON).
  // The signature is DER-encoded, base64url.
  let ok = false;
  try {
    ok = createVerify('SHA256').update(payload).end().verify(key.pem, Buffer.from(signature, 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, reason: 'signature' };

  const nowSec = Math.floor((expect.now ?? new Date()).getTime() / 1000);
  if (claims.exp !== null && claims.exp < nowSec) return { valid: false, reason: 'expired' };
  if (claims.product !== expect.product) return { valid: false, reason: 'wrong_product' };
  // A domain-bound key needs the instance domain; without it the key is rejected.
  if (claims.domain !== undefined && !domainMatches(claims.domain, expect.domain)) {
    return { valid: false, reason: 'wrong_domain' };
  }
  return { valid: true, claims };
}

/** A license for example.com also covers its subdomains (app.example.com). */
function domainMatches(licensed: unknown, instance: string | undefined): boolean {
  if (typeof licensed !== 'string' || !licensed) return false;
  const host = (instance ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return host !== '' && (host === licensed || host.endsWith(`.${licensed}`));
}

// ---------- network helpers (cache them; never call Sellf on every check) ----------

const SELLF_URL = process.env.SELLF_URL ?? 'https://your-sellf.example';
const SELLF_SELLER_ID = process.env.SELLF_SELLER_ID ?? '';
const CACHE_MS = 5 * 60_000;
const FORCED_REFRESH_MS = 60_000;

let keyCache: { keys: SellfPublicKey[]; at: number } | null = null;
let lastForcedRefresh = 0;
const trustedKeys: SellfPublicKey[] = [];

function isPublicKey(k: unknown): k is SellfPublicKey {
  const key = k as SellfPublicKey;
  return !!key && typeof key.kid === 'string' && typeof key.alg === 'string' &&
    typeof key.pem === 'string' && key.pem.includes('-----BEGIN PUBLIC KEY-----');
}

/** Keys you load yourself at startup (saved last good copy, or an old key kept after a rotation). */
export function addTrustedKeys(keys: unknown[]): void {
  trustedKeys.push(...keys.filter(isPublicKey));
}

/** 2. Public keys. Cached for 5 minutes; the last good copy is kept when Sellf is down or answers nonsense. */
export async function getPublicKeys(opts: { force?: boolean } = {}): Promise<SellfPublicKey[]> {
  const fresh = keyCache !== null && Date.now() - keyCache.at < CACHE_MS;
  if (!fresh || opts.force) {
    try {
      const res = await fetch(`${SELLF_URL}/api/licenses/jwks?seller=${SELLF_SELLER_ID}`, { redirect: 'error' });
      if (!res.ok) throw new Error(`JWKS ${res.status}`);
      const body = (await res.json()) as { keys?: unknown };
      if (!Array.isArray(body?.keys) || !body.keys.every(isPublicKey)) throw new Error('JWKS: unexpected response');
      keyCache = { keys: body.keys, at: Date.now() }; // persist this copy if you want it to survive a restart
    } catch (error) {
      if (!keyCache && trustedKeys.length === 0) throw error;
    }
  }
  return [...(keyCache?.keys ?? []), ...trustedKeys];
}

/** Revocation buckets by 4-char prefix. at = 0 means "refresh at the next check, keep the content until then". */
const revokedCache = new Map<string, { hashes: Set<string>; at: number }>();
const HASH = /^[a-f0-9]{64}$/;

function orderHash(order: string): string {
  return createHash('sha256').update(order, 'utf8').digest('hex');
}

/** 3. Revocation: send only the first 4 hex chars of SHA-256(order), match locally. */
export async function isRevoked(order: string): Promise<boolean> {
  const hash = orderHash(order);
  const prefix = hash.slice(0, 4);
  const cached = revokedCache.get(prefix);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.hashes.has(hash);
  try {
    const res = await fetch(`${SELLF_URL}/api/licenses/revoked?seller=${SELLF_SELLER_ID}&prefix=${prefix}`, { redirect: 'error' });
    if (!res.ok) throw new Error(`CRL ${res.status}`);
    const body = (await res.json()) as { order_hashes?: unknown };
    const list = body?.order_hashes;
    if (!Array.isArray(list) || !list.every((h) => typeof h === 'string' && HASH.test(h))) throw new Error('CRL: unexpected response');
    revokedCache.set(prefix, { hashes: new Set(list as string[]), at: Date.now() });
    return revokedCache.get(prefix)!.hashes.has(hash);
  } catch {
    // Sellf unreachable or wrong answer: keep what you knew. With nothing known, this
    // example lets the license through (fail open); change it if your app must fail closed.
    return cached ? cached.hashes.has(hash) : false;
  }
}

/**
 * Call after a license.revoked / license.restored webhook whose signature you verified.
 * revoked: the order counts as revoked at once, even offline.
 * restored: the bucket is refreshed at the next check; until a refresh succeeds the last known state stays.
 */
export function handleLicenseWebhook(event: 'license.revoked' | 'license.restored', order: string): void {
  const hash = orderHash(order);
  const prefix = hash.slice(0, 4);
  const bucket = revokedCache.get(prefix) ?? { hashes: new Set<string>(), at: 0 };
  if (event === 'license.revoked') bucket.hashes.add(hash);
  bucket.at = 0;
  revokedCache.set(prefix, bucket);
}

/** Full check: offline verification first, then the revocation list. */
export async function checkLicense(token: string, expect: { product: string; domain?: string }): Promise<LicenseCheck> {
  let keys: SellfPublicKey[];
  try {
    keys = await getPublicKeys();
  } catch {
    return { valid: false, reason: 'keys_unavailable' }; // no key known yet and Sellf unreachable
  }
  let result = verifyLicenseKey(token, keys, expect);
  // A key signed right after a rotation: refresh the key list once, at most once a minute.
  if (!result.valid && result.reason === 'unknown_key' && Date.now() - lastForcedRefresh > FORCED_REFRESH_MS) {
    lastForcedRefresh = Date.now();
    result = verifyLicenseKey(token, await getPublicKeys({ force: true }), expect);
  }
  if (!result.valid) return result;
  if (await isRevoked(result.claims.order)) return { valid: false, reason: 'revoked' };
  return result;
}
```

Użycie:

```ts
import { addTrustedKeys, checkLicense, handleLicenseWebhook } from './sellf-license';

// Opcjonalnie przy starcie: klucze zapisane przy wcześniejszym uruchomieniu, żeby restart w czasie awarii Sellfa działał.
addTrustedKeys(loadSavedKeys());

// Domena pochodzi z Twojej konfiguracji, nigdy z klucza licencyjnego ani z żądania.
const result = await checkLicense(licenseKeyFromSettings, { product: 'my-app-pro', domain: config.publicDomain });
if (result.valid) {
  enablePlan(result.claims.tier); // e.g. "pro"
} else if (result.reason === 'keys_unavailable') {
  keepPreviousDecision(); // pierwszy start przy niedostępnym Sellfie: Twoja decyzja (zobacz FAQ)
} else {
  showLicenseError(result.reason); // zobacz „Typowe problemy” niżej
}

// W odbiorniku webhooków, po sprawdzeniu X-Sellf-Signature:
if (event.event === 'license.revoked' || event.event === 'license.restored') {
  handleLicenseWebhook(event.event, event.data.license.order);
}
```

Kiedy sprawdzać: gdy użytkownik zapisuje klucz, przy starcie aplikacji i potem co kilka godzin. Zapamiętuj ostatni wynik, żeby krótka awaria Sellfa niczego nie zmieniała kupującemu.

Co kod robi oprócz sprawdzenia podpisu:

- **Nowy klucz podpisujący.** Klucz licencyjny z nieznanym `kid` sprawia, że kod jeszcze raz pobiera listę kluczy (najwyżej raz na minutę), zanim go odrzuci. Licencje podpisane tuż po zmianie klucza działają od razu.
- **Błędne odpowiedzi.** Odpowiedź bez oczekiwanego kształtu (`keys` z polami `kid`/`alg`/`pem`, `order_hashes` ze skrótami z 64 znaków hex) traktowana jest jak awaria: zostaje ostatnia dobra kopia.
- **Restart.** Zapamiętane dane są tylko w pamięci procesu. Żeby restart w czasie awarii Sellfa nie przeszkadzał, zapisz ostatnią listę kluczy (jest publiczna, więc wystarczy zwykły plik) i wczytuj ją przy starcie przez `addTrustedKeys`.

Wbudowane w przeglądarkę Web Crypto oczekuje innego zapisu podpisu (surowe `r||s`) niż ten, którego używa Sellf (DER). Weryfikuj na serwerze albo w Node, nie w JavaScripcie w przeglądarce.

### PHP

To samo sprawdzenie offline, razem z domeną (`ext-openssl`, PHP 8+). `$keys` to tablica `keys` z adresu JWKS. Pobieranie kluczy i listy cofniętych działa jak w wersji TypeScript; sprawdź listę cofniętych, zanim cokolwiek odblokujesz.

```php
<?php
// $keys = the "keys" array from the JWKS URL; $instanceDomain = this installation's domain from your own config.
function sellf_domain_matches($licensed, ?string $instance): bool {
    if (!is_string($licensed) || $licensed === '') return false;
    $host = preg_replace(['/\.$/', '/^www\./'], '', strtolower(trim($instance ?? '')));
    return $host !== '' && ($host === $licensed || str_ends_with($host, '.' . $licensed));
}

function sellf_verify_license(string $token, array $keys, string $product, ?string $instanceDomain = null, ?int $now = null): ?array {
    $parts = explode('.', trim($token), 2);
    if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') return null;
    [$payload, $sig] = $parts;
    $b64 = fn(string $s) => base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
    $claims = json_decode($b64($payload) ?: '', true);
    if (!is_array($claims) || ($claims['v'] ?? null) !== 1 || !isset($claims['kid'], $claims['order'])) return null;
    $key = null;
    foreach ($keys as $k) { if (($k['kid'] ?? null) === $claims['kid']) { $key = $k; break; } }
    if (!$key) return null;
    // ECDSA P-256 / SHA-256, DER signature, signed over the base64url payload string.
    if (openssl_verify($payload, $b64($sig) ?: '', $key['pem'], OPENSSL_ALGO_SHA256) !== 1) return null;
    if ($claims['exp'] !== null && $claims['exp'] < ($now ?? time())) return null;
    if (($claims['product'] ?? null) !== $product) return null;
    // A domain-bound key needs the instance domain; without it the key is rejected.
    if (array_key_exists('domain', $claims) && !sellf_domain_matches($claims['domain'], $instanceDomain)) return null;
    return $claims; // then check the revocation list (see below) before unlocking anything
}

// Example:
// $claims = sellf_verify_license($licenseKey, $keys, 'my-app-pro', 'app.example.com');
// if ($claims === null) { /* show "invalid license" */ } else { /* use $claims['tier'] */ }
```

### Python

To samo sprawdzenie offline, razem z domeną. Wymaga Pythona 3.10+ i `pip install cryptography`. Sprawdź listę cofniętych, zanim cokolwiek odblokujesz.

```python
import base64, json, time
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

def _b64url(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def _domain_matches(licensed, instance: str | None) -> bool:
    if not isinstance(licensed, str) or not licensed:
        return False
    host = (instance or "").strip().lower().removesuffix(".")
    host = host[4:] if host.startswith("www.") else host
    return host != "" and (host == licensed or host.endswith("." + licensed))

def sellf_verify_license(token: str, keys: list, product: str,
                         instance_domain: str | None = None, now: int | None = None) -> dict | None:
    payload, sep, sig = token.strip().partition(".")
    if not payload or not sep or not sig:
        return None
    try:
        claims = json.loads(_b64url(payload))
    except ValueError:
        return None
    if not isinstance(claims, dict) or claims.get("v") != 1:
        return None
    key = next((k for k in keys if k.get("kid") == claims.get("kid")), None)
    if key is None:
        return None
    public_key = serialization.load_pem_public_key(key["pem"].encode())
    try:
        # ECDSA P-256 / SHA-256, DER signature, signed over the base64url payload string.
        public_key.verify(_b64url(sig), payload.encode("ascii"), ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError):
        return None
    if claims.get("exp") is not None and claims["exp"] < (now or int(time.time())):
        return None
    if claims.get("product") != product:
        return None
    # A domain-bound key needs the instance domain; without it the key is rejected.
    if "domain" in claims and not _domain_matches(claims["domain"], instance_domain):
        return None
    return claims  # then check the revocation list before unlocking anything

# Example:
# claims = sellf_verify_license(license_key, keys, "my-app-pro", "app.example.com")
# if claims is None: show "invalid license"  else: use claims["tier"]
```

## Cofanie licencji

Podpis klucza nigdy nie wygasa sam z siebie, dlatego Sellf publikuje listę cofniętych zamówień. Zamówienie trafia na nią po:

- pełnym zwrocie pieniędzy albo anulowaniu zamówienia (częściowy zwrot nie cofa licencji),
- chargebacku (sporze); wygrany spór może przywrócić licencję, jeśli nie została cofnięta z innego powodu, na przykład po pełnym zwrocie albo ręcznej decyzji sprzedawcy,
- ręcznym cofnięciu w zakładce **Licencje** albo przez `DELETE /api/v1/licenses/{id}`,
- zakończeniu subskrypcji bez zapłaty albo po upływie opłaconego okresu po jej anulowaniu.

**Sprawdzanie listy.** Policz SHA-256 z wartości `order` w kluczu (małe litery, zapis szesnastkowy) i wyślij pierwsze 4 znaki:

```text
GET https://your-sellf.example/api/licenses/revoked?seller=<id-sprzedawcy>&prefix=6270
→ 200 { "order_hashes": ["6270e1…", "…"] }
```

Jeśli Twój pełny skrót jest w `order_hashes`, licencja jest cofnięta. Aplikacja wysyła tylko ten początek skrótu, nigdy klucz ani pełny skrót. Adres nie oddaje całej listy w jednym zapytaniu. Robi to funkcja `isRevoked` z kodu powyżej.

**Powiadomienia.** Zasubskrybuj webhooki `license.revoked` i `license.restored` (Pro). Po sprawdzeniu podpisu webhooka wywołaj `handleLicenseWebhook(event, order)` z wartością `data.license.order`. Przy `license.revoked` zamówienie od razu liczy się jako cofnięte, nawet jeśli potem Sellf będzie niedostępny. Przy `license.restored` kod przy następnym sprawdzeniu pobierze listę ponownie i do czasu udanego pobrania zostawi ostatni znany stan. Okresowego sprawdzania nie wyłączaj: webhook może przyjść z opóźnieniem albo wcale. Webhook zawiera zamówienie, email, poziom licencji, domenę, powód (`refund`, `dispute`, `manual`, `subscription_cancelled`, `expired`) i `crlUrl`, ale nigdy samego klucza. Szczegóły: [Webhooki](/pl/webhooks/).

## Wygaśnięcie

- `exp` jest ustalane przy wystawieniu na podstawie pola **Ważność (dni)**. Jest częścią podpisanego klucza, więc aplikacja sprawdza je offline.
- `exp: null` oznacza klucz bezterminowy.
- Przy subskrypcjach klucz może być ważny dłużej niż subskrypcja: gdy subskrypcja się kończy, zamówienie trafia na listę cofniętych, nawet jeśli `exp` jest późniejsze. Sprawdzaj listę.
- Zmiana daty ważności w Sellfie (`license.updated`) nie zmienia kluczy, które już wystawiono.

## Typowe problemy

| Wynik | Najczęstsza przyczyna | Co zrobić |
|---|---|---|
| `malformed` | Klucz skopiowany z dodatkowym tekstem, ucięty albo to nie jest klucz z Sellfa | Poproś kupującego o ponowne skopiowanie całego klucza; usuń spacje |
| `unknown_key` | Zły `SELLF_SELLER_ID` albo klucz podpisano kluczem, którego Sellf już nie publikuje (zmiana klucza) | Sprawdź adres JWKS w **Ustawienia → Licencja**; zobacz uwagę o zmianie klucza |
| `keys_unavailable` | Pierwszy start, brak zapisanych kluczy i Sellf niedostępny | Zapisuj listę kluczy i wczytuj ją przez `addTrustedKeys`; zdecyduj, co aplikacja robi w tym czasie |
| `signature` | Klucz został zmieniony albo podpisał go inny sklep | Wystaw nowy klucz; sprawdź `SELLF_URL` |
| `expired` | Minęła data `exp` | Kupujący przedłuża licencję albo kupuje ponownie |
| `wrong_product` | Poprawny klucz do innego produktu tego samego sprzedawcy | Porównaj slug w kluczu ze slugiem produktu |
| `wrong_domain` | Aplikacja działa pod inną domeną niż ta w kluczu | Wystaw klucz na właściwą domenę |
| `revoked` | Zwrot, chargeback, ręczne cofnięcie albo koniec subskrypcji | To zamierzone; pokaż kupującemu, jak kupić ponownie |
| JWKS zwraca `{"keys": []}` | Zły identyfikator sprzedawcy albo brak klucza podpisującego | Wygeneruj klucz w Sellfie; sprawdź identyfikator |
| `429` z Sellfa | Ponad 60 zapytań na minutę | Zapamiętuj klucze i wyniki sprawdzania listy |

## Najczęstsze pytania

**Czy aplikacja potrzebuje klucza API Sellfa?** Nie. Weryfikacja korzysta tylko z publicznych adresów. Nigdy nie umieszczaj klucza API w aplikacji, którą rozdajesz lub sprzedajesz.

**Co się dzieje, gdy Sellf nie działa?** Zależy od tego, co aplikacja już wie:

- **Klucze publiczne są znane** (zapamiętane albo wczytane przez `addTrustedKeys`): podpis sprawdza się normalnie, offline.
- **Żaden klucz publiczny nie jest znany** (pierwszy start bez zapisanej kopii): podpisu nie da się sprawdzić i `checkLicense` zwraca `keys_unavailable`. Nigdy nie pomijaj sprawdzenia podpisu. Zdecyduj, co aplikacja robi w tym czasie: zostawia poprzednią decyzję, działa w wersji darmowej albo prosi o ponowną próbę później.
- **Lista cofniętych:** używany jest ostatni znany wynik dla danej grupy. Jeśli nic o niej nie wiadomo, kod powyżej przepuszcza licencję, żeby awaria nie zablokowała płacącego klienta. Jeśli aplikacja ma w takiej sytuacji blokować, zwracaj tam `true`.

**Czy kupujący może udostępnić klucz innym?** Klucz jest powiązany z emailem kupującego, a jeśli o to poprosisz, także z domeną. Pokazuj email na ekranie licencji w aplikacji, a w oprogramowaniu webowym używaj powiązania z domeną.

**Czy mogę wystawić klucz bez zakupu?** Tak: w zakładce **Licencje** w panelu albo przez `POST /api/v1/licenses` kluczem API z uprawnieniem `licenses:write`.

**Gdzie zdefiniować poziomy licencji?** W Sellfie to tylko tekst w polu **Poziom licencji** produktu. Aplikacja sama przypisuje nazwom poziomów konkretne funkcje.

## Prompt dla agenta AI

Skopiuj ten tekst do Claude Code, Codeksa, Cursora albo innego agenta, który pracuje w repozytorium Twojej aplikacji. Uzupełnij trzy wartości na górze. Prompt jest po angielsku, tak jak opis techniczny, do którego odsyła.

```text
Add Sellf license key support to this application.

Values (put them in configuration, not in code):
- SELLF_URL = https://your-sellf.example
- SELLF_SELLER_ID = <seller UUID from the JWKS URL in Sellf, Settings → License>
- SELLF_PRODUCT_SLUG = <product slug in Sellf>

First read the full technical contract and follow it exactly:
https://docs.sellf.app/llms/license-integration.md
(token format, claims, public-key and revocation endpoints, verification algorithm, webhooks).
A tested reference implementation is in the "Verify the key in your app" section of
https://docs.sellf.app/license-integration/

Build:
1. A place where the user pastes the license key (settings screen, CLI command or env var,
   whatever fits this app) and where it is stored.
2. Offline verification: split the token at the first ".", decode the base64url JSON payload,
   pick the public key by "kid" from GET {SELLF_URL}/api/licenses/jwks?seller={SELLF_SELLER_ID},
   verify the ECDSA P-256/SHA-256 DER signature over the payload string, then check "exp",
   "product" == SELLF_PRODUCT_SLUG and, if present, "domain" (subdomains allowed). The instance
   domain comes from this app's trusted configuration; a domain-bound key is rejected when it is
   not configured. On an unknown "kid", refresh the key list once (rate-limited) before rejecting.
3. Revocation: SHA-256 of the "order" claim, send only the first 4 hex chars to
   GET {SELLF_URL}/api/licenses/revoked?seller={SELLF_SELLER_ID}&prefix=<4 hex>, revoked if the
   full hash is in "order_hashes".
4. Caching: public keys and revocation buckets cached (at least 5 minutes), last good copy used
   when Sellf is unreachable or answers with an unexpected shape (validate "keys" entries and
   64-hex "order_hashes" before replacing the cache). Check on key entry, on start and every few
   hours, even if webhooks are used.
   Decide explicitly, and tell me what you chose: (a) what happens on a first start with no saved
   public key while Sellf is unreachable (never skip the signature check), (b) whether keys are
   saved to survive restarts, (c) whether a revocation check that cannot reach Sellf and knows
   nothing about the bucket lets the license through or blocks it.
   If the app receives Sellf webhooks: on a verified license.revoked mark that order revoked
   immediately; on license.restored refresh the bucket at the next check without dropping the
   known state before a refresh succeeds.
5. Feature gating by the "tier" claim, in one place, and a clear message for each failure
   (malformed, unknown key, bad signature, expired, wrong product, wrong domain, revoked).

Do not:
- call Sellf on every license check or every request;
- ask for, store or generate the seller's private signing key;
- trust any claim before the signature is verified, or skip the "exp" check;
- use a Sellf API key in this application;
- send the token or the full order hash to Sellf, or write tokens to logs;
- clear the known revocation state before a successful refresh.

Test it with automated tests that need no network: generate an EC P-256 key pair in the test,
sign base64url(JSON claims) with SHA-256 (DER signature) to make tokens, and cover: valid key,
key without expiry (exp null), expired key, modified payload, key signed by another key pair,
unknown kid followed by a successful key refresh (rotation), wrong product, wrong domain,
missing instance domain for a domain-bound key, revoked order (mocked revocation response),
revoked order still revoked after a license.revoked webhook while Sellf is unreachable, a 200
response with the wrong shape that must not replace the cache, and Sellf unreachable on a cold
start. Then report what you changed and how to try it with a real key from Sellf.
```
