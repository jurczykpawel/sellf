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
fallbacku.

Od 2026.11.1 wszystkie brakujące migracje wydania idą jednym wywołaniem RPC, więc
PostgreSQL stosuje je w jednej transakcji. Jeśli którykolwiek plik się nie uda, nie
zostaje żaden z nich ani żaden wpis w rejestrze migracji. Panel podaje nazwę pliku
i błąd bazy, a poprzedni kod wraca na miejsce, zanim nowy wystartuje.
Każdą odpowiedź na wysłane żądanie migracji, także komunikat o błędzie, aktualizator
sprawdza w rejestrze migracji (`supabase_migrations.schema_migrations`). Odpowiedź
mogła zaginąć albo przyjść od serwera pośredniczącego już po zatwierdzeniu zmian.
Bez pytania bazy powrót poprzedniego kodu następuje tylko wtedy, gdy żądanie w ogóle
nie wyszło z serwera.

| Co pokazuje rejestr | Co robi aktualizator |
|---|---|
| wszystkie migracje wydania | uruchamia nową wersję |
| żadnej, przy dwóch odczytach w odstępie 15 s | przywraca poprzedni kod |
| tylko część, albo odpowiedzi nie da się odczytać jako listy wpisów | zostawia aplikację zatrzymaną z kodem `migration_state_unknown` |

W ostatnim przypadku nie wiadomo, czy migracje weszły, więc nie startuje ani stara,
ani nowa wersja. Panel mówi to po polsku i podpowiada, co sprawdzić w rejestrze
i co zrobić dalej; dokładny zakres wersji i katalog z poprzednim kodem podaje log
aktualizacji. Pusta lub nieczytelna odpowiedź rejestru nie dowodzi, że baza się nie
zmieniła.

Od zatrzymania działającej wersji do uruchomienia nowej sklep pokazuje stronę przerwy technicznej:
aktualizator tworzy `<stack>/admin-panel/MAINTENANCE` i usuwa go po sukcesie, po przywróceniu
poprzedniego kodu i przy wcześniejszym zakończeniu. Po `migration_state_unknown` plik zostaje, więc
sklep nie przyjmuje zamówień, nawet jeśli aplikacja zostanie uruchomiona; zobacz
[Przerwa w działaniu](/pl/maintenance/).

Zastrzeżenie: dwa odczyty w odstępie 15 s nie wykryją transakcji, która zatwierdzi
się później niż 15 s po zerwaniu połączenia. Wtedy aktualizator uznałby, że zmian
nie było, i przywrócił poprzedni kod. Jeśli po takim błędzie sklep działa
nieprawidłowo, sprawdź rejestr migracji.

Przed podmianą plików aktualizator czeka na potwierdzenie z PM2, że aplikacja się
zatrzymała. Jeśli PM2 tego nie potwierdzi, aktualizacja kończy się, zanim zmieni się
jakikolwiek plik albo baza. Jeśli nieudana próba zatrzymania jednak wyłączyła
aplikację, aktualizator uruchamia ją ponownie. Sklep działa dalej na dotychczasowej
wersji tylko wtedy, gdy PM2 potwierdzi, że proces działa. Jeśli nie potwierdzi,
panel mówi wprost: pliki i baza są bez zmian, ale nie wiadomo, czy sklep działa.
Sprawdź wtedy na serwerze `pm2 status <nazwa procesu>`, a zatrzymany proces uruchom
poleceniem `pm2 start <nazwa procesu>`.

Najnowsze wydanie jest ustalane przez przekierowanie `github.com/<repo>/releases/latest`,
a pliki wydania są pobierane z `releases/download/<tag>/`. Żadne z nich nie liczy się
do limitu API GitHuba (60 zapytań na godzinę z jednego adresu), który serwery za
wspólnym NAT-em szybko wyczerpują. Gdy GitHub odmówi albo jest nieosiągalny, panel
pokazuje komunikat GitHuba, kod HTTP, informację, że nic nie zostało zmienione i na
jakiej wersji działa sklep, oraz kiedy ponowić (z `Retry-After` albo czasu odnowienia
limitu, jeśli GitHub je poda). Brak pliku w wydaniu i zły podpis mają osobne komunikaty.

Po nieudanej próbie można od razu spróbować ponownie. Panel odmawia tylko wtedy, gdy
aktualizacja trzyma blokadę instancji, albo przez kilka sekund od uruchomienia
(podwójne kliknięcie), chyba że to uruchomienie już się nie powiodło.

Zmiany działają od aktualizacji następującej po instalacji 2026.11.1: pierwsze
przejście wykonuje jeszcze wcześniej zainstalowany aktualizator.

