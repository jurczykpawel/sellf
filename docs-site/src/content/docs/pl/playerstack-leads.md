---
title: Formularze PlayerStack
description: Lead magnety i zgoda marketingowa potwierdzane linkiem z maila.
---

Sellf przyjmuje kontrakt hardened `plugin-email-gate`. Odpowiedź
`200 {"status":"check_email"}` oznacza przyjęcie zgłoszenia. Dostęp i webhook
`lead.captured` powstają dopiero po kliknięciu linku z maila. Istniejące konta
otrzymują tę samą odpowiedź. Sellf przechowuje dowód zgody; listę mailingową
i wypis obsługuje narzędzie podłączone przez webhook.

## Ustawienia produktu

W sekcji osadzania produktu włącz embed. Produkt musi być darmowy, aktywny,
jednorazowy i w oknie dostępności. Ustaw treść zgody PL/EN i wersję (1–60 liter,
cyfr, kropek, myślników lub podkreśleń). Zmieniaj wersję przy zmianie treści.

**Zapis na listę wymagany** jest domyślnie wyłączony. Po włączeniu formularz mówi,
że materiał jest wydawany w zamian za zapis na newsletter. Checkbox pozostaje
niezaznaczony. Warunkowanie usługi zgodą marketingową może wpływać na jej
dobrowolność (art. 7 ust. 4 RODO, wytyczne EROD 05/2020). To decyzja sprzedawcy,
który powinien sprawdzić treść i zasadność takiego ustawienia w swoim przypadku.

## Trasy i kontrakt

Każde żądanie z innej domeny, także GET i OPTIONS, wymaga nagłówka Origin z listy domen osadzania
sprzedawcy (ustawienia domen embed; fallback `SELLF_EMBED_ALLOWED_ORIGINS`).
Obsługiwane są żądania z credentials oraz żądania przeglądarki z tej samej
instancji Sellf, gdy GET pomija Origin (Sec-Fetch-Site: same-origin). `product` to slug lub UUID, 1–100 znaków.
`src` to URL HTTPS filmu, do 2048 znaków, tylko do zapisu i webhooka — nie wybiera
produktu ani przekierowania.

- `GET /api/leads/challenge?product=<slug-lub-uuid>` → `{altcha, nonce}`.
  Nonce jest przypięty do produktu, Origin i challenge ALTCHA. Wygasa po 10 minutach;
  pierwszy POST zużywa go także przy odrzuceniu. Ponowienie wymaga nowego challenge.
- `POST /api/leads/submit?product=<slug-lub-uuid>` przyjmuje JSON
  `{email, src, product?, nonce, altcha, marketingConsent?, consentVersion?, consentText?}`.
  Produkt w query służy preflightowi; musi też być w body zgłoszenia.
  `altcha` może być obiektem rozwiązania albo base64 JSON. Limity IP/email dają 429,
  niepoprawne dane/zgoda 400, a produkt płatny, wyłączony lub niedostępny 404.
- `GET /api/products/<slug-lub-uuid>/playerstack?locale=pl` zwraca publiczny config:
  `src` z filmu podglądu, tytuł, `emailGate` i obie wersje `marketingConsent.pl` / `.en`.
  Domyślny język to EN. Nie zwraca prywatnej konfiguracji treści produktu.
  Integrator ustawia zaufane adresy challenge/webhook oraz src, gdy nie ma podglądu.

Wersja zgody w kontrakcie ma sufiks języka, np. `1:pl` — wyślij ją bez zmian.
Przy `marketingConsent: true` Sellf zapisuje własną treść przypisaną do wersji
w danym języku; `consentText` klienta jest informacją pomocniczą. Bez zgody można
odebrać darmowy produkt, chyba że sprzedawca włączył wymagany zapis.
Sam zapis na listę pomija `product` w obu żądaniach i wymaga zgody. Używa listy
originów instancji i domyślnej treści PL/EN z wersją `1:pl` / `1:en` z pliku
`src/lib/leads/config.ts`.

## Integracja z PlayerStack

