---
title: Przelew tradycyjny
description: Konfiguracja terminu płatności, dostępu i faktur dla przelewów.
---

Włącz **Przelew tradycyjny** w **Ustawienia → Płatności**. Podaj odbiorcę i polski IBAN lub NRB (sprawdzamy sumę kontrolną), opcjonalnie bank oraz szablon tytułu z `{order_number}`. Podgląd pokazuje wynikowy tytuł. Ustaw termin 1–60 dni (domyślnie 14), dostęp od złożenia (domyślnie włączony) i limit nieopłaconych zamówień na e-mail (domyślnie 3).

W profilu checkoutu produktu włącz moduł nabywcy i wybierz typy uprawnione do przelewu: osobę, organizację lub oba. Bez profilu albo przy pustym wyborze przelew jest niedostępny. Subskrypcje, pakiety i produkty z własną ceną nie obsługują tego profilu. Zmiana typu nabywcy odświeża metody płatności.

Ustaw `ALTCHA_HMAC_KEY` na serwerze: przelewy zawsze wymagają ALTCHA, także w sklepach korzystających z innej captchy przy logowaniu.

Kupujący wybiera **Zapłać online** albo **Przelew tradycyjny**, akceptuje regulamin i rozwiązuje ALTCHA. Przelew nie korzysta ze Stripe. Przycisk **Zamawiam z obowiązkiem zapłaty** otwiera podpisany link do instrukcji zamówienia, ważny 61 dni: rachunek, kwota, tytuł, termin i **Drukuj / zapisz PDF**. Zachowaj prywatny link — nie wymaga logowania.

Jeśli wybrano dostęp od złożenia, kupujący otrzymuje go od razu; miejsca wydarzenia pozostają zarezerwowane do zapłaty lub anulowania. Licencje, prowizje i `purchase.completed` czekają na zapłatę. W **Płatnościach** wybierz filtr **Oczekuje na przelew** i sprawdź termin oraz wyróżnione zaległości. Pulpit pokazuje licznik zaległych. **Oznacz jako opłacone** wymaga pełnej zaksięgowanej kwoty i daty wpływu (UTC). **Anuluj zamówienie** wymaga powodu, zwraca miejsca i użycie kuponu oraz cofa dostęp z tego zamówienia, zachowując inne uprawnienia.

Sellf nie ma osobnego serwisu maili transakcyjnych. Instrukcje przelewu, przypomnienie i informacja o anulowaniu trafiają do maila Supabase Auth (z linkiem do zamówienia) przy każdym zamówieniu na przelew. Przy własnym hostingu zaktualizuj oba szablony (`magic-link.html`, `confirmation.html`) i ich tematy (`mail_kind`) w konfiguracji Auth. Własne wiadomości możesz wysyłać z webhooka `order.placed` (np. n8n lub Listmonk). `order.cancelled` i `order.overdue` służą dalszej automatyzacji; zapłata uruchamia `purchase.completed`. Automatyzacja API może użyć `POST /api/v1/payments/:id/mark-paid` i `/cancel` z uprawnieniem `payments:write`.

Faktury w trybie **auto**: złożenie przelewu zleca fakturę do zapłaty z terminem zamówienia. Błąd faktury nie blokuje zamówienia; ponowienia obsługuje `invoices-retry`. Opłacenie aktualizuje tę samą fakturę. Po anulowaniu sekcja faktury prowadzi do dostawcy, gdzie sprzedawca ręcznie wystawia korektę i oznacza ją jako wykonaną w Sellf.

Zaplanuj uwierzytelnione zadania `/api/cron`: `bank-transfer-overdue` codziennie, `fulfillment-resume` i `invoices-retry` co minutę, `transfer-reservations` co 5 minut, z `CRON_SECRET` jako tokenem bearer. Zamówienia bez rezerwacji czasowej nie są automatycznie anulowane.

**Rezerwacja czasowa (wydarzenia).** W ustawieniach przelewu ustaw: rezerwację czasową (domyślnie włączona), przypomnienie po N godzinach (domyślnie 24), zwolnienie po N godzinach (domyślnie 48; musi być później niż przypomnienie) i przedłużenie po „Wysłałem przelew” (domyślnie 72 h). Termin płatności (na fakturze) pozostaje liczbą dni z ustawień; rezerwacja jest osobna. Po przypomnieniu kupujący dostaje mail z linkiem do zamówienia; na tej stronie może raz kliknąć **Wysłałem przelew** (z krótką uwagą), co przedłuża rezerwację, a w szczegółach płatności pojawia się plakietka do sprawdzenia wyciągu. Po terminie zamówienie jest anulowane automatycznie: miejsce, cena progu i użycie kuponu wracają do puli, dostęp z tego zamówienia jest cofany, kupujący dostaje mail. Przelew nie jest oferowany, jeśli termin wydarzenia zaczyna się przed końcem okna rezerwacji. Zwykłe produkty nie wygasają.

**Faktura = bez wygasania.** Gdy dla nieopłaconego zamówienia wystawiono fakturę (w Sellf albo integracja zgłosi ją przez `POST /api/v1/payments/:id/invoice-issued`, w panelu: **Faktura wystawiona poza Sellf**), zamówienie ma status „faktura wystawiona, czeka na płatność”: miejsce jest trzymane bez terminu, także po upływie terminu płatności. Zwalnia je tylko **Anuluj zamówienie**, po którym wystaw korektę. W trybie faktur **auto** Sellf wystawia fakturę od razu przy złożeniu, więc takie zamówienia nie wygasają.

**Przelew po anulowaniu.** System nigdy sam nie przywraca anulowanego zamówienia. W szczegółach anulowanego zamówienia administrator wybiera **Przyjmij spóźniony przelew po cenie z zamówienia** (pełna kwota, data wpływu, powód; miejsce może przekroczyć limit i zostanie oznaczone jako ponad stan) albo zwraca pieniądze poza Sellf. Zamówienie ze skorygowaną fakturą nie może być przywrócone.

Każda zmiana stanu wysyła podpisany webhook: `order.placed`, `order.payment_reminder`, `order.transfer_declared`, `order.invoice_issued`, `order.cancelled`, `order.reopened`, `purchase.completed` (szczegóły w [Webhookach](/pl/webhooks/)).
