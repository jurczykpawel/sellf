---
title: "REST API v1"
description: "Jednostki kwot i zgodność danych wejściowych API Sellf v1."
---

API administracyjne Sellf jest dostępne pod adresem `https://twoja-domena.pl/api/v1`. Wysyłaj klucz API w nagłówku `Authorization: Bearer sf_live_...` lub `X-API-Key`. [Pełna lista endpointów, uprawnień i przykładów (EN)](/api/).

## Opis API dla agentów

Każda instancja publikuje maszynowy opis tego API:

```
GET https://twoja-domena.pl/api/v1/openapi.json
```

To OpenAPI 3.1: publiczny (bez klucza), bez danych i sekretów, buforowany przez pięć minut (obsługuje `ETag`). Wskaż go agentowi albo generatorowi klienta zamiast przepisywać listę endpointów:

- każda operacja ma stały `operationId` (np. `create_product`, `update_offer_draft`, `publish_template`) i należy do grupy (`tags`) z krótkim opisem;
- `x-required-scope` podaje uprawnienie klucza API potrzebne do operacji; wywołania z nagłówkiem `Authorization: Bearer sf_live_...`;
- treść żądań i odpowiedzi dla produktów, ofert produktów i szablonów sklepu to pełne schematy JSON generowane z tych samych walidatorów, których używa serwer; pozostałe grupy opisują parametry, a treść żądania tam, gdzie istnieje walidator;
- `x-mcp: { exclude: true }` oznacza operacje, których agent nie powinien wywoływać (zarządzanie kluczami, eksport CSV, sam opis).

Wbudowany endpoint MCP `/api/mcp` powstaje z tego opisu: jedno narzędzie na każdą operację dozwoloną dla klucza albo `?mode=compact` z wyszukiwaniem i wywołaniem. Zobacz [Podłącz swojego agenta AI](/pl/connect-ai-agent/).

Opis powstaje z jednego rejestru w kodzie. Test w CI nie przepuści trasy bez wpisu w rejestrze ani różnicy między opisanym uprawnieniem lub parametrami zapytania a tym, co trasa faktycznie sprawdza, więc plik zgadza się z wersją, którą masz zainstalowaną. Część o API w `/llms.txt` (na Twojej instancji i na docs.sellf.app) powstaje z tego samego rejestru: instrukcja dla agenta, opisy grup i po jednej linii na operację (metoda, ścieżka, `operationId`, uprawnienie, krótki opis).

## Przerwa w działaniu

`GET /system/maintenance` (`system:read`) zwraca stan przerwy, jej źródło (`file`, `env`, `database`)
i ścieżkę pliku na serwerze. `PATCH /system/maintenance` (`system:write`) z
`{ "enabled": true, "message"?, "expected_end_at"? }` włącza przełącznik w bazie, a `{ "enabled": false }`
go wyłącza. W czasie przerwy trasy koszyka odpowiadają `503` z `code: "MAINTENANCE"` i `Retry-After`;
API v1 i webhooki Stripe działają dalej. Szczegóły: [Przerwa w działaniu](/pl/maintenance/).

## Ustawienia koszyka

`GET /settings/checkout` (`system:read`) zwraca `{ "invoice_recipient_enabled": false }`.
`PATCH /settings/checkout` (`system:write`) przyjmuje dokładnie `{ "invoice_recipient_enabled": true }`
(inne pola → `400`). Ustawienie (domyślnie wyłączone) pozwala w zwykłym koszyku podać osobnego
odbiorcę faktury — placówkę, zawsze z polskim NIP. Odbiorca trafia do zamówienia i do webhooka
`purchase.completed` jako `invoice.recipient`. Subskrypcje nie przyjmują osobnego odbiorcy. Każda
zmiana trafia do dziennika audytu z identyfikatorem administratora (dla klucza API: jego właściciela).
Ustawienie i wpis audytu zapisują się w jednej transakcji bazy: jeśli wpisu nie da się zapisać, nic się
nie zmienia, ustawienie zachowuje poprzednią wartość, a API zwraca `500`. Wywołanie nie zmienia
pozostałych ustawień koszyka ani sklepu.

## Jednostki kwot w v1

