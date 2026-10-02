---
title: "Webhooki"
description: "Trwałe dostarczanie zdarzeń Sellf, identyfikatory dostaw i deduplikacja."
---

Sellf wysyła zdarzenia do skonfigurowanych endpointów HTTPS. Każda dostawa jest
zapisywana przed wysłaniem żądania HTTP. Nieudane próby trafiają do kolejki ponowień.

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
