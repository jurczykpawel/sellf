---
title: "Aktualizacje z panelu administracyjnego"
description: "Aktualizacja PM2 i instrukcje wdrożenia dla kontenerów oraz hostingu zarządzanego."
---

Sellf sprawdza nowe wydania w każdym środowisku. Powiadomienie i Ustawienia → System
pokazują przycisk aktualizacji tylko dla gotowej instalacji standalone PM2.
Pozostałe środowiska nadal pokazują nową wersję oraz instrukcje wdrożenia.
API aktualizacji sprawdza tę samą możliwość co interfejs.

## Wybór środowiska

Ustaw serwerową zmienną `SELLF_DEPLOYMENT_RUNTIME`: `pm2`, `systemd`, `docker`,
`compose`, `coolify`, `vercel`, `netlify` lub `manual`. Nieznana wartość oznacza
instrukcje ręczne. Zmienna wybiera instrukcje, ale nie włącza aktualizacji w miejscu
w kontenerze ani w niekompletnej instalacji.

Bez tej zmiennej Sellf rozpoznaje kolejno Vercel (`VERCEL=1`), Netlify
(`NETLIFY=true`), Coolify (`COOLIFY_RESOURCE_UUID` / `COOLIFY_CONTAINER_NAME`),
kontener (`/.dockerenv` / `/run/.containerenv`), PM2 (`pm_id`) i systemd
(`INVOCATION_ID`). Brak rozpoznania oznacza `manual`. Dostarczony Compose wybiera
`compose`. W zasobach Coolify ustaw `SELLF_DEPLOYMENT_RUNTIME=coolify`, także przy
wdrożeniu Dockerfile albo Compose.

Aktualizacja w miejscu wymaga Linuxa, roota, działającego systemd, wykonywalnego
`/usr/bin/systemd-run`, zapisywalnej instalacji standalone z archiwum, skryptu
aktualizacji, `.env.local` oraz procesu PM2 w `/root/.pm2`. Nazwa procesu odpowiada
katalogowi stosu zawierającego `admin-panel`. Katalog roboczy aplikacji to
`<stos>/admin-panel/.next/standalone/admin-panel`. Tak działa standardowa instalacja
PM2 przez StackPilot. Instalacje ze źródeł, klastry, instalacje bez roota oraz
systemd bez PM2 korzystają ze swojej procedury wdrożenia.

## Procedura wdrożenia

Zrób kopię bazy, pobierz źródła docelowego wydania i zastosuj migracje
**przed uruchomieniem nowej aplikacji**:

```bash
bunx supabase db push --db-url '<adres-połączenia-z-bazą>'
```

Kontenery, Coolify, Vercel i Netlify **nie wykonują migracji przy starcie**.
Obraz zawiera pliki SQL, lecz jego komenda startowa uruchamia tylko Node.
Supabase jest osobną usługą, także w wariancie full-stack.

| Środowisko | Aktualizacja aplikacji |
| --- | --- |
| StackPilot standalone PM2 | Przycisk w panelu, jeśli jest dostępny. Podpisany skrypt stosuje migracje przez RPC service-role, zastępuje zapisany build, restartuje PM2 i zapisuje konfigurację. |
| Zwykły PM2 ze źródeł | Pobierz wydanie; `cd admin-panel`; `bun install --frozen-lockfile`; `bun run build`; `pm2 reload ecosystem.config.js` (pojedynczy proces: `pm2 restart ecosystem.config.js`). Użyj swojego pliku ecosystem. |
| Tylko systemd | Zbuduj wydanie jak wyżej, następnie `sudo systemctl restart <twoja-usługa-sellf>` zgodnie z katalogiem roboczym i nazwą w jednostce. |
| `docker run` | Pobierz `ghcr.io/jurczykpawel/sellf:<wersja>` i odtwórz kontener z nowego obrazu, zachowując zmienne, porty oraz sieci. Sam restart pozostawia stary obraz. |
| Compose: docker-simple / full-stack | Ustaw `SELLF_VERSION=<wersja>` w `.env`; `docker compose pull sellf`; `docker compose up -d --force-recreate sellf`. |
| Coolify | Zmień tag obrazu albo commit wydania dla builda Dockerfile i wybierz Redeploy. Dla Compose ustaw `SELLF_VERSION` i ponownie wdróż zasób. |
| Vercel | Wdróż źródła wydania z dotychczasowymi zmiennymi projektu; poczekaj na Ready i promuj wdrożenie do produkcji. |
| Netlify | Wdróż źródła wydania z dotychczasowymi zmiennymi strony; poczekaj na Published. |

Po wdrożeniu wybierz sprawdzenie aktualizacji, aby potwierdzić uruchomioną wersję.
Przy aktualizacji w miejscu panel sprawdza wersję po restarcie i zachowuje wynik
błędu skryptu. Niedostępny launcher oznacza błędne żądanie API, a nie przyjętą
aktualizację. Szczegóły niepowodzenia znajdziesz w logu aktualizacji instancji.

## Dwustopniowy aktualizator standalone

Aktualizator 2 sprawdza podpis manifestu zainstalowanym kluczem, wymaganie
`min_updater_version`, sumę i wpisy archiwum, po czym rozpakowuje je do prywatnego
katalogu tymczasowego. Następnie uruchamia `scripts/upgrade.sh` z pobranego wydania
(etap 2), zachowując token, instalację, pliki postępu i logu oraz blokadę instancji.
Panel pokazuje dotychczasowe kroki. Paczki bez etapu 2 korzystają z lokalnego
fallbacku. Błąd migracji przywraca poprzedni kod przed startem; nie cofa już
zatwierdzonych migracji bazy (transakcja RPC nadal obejmuje pojedynczy plik).

2026.11.0 wymaga aktualizatora 1, czyli niewersjonowanego skryptu 10.6. CI publikuje
podpisany trzywierszowy manifest V2 oraz dotychczasowy dwuwierszowy manifest dla
tej ścieżki przejściowej. Stary skrypt przy pierwszej aktualizacji nadal wykonuje
własne kroki. Nadpisanie jego pliku może też dać końcowy błąd powłoki po zgłoszeniu
sukcesu. Aktualny Stackpilot pozwala użyć runnera z paczki już podczas tego przejścia.
Gdy panel zgłasza zbyt stary aktualizator albo nie może zweryfikować wymagania,
ponów sprawdzanie lub uruchom w aktualnym lokalnym repozytorium Stackpilot
(zastąp `<server>` aliasem SSH serwera):

```bash
./local/deploy.sh sellf --ssh=<server> --update
```

## Źródło informacji o wydaniach

Opcjonalna serwerowa zmienna `SELLF_UPDATE_CHECK_URL` wskazuje mirror informacji
albo lokalną atrapę w formacie JSON wydań GitHub. Domyślnie Sellf korzysta z API
ostatniego wydania na GitHub. Limit żądania to pięć sekund, bez przekierowań.
Zmienna zmienia wyłącznie powiadomienia: `upgrade.sh` nadal pobiera oficjalne
pliki i weryfikuje podpis zainstalowanym kluczem. Mirror powinien pokazywać
wyłącznie wydania istniejące na GitHub.

## Testy regresji

Uruchom `cd admin-panel && bun run test:upgrade-matrix`. Wymagania, osobne porty,
sprzątanie i ograniczenia opisuje
[README testów](https://github.com/jurczykpawel/sellf/blob/main/admin-panel/tests/upgrade-matrix/README.md).