Jednostki pozostają częścią kontraktu v1 i nie są automatycznie przeliczane. **Jednostki główne**: `49.99` oznacza 49,99 PLN/USD. **Jednostki najmniejsze**: `4999` oznacza 49,99 PLN/USD. Uwzględniaj liczbę miejsc dziesiętnych danej waluty (np. JPY nie ma części dziesiętnej). Średnie mogą zawierać ułamki jednostki najmniejszej.

Ścieżki poniżej są względne wobec `/api/v1`. Jednostki dotyczą zarówno danych wejściowych, jak i odpowiedzi, jeśli dane pole występuje.

| Endpoint | Pola | Jednostka |
|---|---|---|
| `GET/POST /products`, `GET/PATCH /products/{id}` | `price`, `sale_price`, `recurring_price`, `custom_price_min`, każda wartość `custom_price_presets` | Główna |
| `GET/POST /order-bumps`, `GET/PATCH /order-bumps/{id}` | `bump_price`, zagnieżdżone ceny produktów | Główna |
| `GET/PUT /products/{id}/oto` | `discount_value`, `downsell_discount_value` | Główna dla odpowiedniego typu rabatu `fixed`; punkty procentowe dla `percentage` (`25` = 25%) |
| `GET/PUT /products/{id}/cocreator` | `rule.fixed_minor` / `cocreator.fixed_minor` (tekst dziesiętny); `percentage_bps` | Najmniejsza; `percentage_bps` w punktach bazowych (`1000` = 10%) |
| `GET/POST /coupons`, `GET/PATCH /coupons/{id}` | `discount_value` | Główna dla `fixed`; punkty procentowe dla `percentage` |
| `GET /coupons/{id}/stats` | `summary.total_discount_amount`, `discount_amount` realizacji kuponu, `daily_usage[].amount`, `usage_by_product[].amount` | Główna |
| `GET /payments`, `GET /payments/{id}`, `PATCH /payments/{id}` | `amount`, `refunded_amount`, `refund.amount`, `net_total`, `tax_total`, jeśli zwracane | Najmniejsza |
| `GET /payments` | `line_items[].unit_price`, `line_items[].total_price` | Główna |
| `GET /payments` | `line_items[].net_amount`, `line_items[].tax_amount` | Najmniejsza |
| `GET /payments/{id}` | `product.price` | Główna |
| `POST /payments/export` | Kwota, kwota zwrotu, suma netto i VAT w CSV | Główna (od 2026.10.7; nagłówki kończą się na `(major units)`, kropka jako separator dziesiętny; waluty bez części dziesiętnej, np. JPY, w całych jednostkach). Przed 2026.10.7 CSV używał jednostek najmniejszych |
| `POST /payments/{id}/refund` | `amount` żądania, `amount` i `refunded_amount` odpowiedzi, jeśli zwracane | Najmniejsza; kwota żądania musi być całkowita |
| `GET /payments/stats` | Kwoty przychodów i zwrotów, średnie i kwoty w podziale na waluty | Najmniejsza |
| `POST /payments/{id}/mark-paid` | `amount` żądania | Najmniejsza |
| `GET /payments/{id}/late-transfer-preview` | `amount` | Najmniejsza; `unitPrice` i `unitPriceToday` w głównej |
| `GET /analytics/dashboard` | Kwoty `revenue.*`, `refunds.total_refunded`, `recent_activity[].revenue` | Najmniejsza |
| `GET /analytics/revenue` | Kwoty podsumowania, w tym `average_order_value`, przychody okresów i porównania oraz kwoty w podziale na waluty | Najmniejsza |
| `GET /analytics/top-products` | `revenue`, `average_price`, przychód podsumowania i przychody według walut | Najmniejsza |
| `GET /analytics/top-products` | `current_price` | Główna |
| `GET /refund-requests`, `GET/PATCH /refund-requests/{id}` | `requested_amount`, zagnieżdżone `amount` transakcji, kwoty zwrotów, jeśli zwracane | Najmniejsza |
| `GET /users`, `GET /users/{id}`, endpointy dostępu | Zagnieżdżone ceny produktów | Główna |

Pola przychodu w statystykach płatności i analityce oznaczają **kwoty brutto po odjęciu zwrotów** dla zamówień zakończonych i częściowo zwróconych. `net_revenue` również zawiera kwotę po zwrotach. Sumy zwrotów są podawane osobno, więc nie odejmuj ich ponownie od przychodu. Granice okresów są liczone w UTC. CSV zachowuje osobno pierwotną kwotę i kwotę zwrotu: odejmij zwrot, aby porównać przychód po zwrotach.

