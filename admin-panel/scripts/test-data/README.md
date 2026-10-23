# Powtarzalne dane TEST

Skrypt Bun tworzy lub aktualizuje 11 ukrytych produktów po `slug`, trzy kupony po
`code` i bump Nagranie po parze produktów. Nie usuwa wpisów, nie zmienia liczników
użyć kuponów. Zarządza tylko polami zapisanymi w JSON oraz wspólnymi domyślnymi:
PLN, aktywny, ukryty, jednorazowy (o ile wpis nie nadpisuje wartości).
Zmienione pola tych wpisów zostaną przywrócone przy kolejnym uruchomieniu.

Z katalogu `admin-panel`, ustaw `SELLF_URL` (adres główny własnego TEST) i
`SELLF_API_KEY` (np. przez bezpieczne wczytanie z otoczenia). Klucz potrzebuje
`products:read`, `products:write`, `coupons:read`, `coupons:write`.

```sh
bun scripts/test-data/seed-test-env.ts --dry-run --i-know-this-is-test
bun scripts/test-data/seed-test-env.ts --i-know-this-is-test
```

API v1 nie ujawnia trybu klucza Stripe, dlatego **samodzielnie sprawdź tryb TEST**
przed użyciem flagi. Dwie znane domeny produkcji/demo i ich subdomeny są blokowane:
`sellf.techskills.academy`, `demo.sellf.app`. To nie jest pełny katalog instancji.
Skrypt używa wyłącznie API v1, nie potrzebuje bazy ani klucza service role.
`--dry-run` wykonuje odczyty i pokazuje plan bez zapisu, także dla nowego bumpa.
Na końcu drukuje szczegóły i tabelę utworzone/zaktualizowane/bez zmian.
Przy błędzie kończy się kodem 1; wcześniejsze zapisy pozostają, można ponowić.
Nie uruchamiaj równolegle dwóch kopii skryptu.

Konta, zakupy, subskrypcje Stripe oraz ustawienia programu partnerskiego
(prowizja 20%, przypisanie RCANNA5 do anna-test) zostają ręczne.
GUS jest wyłączony; wszystkie pięć modułów koszyka warsztatu jest włączone.
Ceny nowych produktów: warsztat 100 PLN netto, nagranie 19 PLN brutto.
Filmy to publiczne przykłady; plik darmowego produktu jest atrapą.
Webinar testowy ma `event_mode: true` i pełną listę `sessions` z `tiers`:
10 grudnia 2026, 17:00–19:00 UTC (Europe/Warsaw), 47 PLN za pierwsze 3 miejsca,
potem 67 PLN; VAT 23% brutto. Porównanie pomija ID i pola spoza JSON,
a aktualizacja zachowuje ID terminów/progów dopasowane po `sort`.
Kupon B2B30 ustawia cenę na 30 PLN (`set_price`), limit 100 użyć na osobę.
Moduł buyer warsztatu ma `bank_transfer_for: ["organization"]`.
Ustawienia przelewu (Ustawienia → Płatności) pozostają ręczne: API v1
nie udostępnia konfiguracji; `src/app/api/v1/payments/[id]/mark-paid/route.ts`
i sąsiedni `cancel/route.ts` obsługują tylko operacje na transakcjach.
Nie zmieniaj ręcznie historii użyć kuponów na potrzeby ponownego zasiewu.
