---
title: Przerwa w działaniu
description: Wstrzymaj sklep i nowe płatności na czas planowanej przerwy albo aktualizacji; panel administratora i webhooki Stripe działają dalej.
---

Przerwa w działaniu (tryb serwisowy) zatrzymuje sklep. Gdy jest włączona:

- strona główna sklepu, strony produktów, koszyk, osadzony koszyk i login wall pokazują
  **„Przerwa techniczna, wracamy wkrótce”** po polsku albo po angielsku (według adresu, ciasteczka
  języka albo przeglądarki), z Twoim opcjonalnym komunikatem i przewidywanym końcem. Strona
  odpowiada kodem HTTP `503` z nagłówkiem `Retry-After`, więc wyszukiwarki i przeglądarki wrócą później;
- nie da się rozpocząć nowej płatności: `/api/create-payment-intent`, `/api/embed/*`,
  `/api/orders/bank-transfer`, `/api/orders/{id}/pay`, odbiór darmowych produktów, kupony i dodatki
  do zamówienia odpowiadają `503` z `{ "code": "MAINTENANCE", "maintenance": { "message", "expected_end_at" } }`.

Poza tym nic się nie zmienia. Produkty i ustawienia zostają bez zmian, możesz zalogować się do panelu,
API v1 działa, kupujący otwierają swoje konta, a webhooki Stripe są przyjmowane: płatność zrobiona
przed przerwą (albo dokończona w już otwartym formularzu Stripe) realizuje się normalnie, a strona
powrotu po płatności działa.

## Dwa źródła

Przerwa jest włączona, gdy włączone jest **którekolwiek** źródło. Źródło na serwerze ma pierwszeństwo.

| Źródło | Kto przełącza | Działa, gdy baza leży | Kończy się, gdy |
|---|---|---|---|
| Plik `MAINTENANCE` na serwerze (albo `SELLF_MAINTENANCE=true`) | skrypt aktualizacji albo Ty na serwerze | tak | plik zostanie usunięty (albo zmienna usunięta i aplikacja uruchomiona ponownie) |
| Przełącznik w bazie | Ustawienia → System → Przerwa w działaniu albo API v1 | nie | go wyłączysz |

**Plik na serwerze.** Sellf szuka pliku `MAINTENANCE` obok `.env.local` w instalacji standalone
(`<stack>/admin-panel/MAINTENANCE`, np. `/opt/stacks/sellf-tsa/admin-panel/MAINTENANCE`), a w innych
instalacjach w katalogu roboczym aplikacji; `SELLF_MAINTENANCE_FILE` ustawia inną ścieżkę. Plik jest
sprawdzany przed jakimkolwiek zapytaniem do bazy, więc działa też wtedy, gdy baza leży, trwa
aktualizacja albo przywracanie kopii. Może być pusty, zawierać zwykły tekst dla odwiedzających
albo JSON `{ "message": "…", "expected_end_at": "2026-11-17T14:00:00Z" }`.

```bash
touch /opt/stacks/sellf-tsa/admin-panel/MAINTENANCE   # włącz
rm /opt/stacks/sellf-tsa/admin-panel/MAINTENANCE      # wyłącz
```

W Dockerze i innych wdrożeniach bez dostępu do pliku ustaw `SELLF_MAINTENANCE=true` i uruchom
aplikację ponownie.

**Przełącznik w bazie.** W **Ustawienia → System → Przerwa w działaniu** wpisz opcjonalny komunikat
(najwyżej 500 znaków) i przewidywany koniec, a potem kliknij **Włącz przerwę w działaniu**. Sekcja
pokazuje, które źródło jest włączone; przy pliku na serwerze podaje jego ścieżkę i polecenie, które
go usuwa. Każda zmiana trafia do dziennika audytu razem ze zmianą, w jednej transakcji bazy danych.

## Podczas aktualizacji

Aktualizacja z panelu (Ustawienia → System) tworzy plik tuż przed zatrzymaniem działającej wersji
i usuwa go, gdy nowa wersja działa, a także gdy przywraca poprzednią wersję albo kończy się wcześniej.
Plik utworzony przez Ciebie zostaje bez zmian.

Gdy aktualizacja nie wie, czy migracje bazy zostały zastosowane (`migration_state_unknown`), plik
zostaje: sklep nie przyjmuje zamówień, nawet jeśli ktoś uruchomi aplikację, dopóki baza nie zostanie
sprawdzona. Komunikat aktualizacji podaje ścieżkę pliku; udana ponowna aktualizacja go usunie,
w przeciwnym razie usuń go sam.

## API v1

| Metoda | Ścieżka | Zakres | Opis |
|---|---|---|---|
| GET | `/api/v1/system/maintenance` | `system:read` | Aktualny stan, jego źródło (`file`, `env`, `database`), ścieżka pliku na serwerze |
| PATCH | `/api/v1/system/maintenance` | `system:write` | `{ "enabled": true, "message": "…", "expected_end_at": "…" }` przełącza źródło w bazie; `{ "enabled": false }` wyłącza i czyści komunikat |

Przewidywany koniec musi być w przyszłości (inaczej `400`). Źródła na serwerze nie da się przełączyć
przez API; odpowiedź mówi, że jest włączone (`source: "file"`), i gdzie leży plik.
