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

`purchase.completed` zawiera `attribution`, gdy zamówienie ma zapisane źródło
([Źródła zakupów](/pl/purchase-attribution/)): kanał, ostatni i pierwszy kontakt, urządzenie,
kraj i typ identyfikatora kliknięcia — nigdy sam identyfikator.

Pełny katalog zdarzeń, przykłady danych VAT i licencji oraz konfiguracja ponowień
znajdują się w [dokumentacji webhooków po angielsku](/webhooks/).

## Potwierdzenie zwrotu i opłaconego okresu

`invoice.paid` wiąże `data.invoice.stripeInvoiceId` z
`data.subscription.stripeSubscriptionId`, `data.product.id` i `data.customer.userId`.
Faktura zawiera `amountPaid` (główna jednostka waluty), `currency` i `paidAt`.
`subscription.currentPeriodStart` oraz `subscription.currentPeriodEnd` (ISO 8601 UTC)
pochodzą z konkretnej opłaconej pozycji subskrypcyjnej tej faktury. Jeśli nie ma
jednoznacznej pozycji bez proporcjonalnego rozliczenia z prawidłowym okresem,
pola są pomijane. Odbiorca nie powinien wyliczać opłaconego dostępu z daty dostawy
ani z późniejszej aktualizacji subskrypcji.

`refund.issued` przekazuje `data.refund.stripeRefundId` i rzeczywisty `status`
Stripe: `pending`, `requires_action`, `succeeded`, `failed` albo `canceled`.
Potwierdzenie pełnego zwrotu wymaga statusu `succeeded`, `isFullRefund: true`
i `totalRefunded >= payment.amount` przy dodatniej kwocie płatności.
Kwoty są w najmniejszych jednostkach waluty. `refund.issued` powstaje dokładnie raz
na ID zwrotu, z pełną kwotą tego zwrotu i rzeczywistym statusem. Każda późniejsza
zmiana statusu wysyła osobne `refund.updated`: `stripeRefundId`, `previousStatus`,
`status`, `statusVersion`, pełne `amount`, `currency`, `totalRefunded`, `isFullRefund`
oraz `payment.statusAfter`. Zmiana statusu nie oznacza kolejnej korekty faktury;
dane VAT dotyczą `refund.issued`. Rejestr zmian i unikalny klucz dostawy na
endpoint/wersję eliminują identyczne potwierdzenia. Odbiorca powinien zachować
najwyższe `statusVersion` dla ID zwrotu i pomijać starsze wersje, ponieważ dostawy
i ponowienia mogą nadejść w innej kolejności. Częściowy zwrot ustawia
`partially_refunded` w DB, API płatności, panelu i payloadzie.
`GET /api/v1/payments/{id}` zwraca `refund.id`, `refund.status` (null, jeśli nie
został zaobserwowany) i łączną kwotę `refund.amount`.

Dla `subscription.canceled` i `subscription.updated` pole `endedAt` oznacza faktyczne
`ended_at` Stripe, a `canceledAt` — moment anulowania lub złożenia takiego żądania.
`endsAt` oznacza koniec dostępu: pierwszeństwo ma `ended_at`; przy natychmiastowym
anulowaniu możliwy jest odczyt z `canceled_at`. Przy zaplanowanym anulowaniu okres
pochodzi z pozycji **opłaconej faktury**, a nie z bieżącego nieopłaconego odnowienia.
Bez potwierdzonego okresu `endsAt` ma wartość null. Zdarzenia aktualizacji zakończonej
subskrypcji lub zaplanowanego anulowania przekazują ten sam koniec dostępu w
`currentPeriodEnd`.

## Spory płatnicze

Podpisane `dispute.created` i `dispute.closed` działają dla wszystkich produktów,
niezależnie od licencji i `license.revoked`. Na istniejącym endpoincie Stripe włącz
`charge.dispute.created` oraz `charge.dispute.closed`; nowe endpointy Sellf zawierają je automatycznie.

`data.dispute` zawiera `stripeDisputeId`, `stripeChargeId`, rzeczywisty `status`
Stripe (m.in. `needs_response`, `won`, `lost`), `reason`, `amount` w najmniejszych
jednostkach, `currency` i `createdAt` (ISO 8601 UTC). `data.payment` zawiera `id`
transakcji Sellf, `sessionId`, `paymentIntentId`, `stripeInvoiceId`, `subscriptionId`,
kwotę i walutę zakupu. `data.product.id` i `data.customer.userId` / `email` wiążą
zdarzenie z produktem i klientem. Dla subskrypcji dochodzi `data.subscription.id`
oraz `stripeSubscriptionId`, jeśli jest dostępny.

