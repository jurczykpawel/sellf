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
