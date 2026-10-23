---
title: Faktury
description: Konfiguracja Fakturowni i obsługa faktur zamówień.
---

W **Ustawienia → Sklep → Faktury** wybierz Fakturownię, wpisz domenę konta
(`twoje-konto.fakturownia.pl`) i token API, a następnie **Sprawdź połączenie**.
Najpierw uzupełnij nazwę sprzedawcy, NIP i adres w ustawieniach danych firmy.
Serwer wymaga `APP_ENCRYPTION_KEY`. Puste pole tokenu zachowuje zapisany token;
przy zmianie domeny konta wpisz nowy token.

Tryb **Automatyczny** wystawia faktury po zakończeniu płatności. W trybie
**Ręcznym** użyj przycisku w szczegółach płatności. Błąd faktury nie przerywa
realizacji zamówienia. Lista płatności i szczegóły pokazują numer z linkiem do
Fakturowni. **Wystaw ponownie** pojawia się tylko dla błędu. Ponowienia zachowują
zewnętrzny identyfikator, również po wcześniejszym przyjęciu faktury przez dostawcę.

Automatyczne wystawianie obejmuje zamówienia złożone od chwili włączenia.

Dla produktów zwolnionych wpisz podstawę zwolnienia z VAT i włącz wybór podstawy
stawki zw w Fakturowni. Szablon pozycji obsługuje `{product}`, `{date}`, `{session}`
i `{tier}`. Ceny, ilości, podatki i rozdzielony kupon pochodzą z zapisanych pozycji
zamówienia. Dodatki są osobnymi pozycjami. Osobny odbiorca zachowuje nazwę, adres i NIP.

Uruchamiaj `/api/cron?job=invoices-retry` co minutę z nagłówkiem Bearer zawierającym
`CRON_SECRET`. Ponowienia następują po 1, 2, 4 i 8 minutach, maksymalnie pięć prób.
Przerwane próby można odzyskać po dziesięciu minutach. Cron aktualizuje również
nieopłacone faktury po oznaczeniu zamówienia jako opłaconego.

Po pełnym zwrocie lub anulowaniu wystaw korektę w Fakturowni przez link do faktury,
a następnie wybierz **Oznacz jako skorygowaną** w szczegółach płatności. Przycisk
zapisuje informację o korekcie; nie tworzy dokumentu u dostawcy.

Wcześniej wystawiona faktura dodaje `invoice.number` i `invoice.viewUrl` do webhooka
zakupu. Faktura wystawiona później jest widoczna w panelu.
Integracja składania przelewu wywołuje `issueInvoiceForTransaction(id)`; termin
płatności zamówienia trafia do Fakturowni bez zmian.

Fakturownia podaje limit 1000 zapytań z IP na minutę i dwa równoczesne zapytania.
Do testów integracji używaj osobnego konta; wsparcie może oznaczyć je jako testowe.
Nie ma osobnego publicznego hosta API sandbox. Opcjonalny test połączenia wymaga
`FAKTUROWNIA_TEST_DOMAIN` i `FAKTUROWNIA_TEST_TOKEN`.

Tekst podstawy odwołujący się do art. 113, 43 lub 82 jest mapowany na udokumentowany
wybór zwolnienia KSeF Fakturowni; oryginalny tekst zostaje w uwagach faktury.
Autoryzację KSeF i automatyczną wysyłkę skonfiguruj w samej Fakturowni.