`accessRevoked` i `accessRestored` opisują wynik zapisanej obsługi sporu.
Otwarcie i przegrany spór zawieszają dostęp. Po `won` płatność wraca do wcześniejszego
stanu (`completed` lub `partially_refunded`), a uprawnienie wraca z zachowanym terminem.
`accessRestored: true` oznacza rzeczywiście przywrócony dostęp; pełny zwrot,
ręczne usunięcie grantu, upływ terminu lub zakończenie subskrypcji blokują odtworzenie.
Gość odzyskuje oryginalny nieodebrany zakup. Zapisany termin obowiązuje również przy
późniejszym odebraniu, także po zmianie czasu dostępu w produkcie. Ponowienie zdarzenia nie przedłuża terminu.
Wygrana usuwa również odwołanie licencji zapisanych jako cofnięte przez ten spór.
`licenseRestored` i `restoredLicenses` opisują faktycznie zmienione licencje, z tym samym
tokenem i terminem. Ręczne cofnięcie lub zwrot blokują przywrócenie. Licencje cofnięte
przed wprowadzeniem zapisu pochodzenia nie są przywracane automatycznie. Odbiorca powinien używać flagi
`accessRestored` oraz `payment.statusAfter`, a nie samego wyniku `won`.
`dispute.restoredAccess` wymienia faktycznie przywrócone uprawnienia: `productId`,
`userId` (null dla gościa), `grantedAt` i `expiresAt` (null dla dostępu bezterminowego).
Dla gościa dochodzi `guestPurchaseId`. Odbiorca powinien zastosować tę listę:
ręcznie usunięty grant głównego produktu może pozostać nieobecny, gdy dostęp do dodatku wróci.

## `license.revoked` / `license.restored` — Pro

Każda rzeczywista zmiana stanu odwołania tworzy trwałe powiadomienie. Powtórzenie
niezmienionego statusu nie dodaje zdarzenia. Subskrypcja i wysyłka obu typów wymagają
funkcji Pro; sam stan licencji zmienia się niezależnie od bieżącego planu sklepu.

Dane obejmują `license.id`, `order`, `email`, `tier`, `domain`, `issuanceSource`,
`issuedAt`, `expiresAt`, `revokedAt`, produkt i `crlUrl`. Przywrócenie dodaje
`license.restoredAt`, a powiązany spór — `dispute.stripeDisputeId`. Token nie jest
wysyłany. Po usunięciu odwołania można używać tego samego tokenu; wygasły pozostaje wygasły.

Po każdym zdarzeniu usuń lokalny cache odpowiedniego zakresu CRL, pobierz aktualną
listę i sprawdź podpis oraz pierwotny termin tokenu. Endpoint CRL zwraca
`Cache-Control: no-store`. Przywrócenie nie przedłuża terminu. Aby licencja pozostała
cofnięta także po wygraniu sporu, wybierz **Pozostaw licencję cofniętą** w ustawieniach
wydanych licencji. Cofnięcia ze starszych wersji nie mają zapisanego powiązania ze
sporem i wymagają osobnej decyzji sprzedawcy.

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

## Kontrakt zamówienia i dostępu

Każdy `purchase.completed` zawiera `data.order.orderId` (trwały UUID płatności Sellf) i `orderNumber`,
zarówno dla Stripe, jak i przelewu. `sessionId` i `paymentIntentId` pozostają identyfikatorami
operatora; nie zastępują UUID obsługiwanego przez `GET /api/v1/payments/{id}`. Szczegóły płatności
zawierają również operatora, numer zamówienia, termin, instrukcje przelewu, dane zamówienia,
pozycje oraz podsumowanie kuponu i faktury dostępne na liście płatności.

`purchase.completed` oraz `order.placed`, `order.cancelled`, `order.overdue`, `order.abandoned`
mają `data.amountUnit = "minor"`. Wszystkie zdefiniowane kwoty są w najmniejszych jednostkach waluty:
`order.amount/grossTotal/netTotal/taxTotal`, `price/net/tax/gross` produktu, dodatków i składników
pakietu oraz `lines[].unit_price/total_price/discounted_total/net_amount/tax_amount/gross_amount`.
Cena jednostkowa nadal opisuje jedną sztukę; snapshot VAT i suma zamówienia uwzględniają ilość.
Dla PLN/USD mnożnik wynosi 100, a JPY nie ma części ułamkowej. Ilość i procent VAT nie są kwotami.
Te jednostki webhooków różnią się od zapisanych cen pozycji zwracanych przez API płatności v1.

