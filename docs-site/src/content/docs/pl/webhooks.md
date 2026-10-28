---
title: "Webhooki"
description: "Trwałe dostarczanie zdarzeń Sellf, identyfikatory dostaw i deduplikacja."
---

Sellf wysyła zdarzenia do skonfigurowanych endpointów HTTPS. Każda dostawa jest
zapisywana przed wysłaniem żądania HTTP. Nieudane próby trafiają do kolejki ponowień.


## Rotacja sekretu podpisującego

W **Webhooki → Edytuj** wybierz **Wygeneruj nowy sekret** i potwierdź. Możesz też
wywołać `POST /api/v1/webhooks/{id}/rotate-secret` z sesją administratora lub kluczem
API z uprawnieniem `webhooks:write`. Treść żądania nie jest wymagana. Odpowiedź po
sukcesie: `{ "data": { "id": "…", "secret": "whsec_…" } }`.

Zmiana i wpis audytu są zatwierdzane atomowo. Nowy sekret jest szyfrowany w bazie
i zwracany tylko w tej odpowiedzi; panel pokazuje go do zamknięcia okna edycji.
Skopiuj go teraz do magazynu sekretów odbiornika. Po rotacji odpowiedzi API listy,
szczegółów i aktualizacji zwracają puste pole `secret`; wartości nie można ponownie
odczytać. Jeśli ją utracisz, wykonaj kolejną rotację. Istniejące endpointy zachowują
dotychczasowy sekret do jawnego wykonania rotacji.

**Stary sekret jest unieważniany natychmiast, bez okresu przejściowego.** Uzgodnij
zmianę z odbiornikiem i natychmiast podmień jego sekret weryfikacyjny. W trakcie
zmiany dostawy mogą się nie powieść. Żądania już w drodze mogą nadal mieć poprzedni
podpis; dostawy pobierane po zmianie, także ponowienia i wysyłki testowe, używają
aktualnego sekretu. Rotacja nie zmienia podpisu już wysłanego żądania HTTP. Po
aktualizacji odbiornika wyślij test i w razie potrzeby ponów nieudane dostawy.
Identyfikatory i payloady dostaw pozostają bez zmian: nadal deduplikuj po `id`.

Jeśli odpowiedź zaginie po zatwierdzeniu operacji, stary sekret i tak przestaje
działać. Wygeneruj kolejny sekret i zainstaluj wartość z nowej odpowiedzi. Nie
ponawiaj żądań rotacji automatycznie: każde udane wywołanie ponownie zmienia sekret.

## Identyfikator dostawy

```json
{
  "id": "5cb0a355-840e-4d73-8ab9-34137a763c39",
  "event": "purchase.completed",
  "timestamp": "2026-10-02T12:34:56.789Z",
  "data": {}
}
```

Nagłówek `X-Sellf-Delivery-Id` zawiera ten sam UUID co pole `id` na najwyższym
poziomie payloadu. Każdy endpoint otrzymuje własny identyfikator dostawy.
Automatyczne oraz ręczne ponowienia używają tego samego identyfikatora i zapisanych
danych zdarzenia. Personalizacja payloadu nie może zmienić ani usunąć pola `id`.
To dodatkowe pole koperty: `event`, `timestamp`, `data` oraz format podpisu pozostają
bez zmian.

**Deduplikuj po tym identyfikatorze (deduplicate on this id).** Sellf stosuje
semantykę „co najmniej raz”: po timeoutcie lub przerwaniu działania nadawcy ten sam
webhook może dotrzeć ponownie, nawet jeśli odbiorca obsłużył wcześniejsze żądanie.

1. Sprawdź `X-Sellf-Signature` na oryginalnej treści żądania.
2. Sprawdź zgodność `X-Sellf-Delivery-Id` z podpisanym polem `id`.
3. Zapisz identyfikator i wynik obsługi w jednej transakcji bazy odbiorcy.
4. Dla wcześniej obsłużonego identyfikatora zwróć 2xx bez ponownego wysyłania e-maila
   lub powtarzania innych czynności.