Liczniki, okresy, stawki VAT, rabaty procentowe i zmiany procentowe nie są kwotami. Sumy wielu walut nie wykonują przewalutowania — korzystaj z podziału na waluty, jeśli jest dostępny. Przed użyciem ceny produktu jako kwoty płatności jawnie przelicz jednostki.

Przykład: produkt o `price: 29` w PLN kosztuje 29 zł; płatność za niego ma `amount: 2900`.

## Zgodność danych wejściowych produktu

`POST /products` i `PATCH /products/{id}` ignorują nieznane pola najwyższego poziomu, również pola tylko do odczytu skopiowane z odpowiedzi. Nie zapisują ich. Błędne wartości rozpoznanych pól zwracają HTTP **400** (`VALIDATION_ERROR`).

Poniższe starsze pola są rozpoznawane i walidowane, ale **ignorowane**, ponieważ nie mają kolumn w tabeli produktów:

| Pole | Akceptowana starsza wartość | Zapisywana alternatywa |
|---|---|---|
| `custom_price_label` | Tekst do 80 znaków | Brak |
| `tip_icon` | Tekst do 8 znaków | `icon` jako ikona produktu |
| `suggested_amounts` | Do 20 nieujemnych liczb | `custom_price_presets` (jednostki główne) |
| `min_amount` | Nieujemna liczba lub null | `custom_price_min` (jednostki główne; nieujemna liczba) |
| `metadata` | Obiekt | Brak; metadane płatności mają osobny kontrakt |

To nie są aliasy: v1 nie mapuje ich na alternatywne pola, nie zapisuje ich ani nie zwraca. Narzędzia MCP powstają z tego samego walidatora, więc ich schemat też zawiera te dawne pola; są przyjmowane i pomijane tak samo. Zachowujemy zgodność z klientami v1 bez przekazywania nieobsługiwanych kolumn do bazy.

`categories`, `tags` i `bundleItemIds` są obsługiwanymi polami relacji, zapisywanymi osobno od wiersza produktu. Nie są polami nieznanymi. Pozostałe endpointy mają własne reguły walidacji.

## Usuwanie produktów i archiwum

W panelu otwórz **Produkty**, a potem wybierz filtr **Archiwum**, aby zobaczyć zakończone oferty. Usunięcie produktu z historią przenosi go do archiwum. Przywrócenie pozostawia go nieaktywnym; sprawdź ustawienia i włącz sprzedaż osobno. Kupujący zachowują nadany dostęp.

Zamówienia, faktury i licencje nigdy nie są usuwane razem z produktem.

- `DELETE /products/{id}` produktu **bez** zamówień, licencji, dostępów kupujących i subskrypcji usuwa go: **204**.
- To samo wywołanie dla produktu **z** taką historią przenosi go do **archiwum**: **200** z
  `{ "data": { "id": "…", "status": "archived", "impact": { "orders": 3, "invoices": 1, "licenses": 2, "accesses": 3, "subscriptions": 0, "hasHistory": true } } }`.
  Produkt w archiwum ma ustawione `archived_at` i `is_active: false`: nie jest już sprzedawany, znika ze sklepu, publicznych
  endpointów, list i wyboru produktów (także przy włączonej liście oczekujących), a wszystkie rekordy zostają. Kupujący
  z dostępem nadal widzą treść i produkt w „Moich produktach”. Ponowne wywołanie zwraca to samo 200.
- `GET /products?status=archived` zwraca produkty z archiwum. Pozostałe wartości `status` (`all`, `active`, `inactive`) ich nie zawierają.
- `POST /products/{id}/restore` przywraca produkt na listę jako nieaktywny; włączysz go przez `PATCH {"is_active": true}`.
  Włączenie produktu w archiwum zwraca **409**.