Zamówienie zawsze podaje `taxSnapshotStatus`: `none`, `captured`, `partial`, `unavailable` lub `local`.
Nieznane netto/VAT mają wartość `null`, zamiast zmyślonego zera. `grossTotal` to zapisana kwota
płatności. `vatRate` jest procentem albo `null`; `unavailable` nie oznacza zwolnienia z VAT.

Zdarzenia przelewu `order.*` zawierają `access.policy` (`on_placement` albo `after_payment`)
i `access.grants[]`: `productId`, `status`, `grantedAt`, `expiresAt`. Stany to `granted`,
`pending_confirmation`, `pending_payment`, `expired` albo `revoked`. Daty pochodzą z zapisanego dostępu;
dla oczekującego grantu nie zostały jeszcze nadane. `null` końca nadanego dostępu oznacza dostęp bezterminowy.

| Zdarzenie | Dane potrzebne odbiorcy |
|---|---|
| `order.abandoned` | Porzucona oczekująca płatność: ID zamówienia i operatora, stary/nowy stan, klient, kwota i VAT. |
| `seats.held` | Rezerwacja miejsc: ID rezerwacji, zamówienia, produktu, terminu/progu cenowego, data i liczba miejsc. |
| `seats.confirmed` | Potwierdzenie miejsc: te same identyfikatory oraz poprzedni i nowy stan. |
| `seats.released` | Zwolnienie miejsc: te same dane i powód (`order_abandoned`, `order_cancelled`, `payment_refunded`, `hold_expired`, `reservation_released`). |
| `access.granted` | Nadanie dostępu, również darmowego, po zakupie oraz po przejęciu zakupów gościa. |
| `access.updated` | Zmiana zapisanych dat lub źródła dostępu, również ręczne przedłużenie. |
| `access.revoked` | Usunięcie grantu wraz z faktycznym czasem odebrania. |
| `access.expired` | Upłynięcie zapisanego końca dostępu: jeden komunikat na grant/datę końca, także po odnowieniu. |

### Nieopłacone zamówienia przelewem: cykl życia

Każde zdarzenie przelewu `order.*` ma w `data.order` dodatkowo: `status`, `payUrl` (podpisany link do strony
zamówienia: stan, dane przelewu, przycisk „Wysłałem przelew”, ważny do `payUrlExpiresAt`), `reservation`
(`timed` — rezerwacja czasowa, `invoice` — faktura wystawiona, czeka na płatność bez wygasania, `none`),
`reminderAt`, `releaseAt`, `invoiceHoldAt`, `transferDeclaredAt`, `transferDeclaredNote`, `cancelReason`,
`reopenedAt`, a `data.customer.locale` podaje język kupującego (`pl`/`en`). Z tych pól integrator wystawia
u siebie proformę, fakturę lub własny mail (n8n, Listmonk). Każde zdarzenie jest dostarczane raz na zamówienie.

| Zdarzenie | Kiedy | Co odbiorca może zrobić |
|---|---|---|
| `order.placed` | Złożenie zamówienia na przelew. | Potwierdzenie z `payUrl`; `releaseAt` to termin rezerwacji wydarzenia. |
| `order.payment_reminder` | Minął `reminderAt` (domyślnie 24 h) bez wpłaty i bez faktury. | Przypomnienie „zapłać do `releaseAt`” z linkiem. |
| `order.transfer_declared` | Kupujący kliknął „Wysłałem przelew” (raz). | Sprawdzenie wyciągu; `releaseAt` jest już przedłużone (domyślnie o 72 h). |
| `order.invoice_issued` | Dla nieopłaconego zamówienia wystawiono fakturę (w Sellf albo `POST /api/v1/payments/:id/invoice-issued`). | Status „faktura wystawiona, czeka na płatność”: `reservation = invoice`, `releaseAt = null`, brak wygasania. |
| `order.cancelled` | Anulowanie: `cancelReason = payment_window_expired` (automatycznie po `releaseAt`) albo `admin`. | Informacja dla kupującego, korekta faktury; `lateTransferPolicy = admin_decision`. |
| `order.overdue` | Minął termin płatności zamówienia bez rezerwacji czasowej. | Ponaglenie. |
| `order.reopened` | Administrator przyjął przelew, który doszedł po anulowaniu (po cenie z zamówienia, także ponad limit miejsc). | Powiązanie wpłaty: `previousStatus = cancelled`; zaraz po nim `purchase.completed`. |
| `order.participants_updated` | Kupujący uzupełnił listę uczestników po zapłacie (opcja produktu „uzupełnię później”). Wysyłane raz na zamówienie. | `orderDetails.participants.people` zawiera pełną listę (`first_name`, `last_name`, `email`), `orderDetails.quantity.value` liczbę; `purchase.completed` miało pustą listę. |

