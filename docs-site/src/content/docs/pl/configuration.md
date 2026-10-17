---
title: Konfiguracja środowiska
description: Konfiguracja adresów i usług Sellf w runtime.
---

Ustaw `SITE_URL=https://twoj-sklep.pl` w środowisku uruchomieniowym Sellf (np.
`admin-panel/.env.local`). Podaj publiczny origin bez ścieżki. Ten adres jest używany
w e-mailach, checkout, metadanych i sitemap również w gotowych release’ach.
Restart aplikacji stosuje zmianę; ponowny build nie jest potrzebny.

Kolejność: `SITE_URL`, potem `MAIN_DOMAIN` (HTTPS, localhost HTTP), na końcu legacy
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL` odczytane w runtime.
Zmienne URL `NEXT_PUBLIC_*` nie są potrzebne przy instalowaniu release’u.
Placeholdery są odrzucane; produkcja nie uruchomi się bez poprawnego adresu.
Przeglądarka otrzymuje konfigurację przez `/api/runtime-config`; walidacja redirectów
w przeglądarce porównuje origin aktualnej strony.

Ustaw `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` i klucze Stripe
w runtime. Gdy Supabase jest dostępny dla serwera pod adresem wewnętrznym, ustaw
`PUBLIC_SUPABASE_URL` na adres osiągalny z przeglądarki. Brak runtime-config oznacza
błąd uwierzytelniania, a nie połączenie z hostem zastępczym.

W Supabase Auth dodaj `https://twoj-sklep.pl/auth/callback` lub
`https://twoj-sklep.pl/**` do **Redirect URLs**. Sellf gwarantuje absolutny callback
z `?`, ponieważ szablony dopisują `&token_hash`. Nie zmieniaj tego formatu szablonów.
Lista redirectów Supabase jest niezależna od konfiguracji Sellf; aplikacja nie może
jej tanio odczytać przy starcie. Sprawdź rzeczywisty link w dostarczonym e-mailu po
konfiguracji. Odrzucony redirect zostaje zastąpiony Site URL Supabase i może zepsuć link.

CI przed spakowaniem i podpisaniem release’u sprawdza artefakt na obecność placeholderów.
Regresja produkcyjna: `node scripts/run-runtime-url-tests.mjs` z `admin-panel/`.
Buduje z placeholderami, uruchamia na 3777 z prawdziwym runtime, sprawdza Mailpit,
logowanie, darmowy dostęp, embed Stripe, sitemap i metadane. Wymaga działającego
lokalnego Supabase z allowlistą dla 3777 i testowego klucza Stripe; nie resetuje bazy.

## Wyświetlanie cen

Ceny w sklepie, checkout i panelu administracyjnym używają wybranego języka strony.
Na przykład 49 PLN jest wyświetlane jako `49,00 zł` po polsku i `PLN 49.00` po
angielsku. Dotyczy to również cen promocyjnych, poprzednich, subskrypcji, rabatów
i proponowanych kwot Pay What You Want. Formatowanie waluty nie przelicza kwot.
Przyciski osadzonego checkout używają atrybutu HTML `lang` strony sprzedawcy, a gdy
go brakuje — języka przeglądarki.

## Produkty w wyszukiwarkach

Zgłoś wyszukiwarkom `/sitemap.xml` swojej instalacji. Mapa prowadzi do części
zawierających maksymalnie 1000 produktów. Uwzględnia tylko aktywne produkty widoczne
w sklepie, których okno dostępności jest obecnie otwarte. Produkty niewidoczne
w sklepie nadal działają przez bezpośredni link. Angielskie adresy mają postać
`/p/slug`, a polskie `/pl/p/slug`, z odnośnikami do drugiej wersji językowej.
Mapa podaje datę ostatniej modyfikacji produktu.

Odwiedzający bez dostępu widzą dotychczasowy widok zakupu bezpośrednio na stronie
`/p/slug` produktu widocznego w sklepie. Kupujący nadal widzą swoje treści. Linki
z parametrami `email`, `coupon` lub `oto` zachowują przekierowanie do checkoutu
wraz z kontekstem. Adresy checkoutu pozostają wyłączone z indeksowania.

Strony produktów zawierają adresy kanoniczne i dane schema.org Product. Oferta
ze stałą ceną odpowiada cenie widocznej na stronie, uwzględniając aktywne promocje
oraz cykliczną cenę subskrypcji. Produkty z ceną wybieraną przez klienta mają dane
Product bez oferty ze stałą ceną. Dane strukturalne nie zawierają indywidualnych
kuponów ani treści zakupionych przez klienta.

## Logowanie w trybie demo

Przy `DEMO_MODE=true` Sellf odrzuca po stronie serwera żądania magic-linków
(także do darmowych produktów i po zakupie) oraz callbacki uwierzytelniania.
Webhooki subskrypcji mogą korzystać z istniejących kont, ale nie tworzą nowych.
Logowanie hasłem pozostaje dostępne. Formularze logowania i checkoutu wyjaśniają
ograniczenie demo po polsku i angielsku.

