---
title: "Wdrożenie Sellfa na Coolify"
description: "Coolify to platforma PaaS do zarządzania aplikacjami na Twoich własnych serwerach. Dostępna w dwóch wariantach:"
---

Włącz **Confirm Email** w Supabase i zainstaluj oba szablony: confirmation oraz magic-link. Zakupy gościa trafiają na konto po potwierdzeniu adresu użytego przy zakupie. Zobacz [konfigurację e-maili](/pl/email-setup/#włącz-potwierdzanie-adresów-e-mail).


**Język:** 🇵🇱 Polski · [🇬🇧 English](/deployment-coolify/)


Coolify to platforma [PaaS](https://pl.wikipedia.org/wiki/Platforma_jako_us%C5%82uga) do zarządzania aplikacjami na Twoich własnych serwerach. Dostępna w dwóch wariantach:

| | Coolify Self-Hosted | Coolify Cloud |
|---|---|---|
| Gdzie działa dashboard Coolify | Na Twoim VPS | Na serwerach Coolify |
| Gdzie działa Twój sklep Sellf | Na Twoim VPS (tym samym co Coolify albo osobnym) | Na Twoim VPS (podpiętym do Cloud dashboardu) |
| Koszt | Zawsze darmowy | $5/mies za 2 serwery + $3/mies za każdy dodatkowy |
| Zarządzasz | Coolify + aplikacjami + serwerami | Tylko aplikacjami + serwerami (Coolify sam się aktualizuje) |
| Backupy, alerty, auto-update | Sam ogarniasz | W cenie |
| Dla kogo | Majsterkowicze, pełna kontrola, zero stałych kosztów | Chcesz zarządzane Coolify ale wciąż własne dane i sprzęt |

**Wspólne dla obu:** Twój sklep Sellf zawsze działa na VPS-ie który **Ty** wynajmujesz (Hetzner, DigitalOcean, Contabo itd.). Coolify Cloud nie hostuje Twoich aplikacji — hostuje tylko panel sterowania. Więc obie opcje wymagają serwera z wystarczającym RAM-em (zobacz Wymagania niżej).

Ten przewodnik pokrywa oba tryby. Wybierz jeden i podążaj za krokami tylko dla tego trybu tam gdzie się różnią.

## Czemu w ogóle wybrać Coolify?

Wybierz Coolify jeśli:
- Chcesz wszystko na własnej infrastrukturze (bez Supabase Cloud, bez Vercela)
- OK Ci self-hostować Postgresa (i własne backupy, w trybie self-hosted Coolify)
- Chcesz "deploy and forget" — Coolify obsługuje auto-renew TLS, automatyczne redeploy na `git push`, restarty kontenerów
- Masz (albo chcesz wynająć) VPS z **4 GB+ RAM**. Sam Sellf działa z **gotowego, opublikowanego obrazu** (`ghcr.io/jurczykpawel/sellf`) — Coolify go pobiera, a nie buduje, więc nie ma lokalnego builda Next.js który mógłby zabić OOM. To Supabase (jeśli hostujesz go sam obok Sellfa) zajmuje większość RAM-u — zaplanuj odpowiednio.

Wybierz **Coolify Cloud** jeśli chcesz wszystkiego powyżej PLUS wolisz nie uruchamiać dashboardu Coolify samemu (auto-aktualizacje, backupy, alerty mailowe załatwione za Ciebie, ~$5/miesiąc).

Wybierz **Coolify Self-Hosted** jeśli chcesz zero powtarzających się opłat za oprogramowanie (i tak płacisz dostawcy VPS) ORAZ jesteś komfortowy z utrzymywaniem UI zarządzania Coolify samemu (`docker compose pull && restart` raz na miesiąc).

Nie wybieraj Coolify jeśli pasują Ci bardziej:

- **Hosting na free tier:** Coolify i tak wymaga VPS-a, ~$5-10/miesiąc minimum. Zobacz [DEPLOYMENT-VERCEL-NETLIFY.md](/pl/deployment-vercel-netlify/) — Vercel + Supabase Cloud mają darmowy plan.
- **Najmniejszy możliwy footprint:** zobacz [DEPLOYMENT-MIKRUS.md](/deployment-mikrus/) — sam Sellf chodzi na 35 zł/rok mikr.us bez Dockera.

## Najkrótsza ścieżka — użyj instalatora StackPilot

[`install-coolify.sh`](https://github.com/jurczykpawel/stackpilot/blob/main/apps/sellf/install-coolify.sh) ze StackPilot automatyzuje cały ten przewodnik (celuje w Supabase Cloud, nie samodzielnie hostowany Supabase — zobacz "Self-hosting Supabase też" niżej, jeśli chcesz obu na Coolify). Dwa style wywołania zależnie od tego którego wariantu Coolify używasz:

**Coolify Self-Hosted (domyślnie):**

```bash
./apps/sellf/install-coolify.sh \
    --ssh-host <alias-vps> \
    --repo-path /sciezka/do/sellf
```

Skrypt instaluje Coolify na targecie (jeśli go nie ma), rejestruje admina, generuje token API, tworzy aplikację, ustawia zmienne, aplikuje migracje bazy i tworzy webhook Stripe.

**Coolify Cloud:**

```bash
./apps/sellf/install-coolify.sh \
    --coolify-cloud \
    --coolify-token <twoj-token-api> \
    --server-uuid   <uuid-serwera-juz-dodanego-do-cloud> \
    --repo-path /sciezka/do/sellf
```

Dla Cloud zrobiłeś już jednorazową konfigurację w Coolify Cloud (rejestracja, dodanie serwera, wygenerowanie tokenu API). Skrypt tworzy tylko projekt + aplikację + zmienne + webhook Stripe przeciwko `https://app.coolify.io/api/v1/...`.

Jeśli wolisz ręczny flow, albo chcesz też samodzielnie hostować Supabase (nie tylko Sellfa), użyj kroków poniżej.

## Krok 1 — Uruchom Coolify

### Tryb A: Self-hosted (zainstaluj Coolify na VPS)

Jeśli nie masz jeszcze Coolify na VPS, zainstaluj na Debian/Ubuntu:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

Po instalacji otwórz `http://<ip-twojego-vps>:8000` i przejdź przez pierwszy kreator (admin email + hasło). Kreator automatycznie doda host VPS jako Twój pierwszy "serwer".

Pełna dokumentacja Coolify: https://coolify.io/docs/installation

### Tryb B: Coolify Cloud (zarejestruj się + podłącz serwer)

1. Zarejestruj się na https://app.coolify.io
2. Wybierz plan ($5/miesiąc za 2 serwery wystarczy na jednego Sellfa + zapas)
3. W dashboardzie Cloud kliknij **Servers → New Server**
4. Coolify da Ci publiczny klucz SSH. Dodaj go do `~/.ssh/authorized_keys` na swoim VPS-ie (Coolify Cloud musi mieć SSH do VPS-a żeby wdrażać tam aplikacje)
5. Wpisz IP swojego VPS-a w formularzu i kliknij **Validate**
6. Po walidacji serwer jest gotowy do wdrożeń

Dla reszty przewodnika URL dashboardu Coolify to `https://app.coolify.io` (Cloud) zamiast `http://<ip-twojego-vps>:8000` (Self-Hosted). Wszystkie inne kroki działają identycznie — to samo UI, to samo API.

## Krok 2 — Zdobądź projekt Supabase

Sellf potrzebuje projektu Supabase, z którym będzie rozmawiał. Dwie opcje na Coolify:

**Opcja A — Supabase Cloud (najprościej):** stwórz darmowy projekt na
https://supabase.com i przejdź do Kroku 3. Bez dodatkowego zasobu w Coolify.

**Opcja B — Samodzielny hosting Supabase na tej samej instancji Coolify:**

1. **Projects → New Project** → nazwij `sellf` (albo użyj istniejącego projektu)
2. W projekcie **New Resource → Service → Supabase** — to własny szablon
   one-click Coolify dla oficjalnego, samodzielnie hostowanego stosu
   Supabase. Jego magiczne zmienne `SERVICE_*` same generują sekret JWT
   oraz klucze `anon`/`service_role` — bez ręcznego podpisywania JWT.
3. Wdróż go, potem otwórz zakładkę **Environment Variables** tego zasobu i
   skopiuj wygenerowane `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   (Coolify może je nazwać `SERVICE_SUPABASEANON_KEY` /
   `SERVICE_SUPABASESERVICE_KEY` — sprawdź dokładne nazwy w swojej wersji
   Coolify) oraz publiczny URL jaki Coolify mu przydzielił
   (`SERVICE_URL_SUPABASEKONG` albo podobny).
4. **Skonfiguruj szablony maili magic link zanim pójdziesz dalej** —
   domyślne szablony GoTrue nie niosą `token_hash`, którego wymaga
   `/auth/callback` Sellfa. Dodaj do zmiennych zasobu Supabase:
   ```env
   GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=https://<twoja-domena-sellf>/auth-email-templates/magic-link.html
   GOTRUE_MAILER_TEMPLATES_CONFIRMATION=https://<twoja-domena-sellf>/auth-email-templates/confirmation.html
   GOTRUE_MAILER_TEMPLATES_RECOVERY=https://<twoja-domena-sellf>/auth-email-templates/recovery.html
   GOTRUE_MAILER_TEMPLATES_INVITE=https://<twoja-domena-sellf>/auth-email-templates/invite.html
   GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE=https://<twoja-domena-sellf>/auth-email-templates/email-change.html
   GOTRUE_URI_ALLOW_LIST=https://<twoja-domena-sellf>/*
   ```
   (Te szablony są częścią Sellfa i są serwowane jako statyczne pliki przez
   sam kontener Sellf — zobacz [full-stack.md](/full-stack/#part-2--magic-link-email-templates)
   po pełne wyjaśnienie.) Skonfiguruj też SMTP w tym zasobie, jeśli
   jeszcze tego nie zrobiłeś (szablon Supabase w Coolify wystawia zwykłe
   zmienne `SMTP_*`).
5. Szablon Supabase w Coolify potrafi być kilka miesięcy w tyle za
   wydaniami upstream Supabase — to własny szablon zespołu Coolify,
   niekontrolowany przez Sellfa.

## Krok 3 — Wdróż Sellfa

1. W tym samym projekcie: **New Resource → Docker Compose**
2. Wskaż na główny `docker-compose.yml` z repo Sellfa:
   - **Git Repository:** `https://github.com/jurczykpawel/sellf`
   - **Branch:** `main`
   - **Compose File Location:** `docker-compose.yml`
3. Wypełnij zmienne środowiskowe jakie Coolify odczyta z pliku compose:
   ```env
   SUPABASE_URL=<URL Supabase z Kroku 2>
   SUPABASE_ANON_KEY=<z Kroku 2>
   SUPABASE_SERVICE_ROLE_KEY=<z Kroku 2>
   # Tylko jeśli SUPABASE_URL powyżej to wewnętrzny adres sieci Coolify,
   # a nie publiczny:
   # PUBLIC_SUPABASE_URL=<publiczny URL który dobija do tej samej bramy Supabase>
   SITE_URL=https://<twoja-domena-coolify-app>
   CHECKOUT_BINDING_SECRET=<openssl rand -base64 32>
   APP_ENCRYPTION_KEY=<openssl rand -base64 32>
   LOGINWALL_SECRET=<openssl rand -hex 32>
   STRIPE_SECRET_KEY=sk_test_…                # albo sk_live_… dla produkcji
   STRIPE_PUBLISHABLE_KEY=pk_test_…
   # STRIPE_WEBHOOK_SECRET — zostaw puste; zarejestrujesz webhook z panelu
   # admina w Kroku 4, signing secret wyląduje w bazie.
   ```
4. Kliknij **Deploy**. Coolify pobiera opublikowany obraz — bez builda, więc
   to zajmuje poniżej minuty po ściągnięciu warstw obrazu.
5. **Uruchom migracje raz** — to ręczny krok, nie dzieje się automatycznie
   przy restarcie. Z własnej maszyny (z zainstalowanym CLI `supabase`) albo
   z powłoki wewnątrz kontenera Sellfa:
   ```bash
   npx supabase db push --db-url "postgresql://postgres:<haslo>@<host-supabase>:5432/postgres"
   ```
   Powtórz to przy każdej aktualizacji Sellfa do wersji z nowymi migracjami,
   przed albo zaraz po redeployu.

## Krok 4 — Rejestracja + webhook Stripe (1 min, 1 klik)

Po deployu Twoja aplikacja jest pod `https://<twoja-coolify-domena>`.

1. Otwórz URL → zarejestruj się emailem → kliknij magic link ze skrzynki. **Pierwszy zarejestrowany użytkownik automatycznie staje się adminem.**
2. W panelu admina otwórz **Settings → Payments** (albo `/dashboard/settings`).
3. **Karta API keys:** wklej Stripe Publishable Key i Secret Key. Zapisywane zaszyfrowane w bazie Supabase.
4. **Karta Stripe Webhook:** kliknij **Register webhook**. Sellf woła Stripe za Ciebie — tworzy endpoint wskazujący na `https://<twoja-domena>/api/webhooks/stripe`, subskrybuje potrzebne eventy i zapisuje signing secret zaszyfrowany w `stripe_configurations`. Bez wizyt w Stripe Dashboard, bez env-var dance.

> **Env-config alt:** Jeśli wolisz trzymać sekrety w env varach Coolify (np. dla redeployów z CI), użyj legacy flow — stwórz webhook ręcznie na https://dashboard.stripe.com/test/webhooks, wklej `whsec_…` do `STRIPE_WEBHOOK_SECRET` w Coolify, restart. Ten sam efekt.

## Krok 5 — Własna domena + TLS

W dashboardzie Coolify:
1. Otwórz aplikację Sellf
2. **Domains → Add Domain** → wpisz własną domenę (np. `sklep.example.com`)
3. Ustaw rekord A swojej DNS na IP VPS Coolify
4. Coolify auto-provisionuje cert Let's Encrypt w ~30 sekund

**Zaktualizuj `SITE_URL`** żeby pasowała do nowej domeny, restartuj.

## Backup

Jeśli sam hostujesz Supabase na Coolify (Krok 2, Opcja B), Coolify domyślnie
nie widzi do wewnątrz jego Postgresa — skonfiguruj własne backupy:

```bash
# W dashboardzie Coolify → zasób Supabase → Backups (jeśli szablon to wystawia)
# ALBO przez cron na VPS-ie, celując w kontener db tego zasobu:
0 3 * * * docker exec <kontener-db-supabase> pg_dumpall -U postgres > /backups/sellf-$(date +%F).sql
```

Jeśli używasz Supabase Cloud (Krok 2, Opcja A), backupy są załatwione za Ciebie.

## Aktualizacja Sellf

W dashboardzie Coolify:
1. Otwórz aplikację Sellf
2. **Deployments → Redeploy** — pobiera tag obrazu skonfigurowany w
   `docker-compose.yml` (najpierw podbij `SELLF_VERSION`, jeśli chcesz
   nowsze wydanie) i restartuje kontener
3. **Uruchom ręcznie nowe migracje** (zobacz Krok 3.5) — Sellf nie
   uruchamia migracji automatycznie przy restarcie

Jeśli chcesz auto-deploy przy każdym `git push` do `main`, włącz **Webhooks → GitHub** w ustawieniach projektu Coolify (dotyczy tylko zasobu Sellfa, nie zasobu Supabase).

## Rozwiązywanie problemów

### Kontener Postgres restartuje się w pętli

Objaw: kontener db zasobu Supabase ciągle restartuje, logi mówią `FATAL: password authentication failed`.

Przyczyna: zmienna hasła Postgresa została zmieniona po pierwszym boocie. Katalog danych Postgresa został zainicjalizowany ze starym hasłem; nowe nie autoryzuje.

Fix: zatrzymaj zasób, usuń jego wolumen Postgresa, redeploy. **Niszczy wszystkie dane** — upewnij się że masz backup jeśli jesteś po pierwszym deployu.

### Sellf nie dobija do Supabase / 500 na każdej stronie

Przyczyna: `SUPABASE_URL` wskazuje na adres, do którego kontener Sellf
faktycznie nie dobije (np. wewnętrzny hostname Coolify istniejący tylko w
innej sieci Docker), albo klucze anon/service-role nie pasują do projektu
Supabase, na który wskazujesz.

Fix: z powłoki wewnątrz kontenera Sellf, `curl $SUPABASE_URL/rest/v1/` —
`401`/`200` znaczy że ścieżka sieciowa działa i problem jest w kluczach;
błąd połączenia znaczy że sam URL jest zły. Jeśli przeglądarki muszą
dobijać do innego (publicznego) adresu niż serwer, ustaw
`PUBLIC_SUPABASE_URL` (Krok 3).

### "Service quota exceeded" od Coolify

Darmowy plan Coolify pozwala na N zasobów na serwer. Sprawdź stronę cennika Coolify — jeśli przekroczyłeś, albo usuń nieużywane zasoby albo aktualizuj.

### Webhooki Stripe zwracają 400 "Missing signature"

Ten sam problem co w przewodniku Vercel/Netlify — zmienna `STRIPE_WEBHOOK_SECRET` nie pasuje do signing secret w dashboardzie Stripe. Skopiuj ponownie i zrestartuj kontener.

---

## Czemu to nie jest jeszcze opublikowane jako "Coolify Template"

Coolify wspiera szablony one-click z marketplace dla pojedynczej aplikacji.
Sam obraz Sellfa nadaje się do tego trywialnie (to jeden kontener, jeden
plik compose, kilka zmiennych) — trudniejsza część to fakt, że
*kompletne* doświadczenie one-click potrzebuje drugiego zasobu (Supabase)
połączonego z pierwszym, a format szablonów Coolify nie ma jeszcze
czystego sposobu na wyrażenie "wdróż zasób A, potem podaj jego
wygenerowany output do zmiennych zasobu B" pomiędzy dwoma osobnymi
definicjami szablonów. Do czasu aż to się pojawi, dwa ręczne zasoby z tego
przewodnika (Krok 2 + Krok 3) to praktyczna ścieżka.

Jeśli ktoś chce wnieść połączony szablon albo "compose group" Coolify
spinający oba, byłby mile widziany — otwórz issue.