### Zaufany origin Sellf (PlayerStack od 90b5f28)

Dla instancji HTTPS API podaje absolutne `emailGate.webhookUrl` i
`emailGate.challengeUrl` z originu skonfigurowanego w Sellf. Nagłówki żądania nie
wybierają tych adresów. Dodaj origin Sellf do listy zaufanych originów adaptera:

```js
import { createSellfConfigProvider } from '@playerstack/plugin-sellf-adapter';
const base = 'https://twoj-sellf.example';
const provider = createSellfConfigProvider({
  baseUrl: base,
  trustedOrigins: [new URL(base).origin],
});
const element = document.querySelector('player-stack');
element.setAttribute('data-sellf-product', 'free-guide');
const config = await provider.load(element);
// Użyj config w hoście PlayerStacka albo zarejestruj provider w swoim hoście.
```

Oba adresy zawierają produkt w query, aby preflight korzystał z listy domen
właściwego sprzedawcy. Sellf nie ma kolektora analityki odtwarzacza, dlatego pomija
`analytics.endpoint`.

### Endpointy integratora (także PlayerStack 8baee66)

Endpointy integratora mają zawsze pierwszeństwo, również przy jednoczesnym
ustawieniu trustedOrigins. Ten wariant obsługuje starszy adapter i lokalny HTTP:

```js
import { createSellfConfigProvider } from '@playerstack/plugin-sellf-adapter';
const product = 'free-guide';
const base = 'https://twoj-sellf.example';
const provider = createSellfConfigProvider({
  baseUrl: base,
  fetchOptions: { credentials: 'include', headers: { 'Accept-Language': 'pl' } },
  endpoints: { emailGate: {
    challenge: `${base}/api/leads/challenge`,
    webhook: `${base}/api/leads/submit?product=${encodeURIComponent(product)}&locale=pl`,
  } },
});
```

API publikuje automatyczne adresy endpointów tylko dla skonfigurowanego originu
HTTPS; lokalny HTTP korzysta z endpointów integratora. Jeżeli produkt nie ma filmu
podglądu, ustaw atrybut `src` na elemencie. Jawne `?locale=pl` ma pierwszeństwo
przed pierwszą preferencją Accept-Language; domyślnym językiem jest EN. API zwraca
14 przetłumaczonych komunikatów, `at: "after"`, `altchaFormat: "base64"`,
`remember: false` oraz zgodę i informację o prywatności w limitach adaptera.
Formularz przed filmem można ustawić jako `at: "before"` w zaufanej konfiguracji
hosta. Każde 2xx oznacza przyjęcie zgłoszenia; adres nadal potwierdza się mailem.

## Webhook po potwierdzeniu

W Sellf zasubskrybuj `lead.captured`. Standardowa podpisana koperta i kolejka
webhooków zawierają w `data`: `leadId`, `customer: {email, userId}`,
`product: {id, slug, name}` (null bez produktu), `source`, `capturedAt`, `confirmedAt`,
`marketingConsent`, `consentVersion`, `consentConfirmedAt` (null bez zgody).
Osobne zgłoszenie ma osobny identyfikator; ponowne otwarcie potwierdzenia nie tworzy
drugiej dostawy do tego samego endpointu. Odbiorca usuwa duplikaty po ID koperty.

Dodaj osobę do listy tylko przy `marketingConsent === true` i obecnym
`consentConfirmedAt`. Niepotwierdzone zgłoszenie nic nie wysyła i wygasa po dobie.
Potwierdzony dowód zostaje w `lead_submissions`, dostępny wyłącznie przez service role.
Inne źródła `lead.captured` mogą mieć inny payload; opisane pola zgody dotyczą
zgłoszeń PlayerStacka.

Przy niezaznaczonej opcjonalnej zgodzie przypięty adapter pomija `consentVersion`. Ustaw język formularza w zaufanym adresie zgłoszenia: `?locale=pl` albo `?locale=en`. Sellf zachowa go dla maila potwierdzającego i `customer.locale` niezależnie od zgody. Bez tego parametru użyje języka wersji zgody lub Accept-Language.
