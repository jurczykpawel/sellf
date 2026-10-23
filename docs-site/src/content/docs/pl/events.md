---
title: Wydarzenia i progi cen
description: Terminy, pula miejsc i automatyczne przechodzenie na kolejną cenę.
---

W ustawieniach sprzedaży produktu włącz **Tryb wydarzenia** i otwórz **Terminy i ceny**. Wydarzenie jest produktem jednorazowym; nie może być zestawem, subskrypcją ani produktem z własną ceną kupującego. Przy pierwszym włączeniu trybu Sellf automatycznie zezwala na ponowny zakup.

Dodaj termin: daty początku i końca, strefę czasową, tytuł, miejsce, opcjonalne dodatkowe dni i pulę miejsc. Pola dat przyjmują UTC; kupujący widzi czas w wybranej strefie. Puste pole puli oznacza brak limitu. Link online musi używać HTTPS; pojawia się wyłącznie w dostępie do kupionego terminu i mailu dostępu. Wyłącz sprzedaż, aby zatrzymać nowe zakupy bez usuwania terminu.

Każdy termin wymaga przynajmniej jednego progu. Przykład: **30 miejsc po 47 zł** do określonej daty, następnie **67 zł** bez limitu progu. Limit progu i wspólna pula terminu są niezależne. Sellf wybiera najtańszy dostępny próg; rezerwacje zmniejszają dostępność przez 30 minut. Uruchamiaj `/api/cron?job=seat-reservations-expire` co minutę z istniejącym `CRON_SECRET`, aby wygasłe rezerwacje zwalniały miejsca. Podaj etykietę, cenę, limit miejsc, opcjonalny koniec sprzedaży i unikalną kolejność każdego progu.

Zapisz produkt, otwórz ponownie ustawienia i wybierz **Co zobaczy kupujący / zamówienia**. Podgląd korzysta z tego samego wyliczenia dostępności co checkout i pokazuje liczbę miejsc w bieżącej cenie, następną cenę i termin zakończenia sprzedaży. Widok terminu zawiera sprzedane, zarezerwowane i wolne miejsca oraz stronicowaną listę zamówień z uczestnikami. **Eksport uczestników CSV** obejmuje potwierdzonych uczestników i wymaga tej samej licencji Sellf co eksport płatności.

Możesz zmienić datę i miejsce kupionego terminu. Terminów i progów powiązanych z rezerwacjami nie można usuwać; zamknij ich sprzedaż. API v1 zwraca `event_mode` i `sessions` z tablicami `tiers`. POST/PATCH obsługuje te same pola. Pominięcie `sessions` zachowuje terminy; przesłanie tablicy zastępuje całą listę. Zachowaj istniejące identyfikatory terminów i progów. Usunięcie powiązanych wpisów zwraca HTTP 409. Narzędzia produktowe MCP przyjmują ten sam format.

Pozycje produktu i bumpów w `purchase.completed` zawierają dla wydarzeń `sessionId`, `sessionStartsAt`, `sessionLabel`, `tierId` i `tierLabel`. Data i etykiety pochodzą ze snapshotu zamówienia. Webhook nie zawiera linków online.

Aby pokazać dostępność na własnej stronie, dodaj jej origin do dozwolonych originów osadzania i pobierz publiczne dane:

```js
const response = await fetch(
  'https://sklep.example.com/api/public/products/warsztat/availability',
  { cache: 'no-store' }
);
if (!response.ok) throw new Error('Brak dostępności');
const { currency, sessions } = await response.json();
for (const session of sessions) {
  console.log(session.startsAt, session.currentTier?.price, currency,
    session.currentTier?.seatsLeft, session.nextTierPrice);
}
```

Odpowiedź nie zawiera linków online ani danych uczestników. Odśwież ją przed rozpoczęciem zakupu, bo liczba miejsc może się zmienić.

**Omnibus:** Sellf traktuje rosnące progi wydarzeń jako harmonogram cen i nie pokazuje dla nich porównania z najniższą ceną z 30 dni. To decyzja do potwierdzenia przez sprzedawcę dla jego oferty i właściwych wymagań.

Na własnym serwerze zaktualizuj szablon magic linka z `admin-panel/public/auth-email-templates/magic-link.html`, aby mail dostępu pokazywał termin i link online. Własne szablony wymagają opcjonalnych pól danych `event_date` i `event_online_url`.