## Aktualizacja z 2026.10.6 lub starszej

2026.11.1 wymaga aktualizatora 2, instalowanego przez 2026.11.0. Jeśli Twoja
instalacja PM2 działa na 2026.10.6 lub starszej wersji, najpierw zainstaluj
**pakiet 2026.11.0** z aktualnego lokalnego repozytorium Stackpilot. Zastąp
`<server>` aliasem SSH serwera; przy kilku sklepach dodaj `--instance=<instance>`,
aby wybrać sklep:

```bash
curl -fL -o ./sellf-build-2026.11.0.tar.gz \
  https://github.com/jurczykpawel/sellf/releases/download/v2026.11.0/sellf-build.tar.gz
./local/deploy.sh sellf --ssh=<server> --update --build-file=./sellf-build-2026.11.0.tar.gz
```

Gdy sklep działa już na 2026.11.0, uruchom zwykłą aktualizację z panelu do
2026.11.1. W pierwszym kroku wskaż paczkę jak wyżej: samo `--update` bez
`--build-file` pobiera najnowsze wydanie, którym może już być 2026.11.1.

Na 2026.10.6 komunikat „No sellf-build.manifest asset found in latest release…”
jest spodziewany, gdy najnowsze wydanie wymaga aktualizatora 2. Stary aktualizator
zatrzymuje się przed zmianą kodu i bazy. Użyj wskazanej wyżej paczki 2026.11.0,
zamiast ponawiać tę samą aktualizację z panelu.

## Źródło informacji o wydaniach

Opcjonalna serwerowa zmienna `SELLF_UPDATE_CHECK_URL` wskazuje mirror informacji
albo lokalną atrapę w formacie JSON wydań GitHub. Domyślnie wersja pochodzi
z przekierowania github.com do ostatniego wydania; opis zmian jest dodawany, gdy
odpowie API GitHuba, a w przeciwnym razie pomijany. Limit każdego żądania to pięć sekund.
Zmienna zmienia wyłącznie powiadomienia: `upgrade.sh` nadal pobiera oficjalne
pliki i weryfikuje podpis zainstalowanym kluczem. Mirror powinien pokazywać
wyłącznie wydania istniejące na GitHub.

## Testy regresji

Uruchom `cd admin-panel && bun run test:upgrade-matrix`. Wymagania, osobne porty,
sprzątanie i ograniczenia opisuje
[README testów](https://github.com/jurczykpawel/sellf/blob/main/admin-panel/tests/upgrade-matrix/README.md).

## Zakres kopii przed aktualizacją

Aktualizator zachowuje kopię kodu aplikacji i konfiguracji, aby móc przywrócić poprzedni kod. **Nie tworzy kopii bazy i nie odtwarza bazy po udanej migracji.** Przed aktualizacją wykonaj osobną kopię bazy i sprawdź możliwość jej odtworzenia. Kopia bazy i powrót jednym przyciskiem są planowane na 2026.11.2.

2026.11.1 zawiera jedną scaloną migrację po migracjach 2026.11.0. Używaj plików z docelowego wydania. Nie kopiuj historycznych migracji rozwojowych do instalacji.

## Kandydaci do wydania

Kandydat ma wersję `2026.11.1-rc.1` (tag Git `v2026.11.1-rc.1`) i jest publikowany jako prerelease. Zwykły aktualizator w panelu śledzi stabilne wydania i odmawia instalacji RC. Na instalacji testowej wybierz konkretny pakiet RC przez `--build-file` Stackpilota albo dokładny tag obrazu kontenera. Obrazy RC nie zmieniają `latest` ani miesięcznego aliasu. Po testach zainstaluj odpowiadające wydanie stabilne zwykłą procedurą wdrożenia.

## Dla kontrybutorów

Aktualizacje bibliotek i obrazów Docker są grupowane co miesiąc, a GitHub Actions co kwartał. Obowiązuje 14 dni oczekiwania i limit jednego otwartego PR na wpis ekosystemu. Aktualizacje minor i patch bibliotek produktu trafiają do grupy; major wymaga osobnej decyzji o wydaniu. Klasyfikacja i etykiety PR nie uruchamiają automatycznego scalania. Przed scaleniem przejrzyj zmiany i uruchom odpowiednie kontrole.

Archiwa wydania i manifesty obrazów są podpisywane w osobnych zadaniach chronionego środowiska `release`. Zadania podpisujące sprawdzają manifest i tag wydania bez pobierania ani uruchamiania kodu repozytorium. Dla osób hostujących Sellf klucz, nazwy plików i sposób sprawdzania podpisu pozostają takie same. Zobacz [weryfikację wydania](/pl/deployment/).
