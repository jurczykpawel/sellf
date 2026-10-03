---
title: "E-maile: szablony i wysyłka z własnej domeny"
description: "Skonfiguruj SMTP w Supabase, zweryfikuj domenę nadawcy, wgraj szablony Sellfa i przetestuj link logowania."
---

Maile logowania Sellfa wysyła Supabase Auth. Skonfiguruj wysyłkę **w Supabase**, również wtedy, gdy nie możesz jeszcze zalogować się do sklepu.

## 1. Dlaczego własne SMTP?

Wbudowana wysyłka Supabase służy do testów. Nadawcą jest Supabase, a nie Twój sklep. Nie ma gwarancji dostarczenia; wiadomość może trafić do spamu. Obecnie usługa wysyła tylko na adresy członków zespołu organizacji projektu, z limitem **2 wiadomości na godzinę**. Nie nadaje się do obsługi klientów. Zobacz [instrukcję SMTP Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

Własne SMTP pozwala wysyłać klientom linki logowania z Twojej domeny. Potrzebujesz adresu sklepu, dostępu do DNS domeny i danych SMTP od dostawcy poczty.

## 2. Skonfiguruj SMTP w Supabase

### Supabase Cloud

1. Otwórz projekt w [dashboardzie Supabase](https://supabase.com/dashboard).
2. Przejdź do **Authentication → Emails → SMTP Settings** i włącz **Enable custom SMTP**.
3. Wypełnij pola danymi otrzymanymi od dostawcy.
4. Kliknij **Save changes**.

| Pole w dashboardzie | Co wpisać |
|---|---|
| **Host** | Nazwę serwera SMTP dostawcy |
| **Port number** | Port wskazany przez dostawcę |
| **Username** | Nazwę użytkownika SMTP |
| **Password** | Hasło SMTP lub sekret wymagany przez dostawcę do połączenia SMTP |
| **Sender email address** | Adres w zweryfikowanej domenie, np. `login@twoj-sklep.pl` |
| **Sender name** | Nazwę Twojego sklepu |

Sekrety wpisuj bezpośrednio w dashboardzie, nigdy na czacie z AI. Nazwy pól sprawdzono w [formularzu SMTP Supabase](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Auth/SmtpForm/SmtpForm.tsx), a ścieżkę menu w [checkliście produkcyjnej](https://supabase.com/docs/guides/deployment/going-into-prod).

Po włączeniu własnego SMTP początkowy limit wynosi **30 wiadomości na godzinę**. Sprawdź **Authentication → Rate Limits** i dopasuj go do ruchu sklepu oraz limitów dostawcy. Formularz SMTP ma też pole **Minimum interval per user**; domyślny odstęp między linkami Supabase dla tej samej osoby to 60 sekund. Sellf stosuje dodatkowe limity żądań, więc nie wysyłaj wielu próśb testowych pod rząd. Zobacz [limity Auth](https://supabase.com/docs/guides/auth/rate-limits).

### Supabase / GoTrue na własnym serwerze

Ustaw te zmienne w **usłudze Supabase Auth**, nie w kontenerze Sellfa:

```env
GOTRUE_SMTP_HOST=smtp.twoj-dostawca.example
GOTRUE_SMTP_PORT=587
GOTRUE_SMTP_USER=twoj-uzytkownik-smtp
GOTRUE_SMTP_PASS=<ustaw prywatnie w swoim środowisku>
GOTRUE_SMTP_ADMIN_EMAIL=login@twoj-sklep.pl
GOTRUE_SMTP_SENDER_NAME=Twój sklep
```

Użyj rzeczywistego hosta i portu dostawcy. Oficjalny stos Docker przyjmuje w `.env` zmienne `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL` i `SMTP_SENDER_NAME`; Compose mapuje je na `GOTRUE_SMTP_*`. Sprawdź mapowanie w swoim stosie i odtwórz usługę Auth, aby wczytała zmiany. Źródła: [konfiguracja Auth](https://github.com/supabase/auth#email), [mapowanie Docker Compose](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml) i [wdrożenie pełnego stosu](/full-stack/).

### Włącz potwierdzanie adresów e-mail

W Supabase Cloud otwórz **Authentication → Sign In / Providers → Email**, włącz **Confirm Email** i zapisz. Zakupy gościa trafiają na konto po potwierdzeniu adresu, którego użyto przy zakupie.

Dla lokalnego CLI ustaw `enable_confirmations = true` w sekcji `[auth.email]` pliku `supabase/config.toml`, następnie uruchom `supabase stop` i `supabase start`. Dla powiązanego projektu Cloud przejrzyj konfigurację i zastosuj `supabase config push --project-ref <project-ref>`. `supabase db push` stosuje migracje bazy, nie konfigurację Auth. W Dockerze ustaw `GOTRUE_MAILER_AUTOCONFIRM=false` i odtwórz usługę Auth.

Wgraj oba szablony Sellfa: **Confirm sign up** (`confirmation.html`, `type=signup`) i **Magic link** (`magic-link.html`, `type=magiclink`). Nowy adres logujący się magic linkiem otrzymuje szablon confirmation. Oba linki muszą prowadzić przez `/auth/callback` z `RedirectTo`, `TokenHash` i właściwym `type`. Przetestuj nowy adres: przed kliknięciem linku brak dostępu do zakupów gościa, po kliknięciu zakupy pojawiają się na koncie. Rejestracja hasłem również wymaga linku; Google/GitHub potwierdzają adres w swoim procesie logowania.

## 3. Wybierz dostawcę poczty

Szukaj **poczty transakcyjnej przez SMTP**, weryfikacji domeny z **DKIM**, logów dostarczenia i odbić oraz limitów odpowiednich dla sklepu. Jeśli potrzebujesz przetwarzania w UE, sprawdź dostępne regiony i warunki przetwarzania danych przed wyborem.

Możesz rozważyć Resend, Postmark, Brevo, Amazon SES, Mailgun lub własny serwer pocztowy. Supabase podaje [przykłady zgodnych usług](https://supabase.com/docs/guides/auth/auth-smtp); Mailgun dokumentuje [wysyłkę SMTP](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp) i [region UE](https://help.mailgun.com/hc/en-us/articles/360007512013-Can-I-transfer-my-domain-to-another-region-US-to-EU-EU-to-US). Własny serwer oznacza samodzielne dbanie o uwierzytelnienie, reputację i dostarczalność.

Wyłącz śledzenie kliknięć dla maili uwierzytelniających: może przepisywać linki logowania. Zobacz [checklistę Supabase](https://supabase.com/docs/guides/deployment/going-into-prod).

## 4. Zweryfikuj domenę nadawcy w DNS

Dodaj domenę nadawcy u dostawcy poczty, a następnie skopiuj do panelu DNS **dokładne nazwy, typy i wartości rekordów podane przez dostawcę**.

| Ustawienie | Do czego służy |
|---|---|
| SPF | Wskazuje serwery uprawnione do wysyłania z domeny nadawcy kopertowego. |
| DKIM | Dodaje podpis wiadomości, który odbiorca sprawdza za pomocą klucza publicznego domeny. |
| DMARC | Określa raportowanie i postępowanie z mailami, które nie przechodzą uwierzytelnienia zgodnego z widoczną domeną From. |
| Return-path | Odbiera informacje o niedostarczonych wiadomościach; dostawca może używać osobnej subdomeny dla zgodności SPF. |

Rekordy SPF, DKIM i return-path otrzymasz od dostawcy; jego instrukcja DMARC pomoże wybrać politykę dla domeny. Nie zastępuj rekordów innych usług pocztowych i nie dodawaj drugiego SPF pod tą samą nazwą. Zacznij od monitorowania DMARC, jeśli nie sprawdziłeś wszystkich uprawnionych nadawców.

Poczekaj na propagację DNS, a potem użyj przycisku weryfikacji domeny u dostawcy. Pozytywna weryfikacja to pierwszy etap; rzeczywistą wiadomość sprawdzisz w kroku 7. Źródła: [weryfikacja domeny](https://resend.com/docs/dashboard/domains/introduction), [polityki DMARC](https://resend.com/blog/dmarc-policy-modes) i [własny return-path](https://resend.com/changelog/custom-return-path).

## 5. Wgraj szablony Sellfa

Użyj plików HTML z [`supabase/templates/`](https://github.com/jurczykpawel/sellf/tree/main/supabase/templates) w swojej kopii Sellfa. Tekst szablonów jest po polsku; możesz dostosować go do sklepu.

### Dashboard

Otwórz **Authentication → Emails → Templates** ([układ menu](https://github.com/supabase/supabase/blob/master/apps/studio/components/layouts/AuthLayout/AuthEmailsLayout.tsx), [dokumentacja Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)). Dla każdego szablonu wklej **cały plik HTML** do edytora treści, ustaw temat i zapisz.

| Plik | Szablon uwierzytelniania | Pole Management API |
|---|---|---|
| `magic-link.html` | Magic link | `mailer_templates_magic_link_content` |
| `confirmation.html` | Confirm sign up | `mailer_templates_confirmation_content` |
| `invite.html` | Invite user | `mailer_templates_invite_content` |
| `recovery.html` | Reset password | `mailer_templates_recovery_content` |
| `email-change.html` | Change email address | `mailer_templates_email_change_content` |

### Management API

Alternatywę opisuje [`templates/README.md`](https://github.com/jurczykpawel/sellf/blob/main/supabase/templates/README.md#opcja-2-api-management-cloud). Ustaw `SUPABASE_ACCESS_TOKEN` prywatnie w środowisku powłoki: to **token dostępu Management API**, nie klucz anon ani service-role projektu. Przed uruchomieniem zastąp `{project_ref}` i placeholder HTML:

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/{project_ref}/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mailer_templates_magic_link_content": "<treść magic-link.html zakodowana jako ciąg JSON>"
  }'
```

Powtórz dla pól i plików z tabeli. Cudzysłowy i nowe linie HTML muszą być poprawnie zakodowane w JSON — użyj narzędzia kodującego JSON zamiast wklejać surowy HTML do ciągu znaków. Endpoint i pola potwierdza [dokumentacja szablonów Supabase](https://supabase.com/docs/guides/auth/auth-email-templates).

### Adresy szablonów na własnym serwerze

GoTrue pobiera szablony przez HTTP. Ustaw poniższe zmienne w usłudze Auth i sprawdź, czy może ona odczytać te adresy. Jeśli wpisujesz je do `.env`, dodaj również mapowanie do `auth.environment` w Compose; sam wpis w `.env` nie przekazuje nowej zmiennej do kontenera. Po zmianie odtwórz usługę Auth:

```env
GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=https://twoj-sklep.pl/auth-email-templates/magic-link.html
GOTRUE_MAILER_TEMPLATES_CONFIRMATION=https://twoj-sklep.pl/auth-email-templates/confirmation.html
GOTRUE_MAILER_TEMPLATES_INVITE=https://twoj-sklep.pl/auth-email-templates/invite.html
GOTRUE_MAILER_TEMPLATES_RECOVERY=https://twoj-sklep.pl/auth-email-templates/recovery.html
GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE=https://twoj-sklep.pl/auth-email-templates/email-change.html
```

Sellf udostępnia te pliki. Jeśli adres jest niedostępny lub szablon niepoprawny, GoTrue użyje szablonu domyślnego. Zobacz [szablony self-hosted](https://supabase.com/docs/guides/self-hosting/custom-email-templates).

### Bezpieczna zmiana wyglądu

Możesz zmienić kolory, widoczny tekst, tematy i logo; dla nowego obrazka użyj pełnego adresu HTTPS. Zachowaj zmienne szablonów i linki uwierzytelniające dokładnie w dostarczonej postaci.

Szablony **magic-link i confirmation** Sellfa używają `{{ .RedirectTo }}` i `{{ .TokenHash }}`. Nie zmieniaj pisowni, wielkości liter, nawiasów, parametrów `token_hash`, `type` ani separatorów `&`. `RedirectTo` zawiera już ścieżkę callback i parametry przekazane przez Sellfa. Nie zastępuj go `{{ .SiteURL }}` ani domyślnym `{{ .ConfirmationURL }}`.

Dostarczone pliki **invite, recovery i email-change** obecnie używają `{{ .ConfirmationURL }}`. Te linki również zachowaj bez zmian; samo wgranie plików nie potwierdza działania tych osobnych procesów. Przetestuj każdy włączony proces, zanim zaczniesz na nim polegać. [Supabase opisuje znaczenie zmiennych](https://supabase.com/docs/guides/auth/auth-email-templates#terminology).

## 6. Ustaw adres sklepu i dozwolone przekierowania

W Supabase Cloud otwórz **Authentication → URL Configuration**:

1. Ustaw **Site URL** na publiczny adres sklepu, np. `https://twoj-sklep.pl`.
2. Dodaj `https://twoj-sklep.pl/**` w **Redirect URLs** i zapisz.
3. Ustaw zmienną środowiskową Sellfa `SITE_URL` na ten sam adres.

Wpis na liście dopuszcza ścieżki callback i parametry generowane przez Sellfa. Dodaj każdą domenę sklepu, której faktycznie używasz; nie dopuszczaj dowolnych domen. Supabase wyjaśnia [Site URL i działanie wildcardów](https://supabase.com/docs/guides/auth/redirect-urls).

Jeśli przekierowanie callback nie jest dozwolone, Supabase może użyć Site URL. Szablon Sellfa może wtedy wygenerować niepoprawny link, np.:

```text
https://your-shop.com&token_hash=...
```

Brakuje `/auth/callback` i początku parametrów zapytania. Najpierw sprawdź listę przekierowań, a potem poproś o **nowy** mail logowania.

**Sellf ≥ 2026.10.3 buduje linki z `SITE_URL` w czasie działania aplikacji.** Ustaw tę zmienną w uruchomionej instancji; gotowy release nie zna domeny Twojego sklepu. Nie zastępuje to ustawień Site URL i Redirect URLs w Supabase.

Dla Auth na własnym serwerze ustaw `GOTRUE_SITE_URL=https://twoj-sklep.pl` i `GOTRUE_URI_ALLOW_LIST=https://twoj-sklep.pl/**` (lub odpowiednie zmienne `.env` mapowane przez Twój stos). Zobacz [konfigurację Auth](https://supabase.com/docs/guides/self-hosting/auth/config).

## 7. Przetestuj logowanie od początku do końca

1. Otwórz `/login` w swoim sklepie i poproś o link na własną skrzynkę.
2. Sprawdź skrzynkę i spam: nazwa nadawcy i domena From powinny być Twoje.
3. Sprawdź link prywatnie. Powinien prowadzić do `/auth/callback` w Twoim sklepie z parametrami `token_hash` i `type`; nie udostępniaj aktywnego tokena.
4. Kliknij raz i potwierdź zalogowanie. Zwykłe logowanie kieruje administratorów do `/dashboard`, a pozostałych użytkowników do `/my-products`.
5. Sprawdź log dostarczenia u dostawcy i wyniki SPF, DKIM oraz DMARC w nagłówkach wiadomości.
6. Oceń spam score przy użyciu jednorazowego konta testowego i narzędzia takiego jak [mail-tester](https://www.mail-tester.com/). Mail logowania daje odbiorcy dostęp do konta, więc nigdy nie wysyłaj do zewnętrznego testera linku klienta ani administratora. Dobry wynik nie gwarantuje dotarcia do skrzynki odbiorczej.

Jeśli mail nie dociera, sprawdź weryfikację domeny i logi Supabase Auth. Jeśli link nie działa, sprawdź krok 6 oraz wgrany HTML. Pozostałe włączone procesy mailowe przetestuj osobno.

## 8. Skopiuj prompt dla agenta AI

Użyj go w Claude Code, Codex lub ChatGPT z narzędziami:

```text
Pomóż mi skonfigurować maile uwierzytelniające dla MOJEGO sklepu Sellf według https://docs.sellf.app/pl/email-setup/.

Najpierw zapytaj o adres sklepu, wersję Sellfa, identyfikator projektu Supabase (lub stos self-hosted), dostawcę poczty, dostawcę DNS, adres/nazwę nadawcy, oczekiwaną liczbę wiadomości i wymóg przetwarzania w UE. W razie potrzeby zapytaj o brakujące, niebędące sekretami dane: host, port i nazwę użytkownika SMTP.

Nigdy nie proś o wklejenie na czacie haseł, kluczy API, tokenów dostępu, kluczy service-role ani aktywnych linków logowania. Sekrety mam wpisywać bezpośrednio w dashboardzie lub prywatnych zmiennych środowiskowych. Używaj autoryzowanych narzędzi bez wypisywania sekretów; anonimizuj logi.

Sprawdź aktualną oficjalną dokumentację Supabase i dostawcy. Przeprowadź mnie przez wybór dostawcy, DNS (SPF, DKIM, DMARC, return-path), własne SMTP i limity. W Cloud użyj Authentication → Emails → SMTP Settings; w self-hosted podłącz GOTRUE_SMTP_* do usługi Auth.

Wgraj wszystkie pięć szablonów z mojej wersji Sellfa przez dashboard lub Management API albo ustaw adresy szablonów self-hosted. Zachowaj wszystkie dostarczone linki uwierzytelniające, szczególnie TokenHash i RedirectTo w magic-link/confirmation; zmieniaj tylko wygląd i widoczny tekst.

Ustaw Site URL w Supabase, dopuść https://DOMENA-MOJEGO-SKLEPU/** w Redirect URLs i sprawdź SITE_URL Sellfa (od ≥ 2026.10.3 odczytywany w czasie działania). Zdiagnozuj linki bez /auth/callback.

Przeprowadź rzeczywisty test logowania ze sklepu, sprawdzenie nadawcy/domeny i uwierzytelnienia DNS oraz test spam score na jednorazowym koncie. Pozostałe włączone procesy przetestuj osobno. Podaj zweryfikowane wyniki i to, co zostało nieprzetestowane; nie ogłaszaj sukcesu na podstawie samych ustawień.
```
