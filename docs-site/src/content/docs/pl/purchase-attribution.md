---
title: "Źródła zakupów (atrybucja)"
description: "Skąd przyszedł każdy zakup: UTM, strona odsyłająca, pierwszy i ostatni kontakt, kanał, przychód netto wg źródła — przez API, MCP i webhooki."
---

Każde zamówienie w Sellf zapisuje, **skąd przyszło**, w chwili zakupu. Źródło nie zmienia się
później, więc raport za zeszły miesiąc za rok da tę samą odpowiedź.

## Co zapisujemy

| Pole | Znaczenie |
|---|---|
| `channel` | Kanał ostatniego kontaktu: `email`, `paid_social`, `paid_search`, `organic_social`, `organic_search`, `referral`, `affiliate`, `direct`, `other`, `unknown` (albo Twoje własne nazwy) |
| `last.*` | Kontakt, który doprowadził do zakupu: `source`, `medium`, `campaign`, `content`, `term`, `utm_id` (oznaczenia UTM), `referrer_host` (sama domena), `landing_path` (bez parametrów), `at` |
| `first.*`, `first_channel` | Pierwsza znana wizyta — tylko za zgodą analityczną odwiedzającego |
| `sessions_count`, `first_seen_at`, `days_to_purchase` | Liczba wizyt i czas od pierwszej wizyty do zakupu (za zgodą) |
| `click` | Typ identyfikatora kliknięcia reklamy (`gclid`, `fbclid` i inne) i sam identyfikator — **tylko za zgodą marketingową**, usuwany po ustawionym okresie (domyślnie 30 dni; typ zostaje) |
| `device_class`, `country` | Komputer / telefon / tablet / bot z User-Agent; kraj z nagłówka CDN (`cf-ipcountry`), gdy jest |
| `kind` | `payment`, `subscription`, `renewal`, `bank_transfer`, `free` |
| `mode`, `consent` | `url` (tylko z linku do koszyka), `stored` (pierwszy i ostatni kontakt), `none` (nie zebrano); poziom zgody |

Obejmuje płatności online, subskrypcje (odnowienia dziedziczą źródło pierwszego zakupu), przelewy
i produkty darmowe. Zakup z kuponem partnera zawsze trafia do kanału `affiliate`.

## Dwa tryby, zależnie od zgody

- **Bez zgody na ciasteczka** — używamy tylko adresu, z którego otwarto koszyk (UTM, domena
  odsyłająca, strona wejścia). W przeglądarce nic nie zostaje.
- **Zgoda analityczna** — skrypt pamięta pierwszy i ostatni kontakt oraz licznik wizyt
  w `localStorage` domeny strony. Zgoda marketingowa dodatkowo zachowuje identyfikator kliknięcia reklamy.

Na stronach Sellf zgodę daje baner ciasteczek Sellf. Na Twoich stronach (osadzony koszyk, bramka
treści) przekaż decyzję swojego banera:

```html
<script>
  window.sellfAttributionConsent = 'analytics'; // 'none' | 'analytics' | 'marketing'
</script>
```

Skrypt działa w istniejących skryptach: loaderze koszyka (`/embed/v1/checkout.js`) i bramce
treści (`gate.js`); nic dodatkowego nie wklejasz. Linki z Twojej strony do koszyka Sellf na innej
domenie niosą źródło w parametrze `sf_a`, więc UTM nie ginie między domenami.

Oznaczaj linki spójnie, np. `utm_source=listmonk&utm_medium=email&utm_campaign=mail-05&utm_content=cta-1`
albo `utm_source=facebook&utm_medium=paid_social`.

## Reguły kanałów

**Ustawienia → Źródła zakupów**: czas przechowywania identyfikatorów kliknięć (1–365 dni)
i reguły kanałów. Wygrywa pierwsza pasująca aktywna reguła (najniższy numer priorytetu). Reguły
domyślne można wyłączyć; własne dodajesz na wierzchu. Zmiany dotyczą nowych zakupów.

## Odczyt

### Panel

**Sprzedaż → Źródła sprzedaży**: ostatni albo pierwszy kontakt, zakres dat i tabela kanał, źródło,
kampania i partner z liczbą zamówień, przychodem brutto i netto (po zwrotach). Wszystkie kolumny
wiersza pochodzą z tego samego kontaktu. Identyfikator kliknięcia reklamy należy do wizyty, z którą
przyszedł: późniejsza wizyta z kampanii bez niego go zastępuje, więc kanał ostatniego kontaktu nigdy
nie bierze się ze starszego kliknięcia.

### API (zbiorczo, bez danych osobowych) — uprawnienie `analytics:read`

```bash
curl -H "X-API-Key: $KEY" "https://sklep.example.com/api/v1/analytics/attribution?days=3"
```

Parametry: `days` (domyślnie 30) albo `from`/`to`, `touch=last|first`, `group_by` (lista po
przecinku), `product_id`. Wiersz: wymiary + `currency, orders, paid_orders, free_orders,
customers, gross, refunded, net, net_per_customer, avg_days_to_purchase`. Kwoty w **jednostkach
głównych**, osobno dla każdej waluty; `net` odejmuje zwroty, spór liczy się jak pełny zwrot.
Małych grup nie łączymy.

### Pojedyncze zamówienia — uprawnienie `payments:read`

`GET /api/v1/payments?embed=attribution` dodaje `attribution` do każdej płatności (albo `null`).

### MCP (agenci)

`get_purchase_attribution` — bez argumentów oznacza „ostatnie 3 dni, ostatni kontakt”. Zapytaj
agenta: *„Skąd pochodzą zakupy z ostatnich 3 dni?”*. `list_payments` przyjmuje `embed: "attribution"`.

### Webhook

`purchase.completed` zawiera `attribution` (kanał, ostatni i pierwszy kontakt, urządzenie, kraj,
`clickIdType`) — nigdy samego identyfikatora kliknięcia. Zobacz [Webhooki](/pl/webhooks/).
