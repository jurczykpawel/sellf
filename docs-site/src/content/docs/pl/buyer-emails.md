---
title: Maile do kupujących
description: Wysyłka powiadomień kupujących przez podpisane webhooki lub opcjonalny kanał Supabase.
---

Domyślnie Sellf wysyła podpisane webhooki biznesowe. Twoja integracja buduje i wysyła maile do kupujących. Postaw [Mailstack](https://github.com/jurczykpawel/mailstack) — darmowy do wysyłek — albo podłącz własnego odbiorcę.

Supabase Auth nadal wysyła linki logowania i potwierdzenia adresu. Gość po opłaceniu zakupu dostaje zwykły link uwierzytelnienia także przy wyłączonych mailach transakcyjnych. Link pozwala odebrać zakup i otworzyć produkt; treść zamówienia dociera osobno przez webhook. Logowanie do darmowego produktu i zwykłe logowanie nadal działają.

Po opłaceniu subskrypcji przez gościa strona potwierdzenia zakupu zleca wysłanie pierwszego maila z dostępem, także po zapisaniu faktury. Nowy kupujący otwiera link, aby potwierdzić adres i uzyskać dostęp.

Gość, który zapłaci i zamknie kartę płatności, zanim wczyta się strona potwierdzenia, i tak dostanie pierwszy mail z dostępem. Zapisana płatność (zakup jednorazowy albo pierwsza faktura subskrypcji) planuje go w kolejce maili uwierzytelniania na 10 minut później, na adres zapisany z płatnością. Jeśli strona potwierdzenia wyśle link wcześniej, w dowolnym języku, zaplanowany mail nie wychodzi, więc kupujący dostaje jeden mail. Płatność, którą Stripe dostarczy ponownie, nie planuje drugiego maila. Zaplanowany mail przepada, jeśli przed terminem płatność zostanie zwrócona w całości albo zakwestionowana; częściowy zwrot go nie anuluje. Jeśli mail nie da się zaplanować (np. baza jest chwilowo niedostępna), zamówienie pozostaje w realizacji: webhook purchase.completed i faktura czekają, aż Stripe ponownie dostarczy płatność albo strona potwierdzenia kupującego ponowi realizację. Nie jest planowany dla kupującego z potwierdzonym kontem ani dla produktu z kluczem licencyjnym, bo link logowania przychodzi w mailu z licencją. Zamówienia na przelew mają własne maile.

W **Ustawienia → Sklep → Maile do kupujących** włącz **Wysyłaj maile do kupujących przez Supabase**, aby korzystać z dotychczasowych szablonów Sellfa. Ta opcja szybciej zużywa darmowy limit maili Supabase i może wymagać płatnego planu. Sellf nie konfiguruje osobnego SMTP. Aktualizacja pozostawia opcję włączoną w istniejących instalacjach, aby kupujący nie stracili powiadomień bez ostrzeżenia. W nowych instalacjach jest wyłączona. Wyłącz ją po podłączeniu i sprawdzeniu odbiorcy webhooków. Oczekujące ponowienia uwzględniają bieżące ustawienie: zakupowe linki dostępu stają się zwykłymi linkami logowania, a same powiadomienia są pomijane.

Jeżeli realizacja zapisanej płatności nie zakończy się po krótkim oczekiwaniu, pierwszy mail z dostępem trafia do kolejki ponowień. Po zakończeniu realizacji wysyłka odczytuje aktualne dane zakupu i dołącza produkt oraz zapłaconą kwotę, gdy maile do kupujących są włączone. Dotyczy to subskrypcji i zakupów jednorazowych, także pierwszego potwierdzenia adresu kupującego. Pierwsze ponowienie jest zaplanowane po dwóch minutach. Zapewnij działanie procesu ponowień opisanego poniżej.

## Przykład z Mailstackiem

Dodaj endpoint webhooków Sellfa wskazujący na Twój serwer Mailstack:

```text
https://twoj-mailstack.example/v1/hooks/sellf
```

Ustaw ten sam sekret podpisu po obu stronach. Wybierz potrzebne zdarzenia: `purchase.completed`, `order.placed`, `order.payment_reminder`, `order.cancelled`, `order.participants_needed`, `license.issued` (Pro) i `refund.issued`. Utworzenie webhooka wymaga licencji Registered; istniejące endpointy działają dalej. [Dokumentacja webhooków](/pl/webhooks/) opisuje podpis, ponowienia i pełne dane.

| Mail | Zdarzenie |
| --- | --- |
| Potwierdzenie zakupu / otrzymanej płatności | `purchase.completed` (Stripe lub przelew) |
| Dane do przelewu | `order.placed` |
| Przypomnienie o płatności | `order.payment_reminder` |
| Anulowanie z powodem | `order.cancelled` |
| Brakujący uczestnicy (dwa etapy) | `order.participants_needed` |
| Dostarczenie licencji | `license.issued` z `licenseKey` — jedyne zdarzenie do maila z kluczem. Sellf wysyła dokładnie jedno na każdą wydaną licencję (zakup, darmowy dostęp, ręcznie, API). `purchase.completed.licenses[]` jest informacyjne dla integracji; nie wysyłaj z niego maila z kluczem. |
| Zwrot | `refund.issued` |

Odbiorca sprawdza podpis, zapobiega ponownej wysyłce na podstawie identyfikatora dostawy i wysyła mail na `customer.email`. Linki uczestników i klucze licencji są poufne — nie zapisuj ich w logach aplikacji. Mail transakcyjny nie jest zapisem do marketingowej bazy adresów.

Mapowania i szablony Mailstacka są rozwijane osobno w jego repozytorium. Sprawdź tam obsługę wybranych zdarzeń przed wyłączeniem wysyłki Supabase. Włączenie tej samej automatyzacji w obu kanałach może spowodować podwójne maile.

## Limity wysyłki i oczekujące maile

Żądania wysłania linku logowania i worker ponowień mają wspólny limit **5 prób na skrzynkę w ciągu 24 godzin**. Warianty adresu trafiające do tej samej skrzynki, w tym dopiski po plusie i kropki w Gmailu, korzystają z jednego limitu. Obowiązuje on niezależnie od limitów Supabase Auth i dostawcy SMTP. Po jego osiągnięciu wiadomość w kolejce czeka do odnowienia okna limitu (00:00 UTC dla limitu w bazie, 24 godziny dla Upstash) bez zużycia próby ponowienia; strona po płatności podaje ten termin. Odświeżenie strony potwierdzenia po dostarczeniu linku logowania nie dodaje go ponownie do kolejki.

Kolejka poczty uwierzytelniającej podejmuje do sześciu prób ponowienia. Nadany dostęp i wystawiona licencja pozostają ważne, gdy mail czeka. API nadania dostępu zwraca `license.email_pending`, a `POST /api/v1/licenses` zwraca `emailPending`. Ponowne **Przyznaj dostęp** może wznowić porzucony mail z licencją. Zobacz [SMTP i odstępy między próbami](/pl/email-setup/).

Na serwerze z ciągłym procesem produkcyjnym aplikacja sprawdza kolejkę co minutę. W pozostałych środowiskach zaplanuj `/api/cron?job=auth-mail-retry` co minutę z nagłówkiem `Authorization: Bearer <CRON_SECRET>`. Sekret przechowuj w konfiguracji harmonogramu. To osobne zadanie niż ponawianie dostaw webhooków.

## Odzyskanie dostępu po płatności

Po udanym wysłaniu nowego linku logowania strona usuwa ostrzeżenie o poprzednim, wygasłym linku. Przy odmowie wysyłki ostrzeżenie pozostaje.

Wyłączenie lub archiwizacja oferty po rozpoczęciu zakupu nie anuluje opłaconego zamówienia: strona potwierdzenia nadal umożliwia wysłanie linku logowania, a potwierdzenie adresu przypisuje kupującemu opłacony produkt. Oferta pozostaje niedostępna dla nowych zakupów.

W **Moich zakupach** karta subskrypcji zachowuje nazwę, cenę, walutę i okres rozliczeniowy z zakupu także po wyłączeniu lub archiwizacji oferty.

Przy wstrzymanej ofercie biblioteka zachowuje zakup i zapisany dostęp, ale zamiast linku do niedostępnej treści pokazuje informację o wstrzymaniu. Treść archiwalnego produktu nadal otwiera się kupującym. Dla subskrypcji sprzed tej aktualizacji podsumowanie używa kwoty pierwszego zapisanego dodatniego opłaconego rachunku (z VAT i rabatami); przy braku opłaconego rachunku używa warunków katalogowych dostępnych podczas aktualizacji.

## Decyzje o zwrotach

Kupujący sprawdza status prośby o zwrot w **Moich zakupach**. Sellf nie wysyła natywnego maila Supabase o zatwierdzeniu ani odrzuceniu. Opcjonalne maile o decyzji zależą od odbiorcy webhooków sprzedawcy: `refund.request_approved` i `refund.request_rejected` opisują decyzję, a `refund.issued` opisuje zwrot u operatora płatności. Samo włączenie maili do kupujących przez Supabase nie uruchamia powiadomień o decyzji. Modal prośby nie obiecuje więc odpowiedzi e-mailem.

## Limity i język linków do logowania

Po wykorzystaniu dobowego limitu skrzynki formularz logowania podaje przyczynę i termin ponownej próby w bieżącym języku. Bramka zwraca HTTP 429 z `code: address_rate_limited` oraz `Retry-After` w sekundach. Dobowe okno bazy odnawia się o 00:00 UTC; dla Upstash proponowany termin to ostrożnie 24 godziny później. Limity IP i dostawcy Auth pozostają bez zmian. Zwykły link logowania zachowuje wybrany język polski lub angielski oraz stronę docelową wynikającą z roli. Potwierdzenie formularza otwiera stronę w języku zapisanym ze zgłoszeniem, także na innym urządzeniu lub przy innych ciasteczkach językowych. Jawne cele product-access zachowują własny język.
