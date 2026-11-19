---
title: Własny koszyk
description: Dane nabywcy, odbiorcy, telefon i uczestnicy zakupów jednorazowych.
---

Profil koszyka określa dane zbierane dla produktu. W edycji produktu wybierz
**Dane w koszyku** i włącz **Własny koszyk dla tego produktu**.
Produkty bez profilu zachowują dotychczasowy formularz oraz format webhooka.

## Moduły

- **Nabywca:** osoba prywatna, organizacja lub oba typy. Organizacja wypełnia tę samą sekcję
  faktury co w zwykłym koszyku: jedno pole „NIP lub numer VAT UE” (numer ustala kraj firmy,
  polski NIP pobiera dane z GUS) albo „Nie mam NIP albo firma jest spoza UE” z wyborem kraju;
  adres zawsze w osobnych polach.
- **Odbiorca:** nabywca będący organizacją może wskazać innego odbiorcę — placówkę z polskim
  NIP-em (np. szkołę) — w tej samej sekcji faktury. Nie zaznaczaj innego odbiorcy, jeśli jest
  nim nabywca.
- **Telefon:** opcjonalny lub wymagany; zapis w formacie E.164 (np. `+48500100200`).
- **Ilość:** minimum i maksimum miejsc (1–100). Wybierz ukrytą stałą ilość równą minimum,
  wybór w koszyku albo wybór na stronie produktu.
- **Uczestnicy:** wymaga modułu Ilość. Dla każdego miejsca zbierane są imię, nazwisko
  i unikalny e-mail. Opcjonalną listę można pozostawić całkiem pustą. Przy jednym miejscu
  można wstępnie wypełnić uczestnika danymi nabywcy.

Profil obsługuje domyślny szablon koszyka i produkty jednorazowe. Subskrypcje, napiwki,
płatność własną kwotą, zestawy i OTO nie są obsługiwane. Produkt wydający licencje nie może
mieć ilości większej od jednego. Nieprawidłowe kombinacje są odrzucane przy zapisie.

## Pobieranie danych firmy

Klucz GUS ustawiasz raz w **Ustawienia → Integracje**. Przy włączonej integracji dane
nabywcy są pobierane dla poprawnego polskiego NIP-u w zwykłym koszyku i w koszyku
z profilem. Bez klucza dane można wpisać ręcznie; brak konfiguracji nie wyświetla błędu.
Te same reguły i komunikaty obowiązują przy płatności online i przy zamówieniu przelewem
w koszyku z profilem.
Produkt nie ma osobnego przełącznika GUS. Dawne wartości `buyer.gus` w zapisanych
profilach są ignorowane i usuwane przy aktualizacji bazy. W zapisach przez API v1 oraz
MCP pomiń to pole. Jest odrzucane tak jak inne nieznane pola profilu.

## Przykład: pięć miejsc na szkoleniu

Gmina kupuje pięć miejsc dla szkoły. Włącz Nabywcę (organizacja), Odbiorcę, wymagany Telefon,
Ilość (1–20) i wymaganych Uczestników. Gmina jest **nabywcą** i podaje swój NIP oraz adres
fakturowania. Szkoła jest **odbiorcą** i podaje własny NIP oraz adres. Osoba kontaktowa
uzupełnia telefon i dane pięciu uczestników. Przykład nie opisuje rzeczywistego klienta.

Administrator otwiera **Płatności → szczegóły transakcji → Dane z koszyka**, aby odczytać
zapisanego nabywcę, odbiorcę, telefon, ilość i tabelę uczestników. Ta sama sekcja zawiera
odpowiedzi na dodatkowe pola. Ostrzeżenie o niekompletnych danych oznacza, że wymagane dane
nie zostały zebrane; zakończona płatność nadal przyznaje dostęp.

## Webhook zakupu

Dla produktu z profilem `purchase.completed` dodaje `orderDetails` ze stałymi kluczami:
`buyer`, `recipient`, `phone`, `participants`, `quantity`. Brakujące moduły mają wartość `null`.
Obiekty zachowują format zapisu modułów: `buyer` zawiera `v: 1`, `type`, imię/nazwisko lub
`company_name`, `nip`, `address`, `postal_code`, `city`, `country` i opcjonalny e-mail;
`recipient` zawiera `v: 1`, `differs` oraz dane firmy i adres. Telefon i ilość mają postać
`{ "v": 1, "value": ... }`, a uczestnicy
`{ "v": 1, "people": [{ "first_name": "Anna", "last_name": "Przykładowa", "email": "anna@example.com" }] }`.