- `DELETE /products/{id}?permanent=true` usuwa produkt z archiwum trwale: **204**. Zamówienia, faktury, licencje, zakończone
  subskrypcje i rezerwacje minionych terminów zostają z `product_id: null` i nazwą produktu z chwili zakupu (`product_name`);
  kupujący tracą dostęp; reguły prowizji partnerów i miejsce produktu w pakietach są usuwane.
  Produkt z historią, który nie jest w archiwum, zwraca **409** (najpierw archiwizacja). **409** i pozostanie w archiwum
  dostaje też produkt z **aktywną subskrypcją** (status Stripe `trialing`, `active`, `past_due` lub `incomplete`),
  **rezerwacją na nadchodzący termin** (potwierdzoną lub jeszcze trzymaną, termin się nie skończył) albo naliczonymi prowizjami partnerów.
- `GET /products/{id}/deletion-impact` zwraca obiekt `impact` bez żadnej zmiany, z polami `activeSubscriptions`,
  `futureReservations`, `affiliateRules`, `affiliateCommissions` i `bundles`.
- Licencje (`GET /licenses`, `/licenses/{id}`) i płatności trwale usuniętego produktu zwracają `product.name` z chwili zakupu.

Webhooki: archiwizacja i przywrócenie wysyłają `product.updated` (`changedFields` zawiera `archivedAt`; archiwizacja aktywnego
produktu wysyła też `product.unpublished`). Trwałe usunięcie wysyła dokładnie jedno `product.deleted`.

## Udział współtwórcy

Współtwórca to jedna osoba, która dostaje stały udział w każdej sprzedaży produktu **jednorazowego**, z kuponem
lub bez (np. autor dzielący przychód ze sklepem). Udział **dolicza się** do prowizji partnera z tego samego zakupu,
także gdy partner i współtwórca to ta sama osoba (20% + 10% = 30%).

| Metoda | Ścieżka | Zakres | Co robi |
|---|---|---|---|
| GET | `/products/{id}/cocreator` | `products:read` | Odczyt współtwórcy i jego udziału |
| PUT | `/products/{id}/cocreator` | `products:write` | Przypisanie współtwórcy albo zmiana udziału |
| DELETE | `/products/{id}/cocreator` | `products:write` | Usunięcie współtwórcy dla przyszłych zakupów |

```http
PUT /api/v1/products/{id}/cocreator
{ "email": "autor@example.com", "rule": { "percentage_bps": 1000 }, "expected_revision": 0 }
```

- `rule` to `{ "percentage_bps": 1..10000 }` (procent kwoty netto pozycji) albo
  `{ "fixed_minor": "1500", "currency": "PLN" }` (jednostki najmniejsze, najwyżej kwota netto pozycji).
- Osoba musi mieć konto: raz loguje się tym adresem. Nieznany e-mail: **404**. Subskrypcja albo brak ustawień
  programu partnerskiego (okres wstrzymania, progi wypłat): **400**. Nieaktualne `expected_revision`: **409**
  (pominięcie nadpisuje).
- Nowy udział dostają tylko zakupy rozpoczęte po zmianie; wcześniejsze zachowują to, co miały. `DELETE` wyłącza
  udział dla przyszłych zakupów (**204**); naliczone udziały zostają i podlegają zwrotom i sporom.
- `GET` zwraca `revision`, `program_configured` i `cocreator` (`display_name`, `email`, udział, `since`,
  `terms_accepted`). Udziały współtwórcy wypłacamy dopiero po akceptacji **regulaminu twórcy**
  (Panel → Program partnerski → Regulamin twórcy; osoba akceptuje go na stronie swoich prowizji).
- Webhooki `commission.accrued` / `commission.reversed` mają `commission.kind` (`referral` albo `cocreator`).

## Kupony „ustal cenę”

`discount_type` obsługuje `percentage`, `fixed` i `set_price` („ustal cenę”).
Dla `set_price`, `discount_value` to końcowa cena za sztukę produktu głównego
w `currency` (wymagana, zgodna z produktem). Przykład: `30` PLN daje 30 zł zarówno
w progu wydarzenia 47, jak i 67 zł. Ilość mnoży tę cenę, a bumpy zachowują cenę,
niezależnie od `exclude_order_bumps`. Wyższa cena ustalona nigdy nie podnosi bieżącej.
Cena zero korzysta z istniejącej ścieżki darmowego dostępu; embed odsyła wtedy do
standardowego checkout. JPY wymaga liczb całkowitych. Kupony nie zmieniają historii
najniższej ceny Omnibus. Typ dostępny dla wszystkich sprzedawców.

## Przelewy tradycyjne