Nagłówki `X-Sellf-Event` i `X-Sellf-Signature` nadal obowiązują. Podpis ma postać
`t=<sekundy_unix>,v1=<HMAC-SHA256>` i obejmuje `<t>.<oryginalna_treść>`, w tym pole
`id`. Przy ponowieniu podpis jest obliczany ponownie. Pole `timestamp` w zapisanym
payloadzie pozostaje stałe.

## Zakupy i subskrypcje

Dla zakupów `purchase.completed` istnieje jedna logiczna dostawa na
zamówienie/zdarzenie/endpoint. Nowy zakup otrzymuje nowy identyfikator dostawy.
Subskrypcje wysyłają `invoice.paid`; każda faktura stanowi osobne zamówienie.
Błąd wystawiania licencji lub przerwana realizacja mogą zostać uzupełnione przez
kolejne zdarzenie lub weryfikację zakupu. Zapis zakończonej transakcji nie oznacza,
że wszystkie dostawy już się zakończyły.

Pełny katalog zdarzeń, przykłady danych VAT i licencji oraz konfiguracja ponowień
znajdują się w [dokumentacji webhooków po angielsku](/webhooks/).

## Automatyczne ponowienia

Sellf zapisuje dostawę przed pierwszą próbą i wysyła ją od razu. Dotyczy to również
przycisku **Wyślij test**: test ma jedną próbę, bez automatycznych ponowień.
Historia dostaw domyślnie pokazuje wszystkie statusy. Filtr nieudanych dostaw
obejmuje również oczekujące ponowienia i dostawy po wyczerpaniu prób.

Ponowienia nieudanych lub przerwanych zwykłych dostaw wymagają osobnego zadania
uruchamianego co minutę. Samo uruchomienie aplikacji przez PM2 go nie ustawia.
Ustaw `SELLF_URL` i `CRON_SECRET` w środowisku harmonogramu, a następnie dodaj:

```cron
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$SELLF_URL/api/cron?job=webhook-deliveries-retry" > /dev/null
```

To osobne zadanie od `affiliate-sync`. Kontroluj błędy wywołań w logach
harmonogramu. Brak harmonogramu wstrzymuje ponowienia, ale nie pierwszą próbę
ani zapis logów. Ręczne ponowienie starej dostawy o statusie `failed` aktualizuje
ten sam wpis, zachowując identyfikator dostawy.

## Wygaśnięcie checkoutu Stripe

Włącz `checkout.session.expired` na endpoincie Stripe wysyłającym zdarzenia do
`/api/webhooks/stripe`, obok zdarzeń zakończenia płatności. Nowe endpointy tworzone
w ustawieniach Sellf mają je automatycznie. Dla istniejącego endpointu dodaj to
zdarzenie w Stripe Dashboard → Workbench → Webhooks → endpoint → Edit events.

Po zmianie koszyka lub opuszczeniu checkoutu przed potwierdzeniem płatności Sellf
wygasza poprzednią Checkout Session i zmienia status jej oczekującej transakcji
na `abandoned`. Powrót przyciskiem „Wstecz” przywraca pierwszy krok; nowa sesja
powstaje dopiero po wybraniu „Przejdź do płatności”. Przekierowanie podczas
potwierdzania płatności zachowuje aktywną sesję. Naturalne wygaśnięcie uruchamia tę samą
zmianę przez zdarzenie Stripe. Zakończone transakcje pozostają bez zmian,
a powtórne zdarzenia można obsłużyć ponownie. Błąd zapisu zwraca HTTP 500, aby
Stripe ponowił dostawę.

Jeśli przeglądarka zamknie stronę przed otrzymaniem odpowiedzi tworzącej sesję,
nie może później wysłać żądania jej zamknięcia — nawet z opcją `keepalive`.
Zdarzenie wygaśnięcia musi być włączone, aby rozliczyć takie próby. Gdy strona
nadal działa, kolejka czeka z zamknięciem na zakończenie tworzenia sesji. Sellf
zachowuje też sesje, których PaymentIntent jest przetwarzany, czeka na pobranie
środków lub dodatkowe działanie klienta albo zakończył się powodzeniem.


## Zgłoszenia PlayerStack

[Formularze potwierdzane mailem i zgoda marketingowa](/pl/playerstack-leads/).