Dla organizacji blok `invoice` powstaje z zapisanego nabywcy: `needsInvoice`, `nip`,
`companyName`, `address`, `city`, `postalCode`, `country`. Inny odbiorca trafia do
`invoice.recipient` w zapisanym formacie modułu z kluczami snake_case. Zakup osoby prywatnej
bez prośby o fakturę pomija `invoice`. Produkty bez profilu nie otrzymują `orderDetails`
i zachowują istniejący format faktury, z `invoice.recipient`, gdy sklep zbiera odbiorcę ([Webhooki](/pl/webhooks/)). Dotychczasowe `customFields` nadal zawierają odpowiedzi.

Konfigurację adresów i dostarczania opisuje strona [Webhooki](/pl/webhooks/).

## Zmiany podczas płatności Stripe

Zmiana koszyka aktualizuje pozycje w tej samej otwartej sesji Stripe Checkout na stronie sklepu, jeśli sesja spełnia warunki ponownego użycia. Zmiana języka, adresu powrotu lub maila kupującego wymaga nowej sesji. Rozpoczęta płatność może się zakończyć. Sellf zapisuje wersje koszyka i realizuje tę, którą Stripe faktycznie obciążył, z zapisanymi cenami i uprawnieniami. Ta funkcja nie wprowadza koszyka wielu produktów.

Zastosowanie lub usunięcie kodu rabatowego również zachowuje tę samą sesję spełniającą warunki aktualizacji oraz wpisane dane karty. Sellf uwzględnia rabat w cenach pozycji, zamiast zmieniać rabaty Stripe. Podczas sprawdzania kodu i aktualizacji koszyka płatność jest zablokowana. Po kliknięciu przycisku płatności kontrolki koszyka pozostają zablokowane do zakończenia potwierdzania; tuż przed potwierdzeniem formularz ponownie sprawdza koszyk. Aktualizacja ma wspólny limit 15 sekund na żądania, krótszy niż 20-sekundowy limit `runServerUpdate` Stripe. Formularz pozostaje na stronie i odświeża się przez `runServerUpdate` Stripe. Ponowne użycie sesji dotyczy płatności jednorazowych poza wydarzeniami, z co najmniej dwiema minutami do wygaśnięcia; pozostałe koszyki mogą wymagać nowej sesji.

## Wznowienie koszyka i walidacja

Serwer zwraca pozostały czas sesji w sekundach. Strona odlicza go od odebrania odpowiedzi, niezależnie od zegara urządzenia kupującego; odpowiedź API `409 checkout_session_expired` rozstrzyga o wygaśnięciu. Lokalny upływ czasu nie przerywa trwającej autoryzacji płatności, np. 3DS.

Po wygaśnięciu sesji pojawia się komunikat **Sesja płatności wygasła** i przycisk **Rozpocznij nowy koszyk**, zamiast zachęty do ponownego zapisywania danych. Nowy koszyk ponownie sprawdza dostępność i ceny; miejsce na wydarzeniu zostanie ponownie zarezerwowane tylko wtedy, gdy jest nadal dostępne. Dane kupującego przechowywane przez stronę pozostają dostępne, ale nowy formularz Stripe wymaga ponownego wpisania danych płatności.

Błędy formatu i długości adresu e-mail pojawiają się przy polu w języku strony. Adres może mieć maksymalnie 254 znaki. Poprawienie pola usuwa jego komunikat błędu.

Po pełnym zwrocie otwarcie pierwotnego linku statusu płatności pokazuje **Płatność zwrócona**. Weryfikacja zwraca końcowy stan `payment_status: "refunded"`, bez ponownej realizacji zamówienia ani przyznania dostępu. Nie zgłasza awarii przetwarzania płatności ani potrzeby sprawdzania danych zamówienia.

Częściowy zwrot zachowuje ścieżkę weryfikacji zakończonej płatności i pozostały dostęp. Otwarty spór płatniczy pokazuje **Płatność zakwestionowana**, zwraca `payment_status: "disputed"` i nie przyznaje dostępu ani nie realizuje zamówienia ponownie.

