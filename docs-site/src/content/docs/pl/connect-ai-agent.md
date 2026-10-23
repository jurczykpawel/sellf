---
title: Podłącz swojego agenta AI
description: Podłącz Claude Code, Claude Desktop, Codex lub Cursor do Sellf i wypróbuj trzy przetestowane przepisy MCP.
---

Serwer MCP Sellf pozwala Twojemu agentowi tworzyć szkice produktów i kupony oraz odczytywać raporty sprzedaży przez API Sellf. Serwer działa lokalnie na komputerze agenta przez **stdio**, a z Twoją instalacją Sellf łączy się przez HTTPS. Nie potrzebujesz hostowanego endpointu MCP.

## Przygotuj Sellf i serwer

1. Zainstaluj [Bun](https://bun.sh/) na komputerze agenta i pobierz [kod Sellf](https://github.com/jurczykpawel/sellf).
2. Zainstaluj zależności pakietu MCP:

   ```sh
   cd /absolute/path/to/sellf/mcp-server
   bun install
   command -v bun
   ```

3. W Sellf otwórz **Panel → Klucze API** (`/dashboard/api-keys`). Tworzenie klucza wymaga licencji registered lub wyższej. Utwórz osobny klucz dla każdego zastosowania, z uprawnieniami z tabeli, i skopiuj go przy wyświetleniu. Wybór zakresów w panelu wymaga Pro; zalogowany administrator może również utworzyć klucz z jawnymi zakresami przez `POST /api/v1/api-keys` (zobacz [opis API](/api/)). Dla tych przepisów nie przyjmuj domyślnego pełnego dostępu.

| Przepis | Dokładne zakresy |
| --- | --- |
| Szkic, odczyt i publikacja produktu | `products:read`, `products:write` |
| Utworzenie i odczyt kuponu dla znanego ID produktu | `coupons:read`, `coupons:write` |
| Poniższy raport tygodniowy | `analytics:read` |

Dodaj `products:read` do klucza kuponowego tylko wtedy, gdy agent musi znaleźć produkt. Poniższy raport nie wymaga dostępu do transakcji ani użytkowników. Narzędzia takie jak `get_revenue_stats` korzystają z API płatności i wymagają `payments:read`, mimo analitycznej nazwy. Nie nadawaj `*`, zwrotów ani zapisu użytkowników i webhooków do tych przepisów.

**Przechowuj klucze w prywatnej konfiguracji lokalnej, poza repozytorium.** Nie wklejaj klucza do promptu. Eksperymentuj na lokalnym Sellf: prefiks `sf_test_` nie tworzy osobnej bazy i nie wyłącza skutków zapisu. Po zakończeniu unieważnij klucz w Sellf.

W przykładach zastąp ścieżkę Bun wynikiem `command -v bun`, ścieżkę kodu swoją ścieżką bezwzględną, URL adresem Sellf (bez `/api/v1`), a klucz — kluczem z zakresami dla danego przepisu. Używaj HTTPS; lokalnie można użyć `http://127.0.0.1:3000`. W Windows podaj bezwzględne ścieżki Windows i podwójne ukośniki odwrotne w JSON.

## Claude Code

Uruchom w katalogu projektu; `--scope local` nie zapisuje konfiguracji we współdzielonym pliku MCP projektu:

```sh
claude mcp add --scope local \
  --env SELLF_API_URL=https://sellf.example.com \
  --env SELLF_API_KEY=REPLACE_WITH_SCOPED_KEY \
  --transport stdio sellf -- \
  /absolute/path/to/bun /absolute/path/to/sellf/mcp-server/src/index.ts
```

Otwórz `/mcp` w Claude Code i sprawdź połączenie `sellf`. Polecenie zawiera klucz, więc nie zapisuj go w historii powłoki. Zobacz [konfigurację MCP w Claude Code](https://code.claude.com/docs/en/mcp).

## Claude Desktop

Otwórz **Settings → Developer → Edit Config**. Plik to `~/Library/Application Support/Claude/claude_desktop_config.json` w macOS lub `%APPDATA%\Claude\claude_desktop_config.json` w Windows. Dodaj wpis do istniejącego obiektu `mcpServers`:

```json
{
  "mcpServers": {
    "sellf": {
      "command": "/absolute/path/to/bun",
      "args": ["/absolute/path/to/sellf/mcp-server/src/index.ts"],
      "env": {
        "SELLF_API_URL": "https://sellf.example.com",
        "SELLF_API_KEY": "REPLACE_WITH_SCOPED_KEY"
      }
    }
  }
}
```

Zamknij całkowicie Claude Desktop i uruchom ponownie. Sprawdź narzędzia `sellf`. Zobacz [instrukcję lokalnych serwerów MCP](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

## Codex

Dodaj do prywatnego `~/.codex/config.toml`:

```toml
[mcp_servers.sellf]
command = "/absolute/path/to/bun"
args = ["/absolute/path/to/sellf/mcp-server/src/index.ts"]

[mcp_servers.sellf.env]
SELLF_API_URL = "https://sellf.example.com"
SELLF_API_KEY = "REPLACE_WITH_SCOPED_KEY"
```

Uruchom ponownie sesję Codex i sprawdź `codex mcp list` lub `/mcp` w CLI. Zobacz [oficjalną dokumentację MCP w Codex](https://developers.openai.com/codex/mcp/).

## Cursor

Dodaj **ten sam JSON co dla Claude Desktop** do prywatnego `~/.cursor/mcp.json`. Uruchom ponownie Cursor i włącz `sellf` w ustawieniach MCP. Nie zapisuj klucza we współdzielonym `.cursor/mcp.json`. Zobacz [konfigurację MCP w Cursor](https://cursor.com/help/customization/mcp).

## Sprawdź połączenie

Poproś agenta o listę narzędzi Sellf, a potem odczyt dozwolony dla klucza: `list_products` z `{"limit":1}` dla produktów, `list_coupons` z `{"limit":1}` dla kuponów lub `get_top_products` z `{"period":"week","limit":1,"sort_by":"sales"}` dla raportów.

Jeśli proces nie startuje, sprawdź bezwzględne ścieżki Bun/kodu i uruchom `bun install` w `mcp-server`. Przy 401 sprawdź klucz i URL Sellf; przy 403 — zakresy i to, czy właściciel nadal jest administratorem. Widoczność narzędzia w kliencie nie daje uprawnień do jego użycia. Po zmianie klucza uruchom ponownie połączenie MCP. Uprawnienia egzekwuje API.

## Przepis 1: Szkic produktu z tekstu oferty

Użyj klucza produktowego. Wstaw unikalny slug i własny tekst oferty:

```text
Użyj MCP Sellf. Przygotuj szkic oferty: Zeszyt automatyzacji, 49,99 PLN,
praktyczny zeszyt z trzema ćwiczeniami. Użyj sluga zeszyt-automatyzacji.
Utwórz produkt jednorazowy z opisem, pełnym opisem i sekcjami cech.
Pozostaw go nieaktywnym i niewidocznym na liście. Zwróć ID, adres podglądu
administratora i strony płatności. Nie publikuj.
```

Oczekiwane wywołania (serwer również domyślnie ustawia `is_active` na false):

```json
{"name":"create_product","arguments":{"name":"Zeszyt automatyzacji","slug":"zeszyt-automatyzacji","price":49.99,"currency":"PLN","description":"Praktyczny zeszyt z trzema ćwiczeniami.","long_description":"Przećwicz automatyzację w trzech ćwiczeniach z instrukcjami.","features":[{"title":"W zestawie","items":["Zeszyt","Trzy ćwiczenia"]}],"product_type":"one_time","is_listed":false}}
{"name":"get_product","arguments":{"id":"PRODUCT_UUID"}}
```

Sprawdź zapisaną cenę, walutę i cechy. Ceny produktów są w **głównych jednostkach waluty**: `49.99`, nie `4999`. Podgląd po zalogowaniu jako administrator: `https://sellf.example.com/p/zeszyt-automatyzacji?preview=1`. Strona płatności: `https://sellf.example.com/checkout/zeszyt-automatyzacji`; jest dostępna po publikacji. Publiczny checkout szkicu zwraca 404. Przed sprzedażą skonfiguruj Stripe i dostarczanie faktycznej treści; szkic oferty nie przesyła zeszytu ani nie obciąża kupującego.

Gdy produkt jest gotowy, poproś wprost: `Opublikuj tylko produkt PRODUCT_UUID. Pozostaw go niewidocznym na liście.` Agent wywoła `update_product` z `{"id":"PRODUCT_UUID","is_active":true}`. Produkt niewidoczny na liście nadal można kupić przez bezpośredni link. Aby osadzić płatność na własnej stronie, włącz osadzanie w Sellf i skopiuj wygenerowany snippet loadera; MCP nie wdraża Twojej strony.

## Przepis 2: Utwórz kupon

Użyj klucza kuponowego i znanego UUID produktu. Wybierz unikalny kod:

```text
Użyj MCP Sellf. Utwórz aktywny kupon ZESZYT20: 20% rabatu tylko na produkt
PRODUCT_UUID, łącznie 10 użyć, raz na adres email, bez order bumpów.
Odczytaj go ponownie i pokaż ograniczenia. Nie zmieniaj produktu.
```

```json
{"name":"create_coupon","arguments":{"code":"ZESZYT20","discount_type":"percentage","discount_value":20,"is_active":true,"allowed_product_ids":["PRODUCT_UUID"],"usage_limit_global":10,"usage_limit_per_user":1,"exclude_order_bumps":true}}
{"name":"get_coupon","arguments":{"id":"COUPON_UUID"}}
```

Sprawdź kod, ograniczenie do produktu i limity. Pusta lista produktów rozszerza zastosowanie kuponu, więc zachowaj UUID. `20` oznacza 20%; dla rabatu kwotowego podaj główne jednostki i walutę. Przepis tworzy aktywny kupon, ale go nie wykorzystuje. Aby go wyłączyć, użyj `deactivate_coupon` z ID, a nieużywany kupon testowy usuń przez `delete_coupon`.

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
      "gus": false,
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

Następnie `create_coupon` z `{"code":"WIR30","discount_type":"set_price","discount_value":30,"currency":"PLN","allowed_product_ids":["UUID_ZWROCONEGO_PRODUKTU"]}`.
Agent odczytuje oba rekordy i pokazuje je do sprawdzenia przed aktywacją produktu.
Nabywca jest organizacją; odbiorca może być inny, telefon jest wymagany, a liczba
uczestników odpowiada ilości. Przelew wymaga włączenia i konfiguracji konta sklepu
w ustawieniach płatności. Przepis nie zmienia tych ustawień i nie składa zamówienia.
Po publikacji udostępnij `/pl/checkout/SLUG?coupon=WIR30`. Kupon daje 30 zł za sztukę
zarówno w progu 47, jak i 67 zł; bumpy zachowują cenę. Progi i terminy wydarzenia
agent dodaje przez pola `sessions` i `tiers` produktu. Usuń nieużywany kupon i szkic po próbie.

## Weryfikacja i sprzątanie

Przepisy sprawdza [`mcp-server/tests/recipes.e2e.ts`](https://github.com/jurczykpawel/sellf/blob/main/mcp-server/tests/recipes.e2e.ts): klient SDK uruchamia prawdziwy proces stdio przeciwko lokalnemu Sellf, używa oddzielnych kluczy z ograniczonymi zakresami, odczytuje utworzony produkt i kupon, sprawdza checkout po jawnej publikacji i raport tygodniowy na syntetycznych transakcjach zakończonych, oczekujących i starszych, w dwóch walutach. Test usuwa swoje dane i klucze. Nie uruchamia modelu AI ani nie wykonuje płatności Stripe.

Dla osób utrzymujących projekt: przy działającym lokalnym Sellf uruchom w `mcp-server`:

```sh
SELLF_RECIPE_E2E=1 SELLF_API_URL=http://127.0.0.1:3000 \
  bun --env-file=../admin-panel/.env.local run test
```

Test potrzebuje lokalnych danych service role Supabase do przygotowania i usunięcia danych; **nie wpisuj ich do konfiguracji MCP agenta**. `SELLF_BUN_PATH` pozwala wskazać bezwzględną ścieżkę Bun. Ustaw `SELLF_RECIPE_TRANSCRIPT` na prywatną ścieżkę pliku, aby zapisać dokładne prompty, argumenty narzędzi i wyniki. Reset bazy nie jest potrzebny. Przy ręcznej próbie usuń nieużywany kupon i produkt według zwróconych ID; nie usuwaj prawdziwej historii płatności w ramach sprzątania przepisu.
