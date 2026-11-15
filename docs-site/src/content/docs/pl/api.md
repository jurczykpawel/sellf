---
title: "REST API v1"
description: "Jednostki kwot i zgodność danych wejściowych API Sellf v1."
---

API administracyjne Sellf jest dostępne pod adresem `https://twoja-domena.pl/api/v1`. Wysyłaj klucz API w nagłówku `Authorization: Bearer sf_live_...` lub `X-API-Key`. [Pełna lista endpointów, uprawnień i przykładów (EN)](/api/).

## Jednostki kwot w v1

Jednostki pozostają częścią kontraktu v1 i nie są automatycznie przeliczane. **Jednostki główne**: `49.99` oznacza 49,99 PLN/USD. **Jednostki najmniejsze**: `4999` oznacza 49,99 PLN/USD. Uwzględniaj liczbę miejsc dziesiętnych danej waluty (np. JPY nie ma części dziesiętnej). Średnie mogą zawierać ułamki jednostki najmniejszej.

Ścieżki poniżej są względne wobec `/api/v1`. Jednostki dotyczą zarówno danych wejściowych, jak i odpowiedzi, jeśli dane pole występuje.

| Endpoint | Pola | Jednostka |
|---|---|---|
| `GET/POST /products`, `GET/PATCH /products/{id}` | `price`, `sale_price`, `recurring_price`, `custom_price_min`, każda wartość `custom_price_presets` | Główna |
| `GET/POST /order-bumps`, `GET/PATCH /order-bumps/{id}` | `bump_price`, zagnieżdżone ceny produktów | Główna |
| `GET/PUT /products/{id}/oto` | `discount_value`, `downsell_discount_value` | Główna dla odpowiedniego typu rabatu `fixed`; punkty procentowe dla `percentage` (`25` = 25%) |
| `GET/POST /coupons`, `GET/PATCH /coupons/{id}` | `discount_value` | Główna dla `fixed`; punkty procentowe dla `percentage` |
| `GET /coupons/{id}/stats` | `summary.total_discount_amount`, `discount_amount` realizacji kuponu, `daily_usage[].amount`, `usage_by_product[].amount` | Główna |
| `GET /payments`, `GET /payments/{id}`, `PATCH /payments/{id}` | `amount`, `refunded_amount`, `refund.amount`, `net_total`, `tax_total`, jeśli zwracane | Najmniejsza |
| `GET /payments` | `line_items[].unit_price`, `line_items[].total_price` | Główna |
| `GET /payments` | `line_items[].net_amount`, `line_items[].tax_amount` | Najmniejsza |
| `GET /payments/{id}` | `product.price` | Główna |
| `POST /payments/export` | Kwota, kwota zwrotu, suma netto i VAT w CSV | Główna (od 2026.10.7; nagłówki kończą się na `(major units)`, kropka jako separator dziesiętny; waluty bez części dziesiętnej, np. JPY, w całych jednostkach). Przed 2026.10.7 CSV używał jednostek najmniejszych |
| `POST /payments/{id}/refund` | `amount` żądania, `amount` i `refunded_amount` odpowiedzi, jeśli zwracane | Najmniejsza; kwota żądania musi być całkowita |
| `GET /payments/stats` | Kwoty przychodów i zwrotów, średnie i kwoty w podziale na waluty | Najmniejsza |
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

To nie są aliasy: v1 nie mapuje ich na alternatywne pola, nie zapisuje ich ani nie zwraca. Starsi klienci MCP mogą wysyłać `custom_price_label`; aktualny schemat narzędzi MCP pomija całą piątkę. Zachowujemy zgodność z klientami v1 bez przekazywania nieobsługiwanych kolumn do bazy.

`categories`, `tags` i `bundleItemIds` są obsługiwanymi polami relacji, zapisywanymi osobno od wiersza produktu. Nie są polami nieznanymi. Pozostałe endpointy mają własne reguły walidacji.

## Usuwanie produktów i archiwum

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

## Kupony „ustal cenę”

`discount_type` obsługuje `percentage`, `fixed` i `set_price` („ustal cenę”).
Dla `set_price`, `discount_value` to końcowa cena za sztukę produktu głównego
w `currency` (wymagana, zgodna z produktem). Przykład: `30` PLN daje 30 zł zarówno
w progu wydarzenia 47, jak i 67 zł. Ilość mnoży tę cenę, a bumpy zachowują cenę,
niezależnie od `exclude_order_bumps`. Wyższa cena ustalona nigdy nie podnosi bieżącej.
Cena zero korzysta z istniejącej ścieżki darmowego dostępu; embed odsyła wtedy do
standardowego checkout. JPY wymaga liczb całkowitych. Kupony nie zmieniają historii
najniższej ceny Omnibus. Typ dostępny dla wszystkich sprzedawców.

## Licencje (Pro)

Klucz API z uprawnieniem `licenses:write` wydaje licencję przez `POST /api/v1/licenses`
(`{ productId, email, domain?, customFieldValues?, sendEmail? = true, locale? }`) i odwołuje ją
przez `DELETE /api/v1/licenses/{id}`. `licenses:read` daje listę `GET /api/v1/licenses`
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