Sellf nie udostępnia endpointów resetu hasła, zmiany hasła/e-maila ani rejestracji
hasłem. Supabase Auth jest osobną usługą: jej bezpośrednie API wymaga odrębnej
konfiguracji dla współdzielonego demo. Samo `DEMO_MODE` nie ogranicza bezpośrednich
żądań do Supabase. Przed udostępnieniem demo wyłącz tam rejestrację i skonfiguruj
ograniczenia zmian konta.

## Lejek porzuconych płatności

Dashboard admina pokazuje zapisane próby płatności z ostatnich 7, 30 lub 90 dni
z podziałem na produkty. Obowiązuje filtr produktu z dashboardu. Okres dotyczy daty
utworzenia rekordu; liczby pokazują bieżące statusy. `abandoned` oznacza rekord
oznaczony jako porzucony po wygaśnięciu lub zamknięciu sesji. `pending` pozostaje
osobną kategorią, także po terminie wygaśnięcia. Opłacone obejmują płatności zakończone,
zwrócone, częściowo zwrócone i sporne; ich udział to liczba opłaconych / wszystkie
rekordy z okresu.

To rekordy płatności, a nie unikalni kupujący ani pełny lejek wizyt lub sesji.
Mogą obejmować powtórne próby, dodatkowe pozycje zamówień i płatności subskrypcyjne;
brakujących rekordów nie da się policzyć. E-mail gościa może być nieznany. Widok nie
wysyła przypomnień, nie dodaje śledzenia i nie wymaga nowej konfiguracji.

Tabela pokazuje do 100 produktów z największą liczbą zapisanych prób; sumy obejmują wszystkie produkty. Agregacja odbywa się w bazie w jednym zapytaniu.

## Worker prowizji partnerskich

Po włączeniu programu partnerskiego uruchamiaj worker co minutę. Ustaw `SELLF_URL`
na publiczny adres aplikacji i bezpiecznie przekaż serwerowy `CRON_SECRET` w środowisku
harmonogramu (nie wpisuj prawdziwego sekretu do współdzielonego przykładu crontaba).

```cron
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$SELLF_URL/api/cron?job=affiliate-sync" > /dev/null
```

To osobne zadanie od `webhook-deliveries-retry`; skonfiguruj oba, jeśli korzystasz
z obu funkcji. Worker przetwarza opłacone zamówienia z kuponem i późniejsze zwroty;
nie wykonuje przelewów. Kolejne uruchomienia odzyskują przerwane dzierżawy zadań.

W **Panel → Partnerzy → Naliczanie prowizji** zadania opóźnione o ponad 15 minut
wywołują ostrzeżenie. Najpierw sprawdź harmonogram i odpowiedzi HTTP.
Nieudane zadania pokazują wskazówkę i przycisk **Ponów**: napraw konfigurację Stripe,
odczyt sesji lub brak kwoty netto/danych podatkowych, wpisz co naprawiono i ponów.
Każde ponowienie zapisuje administratora z sesji i powód. Po konflikcie odśwież
widok, bo zamówienie mogło się zmienić. Referencje znajdziesz w **Szczegółach
technicznych**. Ponowienie kolejkuje zadanie; nie uzupełnia danych podatkowych
ani nie rozlicza wypłaty.

Produkty z bezterminowym zwrotem tworzą trwale wstrzymane prowizje: nie można ich
wypłacić, również przez ręczne korekty. Przed kolejną sprzedażą ustaw ograniczony
okres zwrotu, jeśli prowizje mają dojrzewać; zapisane prowizje zachowują pierwotną
politykę. Prowizje testowe są widoczne, ale nie wchodzą do rzeczywistych wypłat.

Przy instalacji lub aktualizacji przez StackPilot dodaj ten harmonogram jawnie
na hoście lub w zewnętrznym schedulerze i sprawdź poprawne wywołanie po restarcie
Sellf. Sam deploy aplikacji nie instaluje harmonogramu prowizji.

## Embed: kody rabatowe

Płatny embed pokazuje nad checkoutem pole kodu rabatowego. Kupujący wpisuje kod i klika
„Apply”; serwer waliduje go tymi samymi regułami i limitami co checkout w sklepie
(limit prób na kod, captcha jak przy każdym płatnym embedzie). Odrzucony kod pokazuje błąd
pod polem i nie blokuje płatności bez rabatu.

Aby wstępnie wypełnić kod, np. z linku sprzedawcy lub partnera, dodaj `data-coupon` do
elementu embeda. Kupujący nadal może go zmienić:

```html
<div data-sellf-embed data-product-slug="moj-kurs" data-coupon="WIOSNA25"></div>
<script src="https://TWOJ_SELLF/embed/v1/checkout.js"></script>
```

`POST /api/embed/checkout-session` przyjmuje opcjonalne `couponCode` (litery, cyfry, `_`, `.`, `-`;
do 64 znaków). Nieprawidłowy lub niemożliwy do użycia kod zwraca `400` z polem `error`, bez
tworzenia sesji.