Rezerwacja czasowa dotyczy wydarzeń i jest ustawiana przez sprzedawcę (Ustawienia → Płatności → Przelew
tradycyjny). Zwykłe produkty nie wygasają. Zaplanuj `/api/cron?job=transfer-reservations` co 5 minut.

Zdarzenie dostępu podaje `customer`, `product`, `access.id`, `grantedAt`, `expiresAt`,
`statusBefore/statusAfter`, `reason` i `actor` (`user`, `api_key` albo `system`; dla systemu ID jest null).
Pola główne `accessGrantedAt/accessExpiresAt` zawierają te same zapisane daty.
`sourceOrders` zawiera powiązane zapisane zamówienia; `sourceOrder` jest wypełnione tylko przy jednym
jednoznacznym zamówieniu. Ręczne lub niepowiązane granty mogą nie mieć zamówienia. `occurredAt`
opisuje zmianę, a timestamp koperty przygotowanie dostawy. Nie należy wyliczać dostępu ze stanu
płatności ani z chwili odebrania webhooka — służą do tego jawny stan i zapisane daty.

Zmiany są zapisywane transakcyjnie i trafiają do podpisanej kolejki ze stabilnym kluczem.
Ponowienie zachowuje ID dostawy — odbiorca deduplikuje po tym ID. Długotrwały proces produkcyjny
obsługuje zmiany i wygaśnięcia co 30 sekund; build i testy nie uruchamiają tego harmonogramu.
W środowisku serverless trzeba zaplanować uwierzytelniony `/api/cron?job=business-events`.
Dotychczasowe zadanie `access-expired` korzysta z tego samego producenta. Zadanie ponowień dostaw
webhooków nadal powinno być skonfigurowane na wypadek przejściowych błędów HTTP.

Kolejność dostaw pomiędzy workerami i ponowieniami nie jest gwarantowana. Stan grantu aktualizuj według `occurredAt`, pomijając starszą zmianę odebraną później.

Podstawienie `{{order_id}}` preferuje wewnętrzny UUID, gdy jest dostępny; identyfikatory operatora i dotychczasowe klucze dostaw pozostają bez zmian.

### Własne pola darmowego checkoutu

Darmowy checkout waliduje wartości według tych samych definicji produktu co płatny. Przed
wysłaniem linka wartości trafiają do prywatnego kontekstu żądania. Link zawiera losowy UUID,
a nie domenę ani inne odpowiedzi. Po potwierdzeniu kontekst jest powiązany ze zweryfikowanym
adresem klienta i produktem. Pending grant przy innym logowaniu korzysta z tego samego zapisu;
nie zależy od edytowalnego user_metadata ani nie umieszcza odpowiedzi w tokenie uwierzytelnienia.

Dostęp zachowuje `custom_field_values`, a `access.*` i `lead.captured` podają znormalizowany
snapshot jako `customFieldValues`. Zapis trafia do wystawiania licencji, także dla
`_sellf_license_domain`. Ponowne potwierdzenie zachowuje klucz `free_<userId>_<productId>`
i dotychczasowy token licencji. Konteksty oczekujące mają ważność 30 dni; przejęte są czyszczone
po jednym dniu, lecz snapshot w grancie pozostaje.

Ręczne wystawianie również respektuje definicję produktu: pole domeny wymagane musi być
wypełnione, opcjonalne może zostać pominięte, a produkt bez takiego pola otrzymuje token bez
`claims.domain`. Brak wymaganych wartości zwraca HTTP 400 przed podpisaniem.

## Zgłoszenia PlayerStack

[Formularze potwierdzane mailem i zgoda marketingowa](/pl/playerstack-leads/).