Jeśli koszyk zmieni się podczas przygotowywania płatności, Sellf zatrzymuje się przed potwierdzeniem i prosi o sprawdzenie koszyka przed ponowną próbą. Gdy nie da się odczytać podglądu pakietu, checkout pozostaje dostępny bez listy składników i informacji o oszczędności. Powrót na stronę potwierdzenia płatności po częściowym zwrocie zachowuje dostęp zgodnie z zamówieniem, ale nie generuje kuponu oferty po zakupie.

## Dostęp z kilku zakupów

Pełny zwrot kończy uprawnienie z danego zamówienia. Kupujący zachowuje produkt, jeśli nadal uprawnia do niego inny zakup, opłacony przelew, pakiet, dodatek do zamówienia lub aktywna subskrypcja. Zwrot ostatniego uprawniającego zamówienia odbiera odpowiadający mu dostęp.

Zamówienia w stanie `disputed`, także po przegranym sporze, nie podtrzymują dostępu po zwrocie innego zamówienia.

Dla produktów czasowych inne zamówienie podtrzymuje dostęp tylko do końca swojego okresu. Po pełnym zwrocie termin zmienia się na najpóźniejszy niewygasły termin pozostałych źródeł; pozostałe źródło bezterminowe zachowuje dostęp bezterminowy. Każde nowe zamówienie zapisuje czas trwania i początek nadania, także dla dodatków (zero oznacza dostęp bezterminowy), składników pakietu i zakupów odebranych przez gościa. Dwa nadania po 30 dni nadal sumują się przed zwrotem; zwrot jednego pozostawia 30 dni od początku pozostałego nadania, bez przenoszenia zwróconego przedłużenia. Aktywna subskrypcja zachowuje otwarty dostęp zarządzany przez subskrypcję, dopóki jej bieżący okres jest ważny; anulowana może zachować już opłacony okres. Nadania administratora i ręczne zmiany terminu są niezależnymi uprawnieniami: zwrot nigdy ich nie skraca, także przy dostępie bezterminowym. Późniejszy zakup może przedłużyć dostęp, ale jego zwrot usuwa tylko kupione przedłużenie. Powtórzone lub spóźnione powiadomienia o zwrocie zachowują późniejsze ręczne zmiany. Darmowy dostęp zachowuje swój pierwotny termin po zwrocie kupionego później pakietu. Otwarty spór zachowuje tożsamość nadania po zwrocie, także gdy inne opłacone źródło nadal daje dostęp; późniejsza wygrana przywraca pozostały okres spornego zakupu bez zwróconego przedłużenia. Ręczne zmiany terminu lub czasu dostępu dokonane po zwrocie mają pierwszeństwo przed takim przywróceniem. Podczas aktualizacji do 2026.11.1 Sellf zapisuje istniejący termin dostępu na starszych uprawniających zamówieniach bez zapisanych warunków, także dla składników pakietów i zakupów odebranych przez gości. Wiersze należące do innego przelewu z wczesnym dostępem lub subskrypcji nie przekazują swojego terminu starszym zamówieniom jednorazowym. Bieżący czas produktu nigdy nie służy do odrzucenia znanego starego terminu: nie dowodzi, jakie były pierwotne warunki zakupu. Późniejsza zmiana czasu produktu nie skraca tego znanego okresu przy zwrocie innego zamówienia. Nie da się wiarygodnie rozdzielić dawnych zakupów składających się na wspólny termin, dlatego każde pasujące stare zamówienie zachowuje ostrożnie cały znany termin; po zwrocie może więc pozostać więcej czasu niż przy dokładnym historycznym podziale. Tylko zamówienia bez pasującego zapisu dostępu korzystają z daty odbioru, płatności lub złożenia oraz dostępnego czasu produktu albo dodatku. Przy aktualizacji do 2026.11.1 istniejące wiersze dostępu ręcznego, darmowego i o nieznanym źródle zachowują ostrożnie cały bieżący termin jako niezależny dostęp, także jeśli obejmuje dawny opłacony okres, którego nie da się oddzielić.

Komunikaty ładowania i niedostępności filmu są wyświetlane w języku widoku kupującego: polskim lub angielskim.

Anulowanie nieopłaconego przelewu z dostępem od złożenia usuwa okres tego zamówienia, nawet gdy późniejszy zakup przedłużył ten sam produkt. Zwrot faktury subskrypcji kończy uprawnienia z tej subskrypcji, zachowując osobno kupione okresy i nadania administratora.
