---
title: Podatki
description: Stałe stawki, Stripe Tax i sprzedaż B2B za granicę.
---

## Sprzedaż B2B za granicę

Sellf zapisuje kraj i NIP / numer VAT nabywcy w zamówieniu. Inny odbiorca nie
wyznacza podatku. Dane są dostępne w panelu płatności i webhookach zakupu.
Profil wymaga poprawnego polskiego NIP dla Polski, a dla pozostałych krajów UE
numeru VAT z prefiksem zgodnym z krajem (Grecja: EL). Poza UE numer jest opcjonalny:
litery, cyfry i myślniki, maksymalnie 40 znaków. Sellf sprawdza format, bez VIES.

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
