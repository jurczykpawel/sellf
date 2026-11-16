---
title: Podłącz swojego agenta AI
description: Podłącz Claude Code, Claude Desktop, Codex lub Cursor do wbudowanego endpointu MCP Sellf i wypróbuj przetestowane przepisy.
---

Każda instalacja Sellf ma wbudowany endpoint MCP pod adresem **`https://TWOJ-SELLF/api/mcp`** (Streamable HTTP). Agent AI łączy się z nim kluczem API Sellf i może tworzyć szkice produktów, kupony albo odczytywać raporty sprzedaży. Po stronie Sellf niczego nie instalujesz.

Narzędzia powstają z [opisu API](/pl/api/#opis-api-dla-agentów) (`/api/v1/openapi.json`): jedno narzędzie na operację API, nazwane jej `operationId` (np. `create_product`). Każde wywołanie to zwykłe zapytanie do `/api/v1` z Twoim kluczem, więc zakresy, limity zapytań i dziennik audytu działają tak samo jak w API; MCP niczego nie omija. Treść zapytania podajesz w argumencie `body`, parametry ścieżki i zapytania jako argumenty o tych nazwach.

## Przygotuj klucz

W Sellf otwórz **Panel → Klucze API** (`/dashboard/api-keys`). Tworzenie klucza wymaga licencji registered lub wyższej. Utwórz osobny klucz dla każdego zastosowania, z uprawnieniami z tabeli, i skopiuj go przy wyświetleniu. Wybór zakresów w panelu wymaga Pro; zalogowany administrator może również utworzyć klucz z jawnymi zakresami przez `POST /api/v1/api-keys` (zobacz [opis API](/pl/api/)). Dla tych przepisów nie przyjmuj domyślnego pełnego dostępu.

| Przepis | Dokładne zakresy |
| --- | --- |
| Szkic, odczyt i publikacja produktu | `products:read`, `products:write` |
| Utworzenie i odczyt kuponu dla znanego ID produktu | `coupons:read`, `coupons:write` |
| Poniższy raport tygodniowy | `analytics:read` |

Agent widzi tylko operacje dozwolone przez zakresy klucza (zakres operacji to `x-required-scope` w opisie API). Dodaj `products:read` do klucza kuponowego tylko wtedy, gdy agent musi znaleźć produkt. Nie nadawaj `*`, zwrotów ani zapisu użytkowników i webhooków do tych przepisów. Zarządzanie kluczami i eksport CSV nigdy nie są dostępne przez MCP.

**Przechowuj klucze w prywatnej konfiguracji lokalnej, poza repozytorium.** Nie wklejaj klucza do promptu. Eksperymentuj na lokalnym Sellf: prefiks `sf_test_` nie tworzy osobnej bazy i nie wyłącza skutków zapisu. Po zakończeniu unieważnij klucz w Sellf.

W przykładach zastąp `https://sellf.example.com` adresem swojego Sellf, a `sf_live_REPLACE` kluczem z zakresami dla danego przepisu. Używaj HTTPS; lokalnie działa `http://127.0.0.1:3000/api/mcp`.

### Pełna albo skrócona lista narzędzi

`/api/mcp` pokazuje jedno narzędzie na każdą dozwoloną operację. Przy kluczu z pełnym zakresem to około 100 narzędzi i mniej więcej 190 KB definicji, co zajmuje dużo kontekstu modelu w czacie. **`/api/mcp?mode=compact`** wystawia tylko dwa narzędzia: `search_operations` (wyszukuje operacje po słowach i zwraca ich schematy wejścia) i `call_operation` (`{"operationId": "...", "params": {...}}`). Tryb skrócony wybierz dla szerokich kluczy i klientów czatowych; klucz z wąskim zakresem dobrze działa w trybie domyślnym.

## Claude Code

```sh
claude mcp add --transport http --scope local sellf https://sellf.example.com/api/mcp \
  --header "Authorization: Bearer sf_live_REPLACE"
```

`--scope local` trzyma wpis (i klucz) poza współdzielonym plikiem projektu. Otwórz `/mcp` w Claude Code i sprawdź, czy `sellf` jest połączony; zły klucz pokaże 401. Zobacz [konfigurację MCP w Claude Code](https://code.claude.com/docs/en/mcp).

## Claude Desktop

Plik konfiguracji Claude Desktop uruchamia lokalne procesy, więc do zdalnego endpointu łączy się przez [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) (wymaga Node.js). Otwórz **Settings → Developer → Edit Config** (`~/Library/Application Support/Claude/claude_desktop_config.json` w macOS, `%APPDATA%\Claude\claude_desktop_config.json` w Windows) i dołącz:

```json
{
  "mcpServers": {
    "sellf": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://sellf.example.com/api/mcp?mode=compact", "--header", "Authorization:${SELLF_AUTH}"],
      "env": { "SELLF_AUTH": "Bearer sf_live_REPLACE" }
    }
  }
}
```

Nagłówek celowo nie ma spacji po dwukropku, a jego wartość leży w `env`: niektóre klienty źle przekazują argumenty ze spacjami. Całkowicie zamknij i otwórz ponownie Claude Desktop, potem sprawdź narzędzia `sellf`.

Połączenie z Claude.ai albo ChatGPT w przeglądarce (własne konektory) wymaga logowania OAuth, którego Sellf jeszcze nie ma; jest w planach. Do tego czasu użyj jednego z klientów z tej strony.

## Codex

W prywatnym `~/.codex/config.toml`:

```toml
[mcp_servers.sellf]
url = "https://sellf.example.com/api/mcp"
bearer_token_env_var = "SELLF_API_KEY"
```

Ustaw `SELLF_API_KEY=sf_live_REPLACE` w środowisku, z którego startuje Codex, uruchom sesję ponownie i sprawdź `codex mcp list`. Zobacz [oficjalną dokumentację MCP w Codex](https://developers.openai.com/codex/mcp/).

## Cursor

W prywatnym `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sellf": {
      "url": "https://sellf.example.com/api/mcp",
      "headers": { "Authorization": "Bearer ${env:SELLF_API_KEY}" }
    }
  }
}
```

Uruchom ponownie Cursor i włącz `sellf` w ustawieniach MCP. Unikaj współdzielonego `.cursor/mcp.json` z kluczem. Zobacz [konfigurację MCP w Cursor](https://cursor.com/help/customization/mcp).

## Sprawdź połączenie

Poproś agenta o listę narzędzi Sellf, a potem odczyt dozwolony dla klucza: `list_products` z `{"limit":1}` dla produktów, `list_coupons` z `{"limit":1}` dla kuponów lub `get_top_products` z `{"period":"week","limit":1,"sort_by":"sales"}` dla raportów. W trybie skróconym agent najpierw wywołuje `search_operations` (np. `{"query":"list products"}`).

Odpowiedź 401 z `/api/mcp` oznacza brak klucza, zły albo unieważniony klucz (sesja zalogowanego panelu nie jest akceptowana). Wynik narzędzia oznaczony jako błąd zawiera odpowiedź samego API, np. 403, gdy klucz nie ma zakresu albo jego właściciel nie jest już administratorem. Po zmianie klucza uruchom ponownie połączenie MCP.

## Przepis 1: Szkic produktu z tekstu oferty

Użyj klucza produktowego. Wstaw unikalny slug i własny tekst oferty:

```text
Użyj MCP Sellf. Przygotuj szkic oferty: Zeszyt automatyzacji, 49,99 PLN,
praktyczny zeszyt z trzema ćwiczeniami. Użyj sluga zeszyt-automatyzacji.
Utwórz produkt jednorazowy z opisem, pełnym opisem i sekcjami cech.
Pozostaw go nieaktywnym i niewidocznym na liście. Zwróć ID, adres podglądu
administratora i strony płatności. Nie publikuj.
```

Oczekiwane wywołania (API również domyślnie ustawia `is_active` na false):

```json
{"name":"create_product","arguments":{"body":{"name":"Zeszyt automatyzacji","slug":"zeszyt-automatyzacji","price":49.99,"currency":"PLN","description":"Praktyczny zeszyt z trzema ćwiczeniami.","long_description":"Przećwicz automatyzację w trzech ćwiczeniach z instrukcjami.","features":[{"title":"W zestawie","items":["Zeszyt","Trzy ćwiczenia"]}],"product_type":"one_time","is_listed":false}}}
{"name":"get_product","arguments":{"id":"PRODUCT_UUID"}}
```

Sprawdź zapisaną cenę, walutę i cechy. Ceny produktów są w **głównych jednostkach waluty**: `49.99`, nie `4999`. Podgląd po zalogowaniu jako administrator: `https://sellf.example.com/p/zeszyt-automatyzacji?preview=1`. Strona płatności: `https://sellf.example.com/checkout/zeszyt-automatyzacji`; jest dostępna po publikacji. Publiczny checkout szkicu zwraca 404. Przed sprzedażą skonfiguruj Stripe i dostarczanie faktycznej treści; szkic oferty nie przesyła zeszytu ani nie obciąża kupującego.

Gdy produkt jest gotowy, poproś wprost: `Opublikuj tylko produkt PRODUCT_UUID. Pozostaw go niewidocznym na liście.` Agent wywoła `update_product` z `{"id":"PRODUCT_UUID","body":{"is_active":true}}`. Produkt niewidoczny na liście nadal można kupić przez bezpośredni link. Aby osadzić płatność na własnej stronie, włącz osadzanie w Sellf i skopiuj wygenerowany snippet loadera; MCP nie wdraża Twojej strony.

## Przepis 2: Utwórz kupon

Użyj klucza kuponowego i znanego UUID produktu. Wybierz unikalny kod:

```text
Użyj MCP Sellf. Utwórz aktywny kupon ZESZYT20: 20% rabatu tylko na produkt
PRODUCT_UUID, łącznie 10 użyć, raz na adres email, bez order bumpów.
Odczytaj go ponownie i pokaż ograniczenia. Nie zmieniaj produktu.
```

```json
{"name":"create_coupon","arguments":{"body":{"code":"ZESZYT20","discount_type":"percentage","discount_value":20,"is_active":true,"allowed_product_ids":["PRODUCT_UUID"],"usage_limit_global":10,"usage_limit_per_user":1,"exclude_order_bumps":true}}}
{"name":"get_coupon","arguments":{"id":"COUPON_UUID"}}
```

Sprawdź kod, ograniczenie do produktu i limity. Pusta lista produktów rozszerza zastosowanie kuponu, więc zachowaj UUID. `20` oznacza 20%; dla rabatu kwotowego podaj główne jednostki i walutę. Przepis tworzy aktywny kupon, ale go nie wykorzystuje. Aby go wyłączyć, wywołaj `update_coupon` z `{"id":"COUPON_UUID","body":{"is_active":false}}`, a nieużywany kupon testowy usuń przez `delete_coupon`.

## Przepis 3: Tygodniowy raport sprzedaży

Użyj osobnego klucza **wyłącznie z `analytics:read`**:

```text
Użyj MCP Sellf z samym analytics:read. Przygotuj raport sprzedaży za ostatnie
siedem dni przez get_top_products(period="week", limit=50, sort_by="sales").
Podaj zwróconą datę początku i czas wygenerowania danych. Pokaż zakończone
sprzedaże i przychód osobno dla każdego produktu i waluty. Przelicz jednostki
drobne według liczby miejsc dziesiętnych danej waluty. Nie sumuj różnych walut.
Wyjaśnij, że raport obejmuje najwyżej 50 zwróconych produktów; gdy osiągnie
limit, zaznacz możliwą niekompletność. Nie prognozuj ani nie przedstawiaj
porównania z poprzednim tygodniem. Niczego nie zmieniaj.
```

```json
{"name":"get_top_products","arguments":{"period":"week","limit":50,"sort_by":"sales"}}
```

Korzystaj z `filters.start_date`, `generated_at` i `by_currency` każdego produktu. Dla PLN/USD `4999` drobnych jednostek to `49,99`. Obecna cena produktu jest w głównych jednostkach i może różnić się od historycznych cen sprzedaży. To ostatnie siedem dni w strefie czasowej serwera API, a nie poprzedni tydzień kalendarzowy. Raport liczy zakończone transakcje; nie mierzy zysku ani sprzedaży netto po zwrotach. Sumy obejmują wyłącznie zwrócone produkty; sumy różnych walut nie wolno podpisywać jedną walutą.

## Przepis 3b: Skąd przyszły zakupy?

Ten sam klucz **tylko `analytics:read`**:

```text
Użyj Sellf MCP. Skąd pochodzą zakupy z ostatnich 3 dni? Pokaż tabelę:
kanał / source / medium / campaign / content / liczba / kwota netto.
Kwoty są w jednostkach głównych, osobno dla każdej waluty; nie sumuj walut.
```

```json
{"name":"get_purchase_attribution","arguments":{}}
```

Bez argumentów: ostatnie 3 dni, ostatni kontakt. `touch: "first"` pokazuje pierwszą znaną wizytę,
`group_by` zmienia wymiary. Kwota netto uwzględnia zwroty. Szczegóły:
[Źródła zakupów](/pl/purchase-attribution/).

## Przepis 4: Koszyk B2B

Użyj klucza z `products:read`, `products:write`, `coupons:read`, `coupons:write`.
Przykład dla warsztatu WiR: poproś agenta o `create_product` ze szkicem (`is_active: false`),
ceną 67 PLN, `issue_license_on_purchase: false` i takim `checkout_profile`:

```json
{
  "v": 1,
  "modules": [
    {
      "id": "buyer",
      "types": [
        "organization"
      ],
      "bank_transfer_for": [
        "organization"
      ]
    },
    {
      "id": "recipient",
      "for": [
        "organization"
      ]
    },
    {
      "id": "phone",
      "required": true
    },
    {
      "id": "quantity",
      "min": 1,
      "max": 50,
      "mode": "product_page"
    },
    {
      "id": "participants",
      "required": true,
      "prefill_from_buyer": true
    }
  ]
}
```

Następnie `create_coupon` z `{"body":{"code":"WIR30","discount_type":"set_price","discount_value":30,"currency":"PLN","allowed_product_ids":["UUID_ZWROCONEGO_PRODUKTU"]}}`.
Agent odczytuje oba rekordy i pokazuje je do sprawdzenia przed aktywacją produktu.
Nabywca jest organizacją; odbiorca może być inny, telefon jest wymagany, a liczba
uczestników odpowiada ilości (ustaw `allow_later: true` w module `participants`, aby kupujący mógł zapłacić najpierw i uzupełnić uczestników później; przypomnienie e-mail nie jest wysyłane). Przelew wymaga włączenia i konfiguracji konta sklepu
w ustawieniach płatności. Przepis nie zmienia tych ustawień i nie składa zamówienia.
Po publikacji udostępnij `/pl/checkout/SLUG?coupon=WIR30`. Kupon daje 30 zł za sztukę
zarówno w progu 47, jak i 67 zł; bumpy zachowują cenę. Progi i terminy wydarzenia
agent dodaje przez pola `sessions` i `tiers` produktu. Usuń nieużywany kupon i szkic po próbie.

## Weryfikacja i sprzątanie

Endpoint sprawdza `admin-panel/tests/api/mcp.test.ts`: oficjalny klient SDK MCP łączy się z działającym lokalnym Sellf kluczem ograniczonym do `products:read` (inicjalizacja, lista narzędzi ograniczona do tego zakresu, prawdziwe wywołanie `get_product`, zapis spoza zakresu odrzucony bez zmiany produktu, wyszukiwanie i wywołanie w trybie skróconym) oraz sprawdza, że brak klucza i sama sesja panelu dostają 401. Argumenty w przepisach odpowiadają generowanym schematom narzędzi; samych przepisów nie uruchamiamy automatycznie end-to-end i nic tu nie uruchamia modelu AI ani płatności Stripe.

Przy ręcznej próbie usuń nieużywany kupon i produkt według zwróconych ID; nie usuwaj prawdziwej historii płatności w ramach sprzątania przepisu.
