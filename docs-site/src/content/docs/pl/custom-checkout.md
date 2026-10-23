---
title: Własny koszyk
description: Dane nabywcy, odbiorcy, telefon i uczestnicy zakupów jednorazowych.
---

Profil koszyka określa dane zbierane dla produktu. W edycji produktu wybierz
**Sprzedaż i ustawienia → Koszyk** i włącz **Własny koszyk dla tego produktu**.
Produkty bez profilu zachowują dotychczasowy formularz oraz format webhooka.

## Moduły

- **Nabywca:** osoba prywatna, organizacja lub oba typy. Organizacja podaje nazwę,
  NIP i adres do faktury. Pobieranie danych z GUS wymaga włączonej integracji GUS.
- **Odbiorca:** nabywca będący organizacją może wskazać innego odbiorcę z własnym NIP-em
  i adresem. Nie zaznaczaj innego odbiorcy, jeśli jest nim nabywca.
- **Telefon:** opcjonalny lub wymagany; zapis w formacie E.164 (np. `+48500100200`).
- **Ilość:** minimum i maksimum miejsc (1–100). Wybierz ukrytą stałą ilość równą minimum,
  wybór w koszyku albo wybór na stronie produktu.
- **Uczestnicy:** wymaga modułu Ilość. Dla każdego miejsca zbierane są imię, nazwisko
  i unikalny e-mail. Opcjonalną listę można pozostawić całkiem pustą. Przy jednym miejscu
  można wstępnie wypełnić uczestnika danymi nabywcy.

Profil obsługuje domyślny szablon koszyka i produkty jednorazowe. Subskrypcje, napiwki,
płatność własną kwotą, zestawy i OTO nie są obsługiwane. Produkt wydający licencje nie może
mieć ilości większej od jednego. Nieprawidłowe kombinacje są odrzucane przy zapisie.

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
i zachowują istniejący format faktury. Dotychczasowe `customFields` nadal zawierają odpowiedzi.

Konfigurację adresów i dostarczania opisuje strona [Webhooki](/pl/webhooks/).