Z uprawnieniem `payments:write`: `POST /payments/{id}/mark-paid` (zaksięgowanie przelewu: `amount`, `paidAt`), `POST /payments/{id}/cancel` (`reason`) i `POST /payments/{id}/invoice-issued`. Przelew, który doszedł po anulowaniu, przyjmujesz przez `mark-paid` z `acceptCancelled: true` i `reason`. Najpierw sprawdź `GET /payments/{id}/late-transfer-preview` (`payments:read`): gdy `seats.oversold` jest prawdą, przyjęcie przekroczy limit miejsc w terminie albo w progu cenowym i wymaga `acceptOversold: true`. Bez tego odpowiedź to **409** `CONFLICT` z `error.details.code: ["oversold_confirmation_required"]` (inne odmowy, np. zła kwota, zostają 400 `VALIDATION_ERROR`). Szczegóły: [Przelewy tradycyjne](/pl/bank-transfers/).

## Licencje (Pro)

Klucz API z uprawnieniem `licenses:write` wydaje licencję przez `POST /api/v1/licenses`
(`{ productId, email, domain?, customFieldValues?, sendEmail? = true, locale? }`) i odwołuje ją
przez `DELETE /api/v1/licenses/{id}`. `domain` działa tylko wtedy, gdy produkt ma pole
**Domena licencji**; bez tego pola Sellf je pomija i licencja nie ma domeny. `licenses:read` daje listę `GET /api/v1/licenses`
(filtry `product_id`, `email`, `status`, `source`, bez tokenów) i pojedynczą licencję z tokenem
`GET /api/v1/licenses/{id}`. Wydanie wysyła `license.issued` i, o ile nie podasz `sendEmail: false`,
mail do kupującego z kluczem i linkiem do produktu.
Odpowiedź zawiera `emailSent` i `emailPending`. `emailPending: true` oznacza, że licencja jest
wydana, a dostawca poczty chwilowo odmówił wysyłki (np. limit Supabase Auth na odbiorcę). Sellf
ponowi ją automatycznie, więc nie wydawaj licencji drugi raz.

Skrypt `admin-panel/scripts/issue-license.ts` wydaje licencję przez to API (`SELLF_URL`,
`SELLF_API_KEY`). Tryb `--offline` podpisuje lokalnie kluczem prywatnym sprzedawcy w tym samym
formacie, ale takiej licencji nie ma w Sellfie: nie da się jej odwołać, nie idzie webhook ani mail.
Licencje samego Sellfa wydaje w ten sam sposób instancja TSA, osobny generator nie istnieje.


## Zgłoszenia PlayerStack

[Formularze potwierdzane mailem i zgoda marketingowa](/pl/playerstack-leads/).

## Licencja przy nadaniu dostępu

`POST /users/{id}/access` przyjmuje `issue_license` (domyślnie `true`) oraz opcjonalne `license: { domain, customFieldValues, locale }`. Produkt z włączonym wystawianiem licencji używa własnego poziomu i czasu ważności. Klucz trafia mailem do klienta; odpowiedź zawiera `license: { id, status, email_sent, email_pending }`. `email_pending: true` oznacza, że dostęp i klucz są zapisane, a dostawca poczty chwilowo odmówił wysyłki (np. limit Supabase Auth na odbiorcę); Sellf ponowi ją automatycznie. `false` nadaje sam dostęp. Pakiet wydaje własną licencję, bez kaskady na składniki.

Wydanie i cofnięcie klucza wymaga dodatkowo `licenses:write`. Bez tego zakresu zmienia się sam dostęp, a `license_warning` wyjaśnia pominięcie licencji. Błąd wystawienia albo mail, którego nie udało się ani wysłać, ani odłożyć do ponowienia, zwraca `LICENSE_ISSUANCE_FAILED` wraz z zapisanym dostępem. Ponowienie POST kontynuuje to samo nadanie i klucz.

`DELETE /users/{id}/access?product_id={uuid}` i `DELETE /users/{id}/access/{accessId}` przyjmują `revoke_license=true|false` (domyślnie `true`). Cofają tylko licencję z tego nadania; klucze z zakupu zostają. `false` świadomie zachowuje klucz. Zwykłe powodzenie to 204; brak zakresu licencji zwraca 200 z `license_warning`.
