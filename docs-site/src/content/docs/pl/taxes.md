---
title: Podatki
description: Stałe stawki, Stripe Tax i sprzedaż B2B za granicę.
---

## Sprzedaż B2B za granicę

Sellf zapisuje kraj i NIP / numer VAT nabywcy w zamówieniu. Inny odbiorca nie
wyznacza podatku. Dane są dostępne w panelu płatności i webhookach zakupu.
Reguła zależy od kraju z adresu firmy: Polska wymaga poprawnego NIP (suma kontrolna);
pozostałe kraje UE wymagają numeru VAT w formacie danego kraju (prefiks kraju dodamy,
jeśli kupujący go pominie; Grecja: EL); poza UE przyjmujemy dowolny identyfikator bez
sprawdzania formatu (opcjonalny, do 40 znaków, bez `<` i `>`). Zamówienie, faktura,
`purchase.completed` (`invoice.taxIdType`, `invoice.taxIdCountry`) i API płatności
dostają typ (`pl_nip`, `eu_vat`, `other`) i kraj. Pobieranie danych z GUS tylko dla Polski.

**Opcjonalne sprawdzenie w VIES.** Ustaw `SELLF_VIES_CHECK_ENABLED=true`, a Sellf przy
składaniu zamówienia zapyta unijny VIES o numer VAT UE. Nigdy nie blokuje zamówienia:
po 3 sekundach albo przy awarii wynik to `unavailable`. Wynik trafia do `order_details`
jako `tax_id_vies` (`valid`, `invalid`, `unavailable`) przy nabywcy.

W trybie **Stripe Tax** Sellf przekazuje adres i numer VAT UE nabywcy do Customer
w Stripe. Stripe oblicza podatek i może zastosować odwrotne obciążenie dla
kwalifikujących się transakcji B2B z innym krajem UE. Krajowy numer VAT nie
uruchamia transgranicznego odwrotnego obciążenia. Stripe sprawdza numer w VIES,
ale sposób naliczenia podatku zależy od wymaganego formatu również przy trwającej
lub negatywnej weryfikacji urzędowej; sprzedawca odpowiada za sprawdzenie danych.
Zobacz [zasady Stripe dla UE](https://docs.stripe.com/tax/supported-countries/european-union)
i [weryfikację numerów](https://docs.stripe.com/billing/customer/tax-ids).

Włącz Stripe Tax, ustaw adres firmy i rejestracje podatkowe w Stripe, dobierz
kody podatkowe produktów i wybierz Stripe Tax w ustawieniach podatków Sellf.
Sprawdź zakup krajowy i zagraniczny B2B w trybie testowym.
W trybie **stałej stawki lokalnej** obowiązuje skonfigurowana stawka niezależnie
od zagranicznego numeru VAT. Nie ma automatycznego odwrotnego obciążenia ani VIES.

Gdy zapisany wynik Stripe zawiera `reverse_charge`, integracja Fakturowni wysyła
stawkę NP i oznaczenie odwrotnego obciążenia. Sam podatek równy zero nie włącza
tej adnotacji. Właściwy rodzaj sprzedaży NP potwierdź z księgowością w Fakturowni,
szczególnie przy KSeF; Sellf nie wyznacza go na podstawie kraju nabywcy.
Zobacz [API Fakturowni](https://github.com/fakturownia/API).
