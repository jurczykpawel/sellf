**Język:** 🇵🇱 Polski · [🇬🇧 English](../DEPLOYMENT-VERCEL-NETLIFY.md)

# Wdrożenie Sellfa na Vercel albo Netlify (one-click)

Wymagany czas: **~15 minut** jeśli masz już konta GitHub, Supabase, Stripe i Vercel/Netlify. Dodaj 5-10 minut za każde konto które trzeba założyć.

Ten przewodnik opisuje przyciski "Deploy" w README z Vercel/Netlify. Dla VPS/PM2 zobacz [DEPLOYMENT-MIKRUS.md](../DEPLOYMENT-MIKRUS.md). Dla samodzielnego Dockera zobacz [FULL-STACK.md](../FULL-STACK.md).

> **Pierwszy raz wdrażasz oprogramowanie?** Zobacz [QUICK-START.md](./QUICK-START.md) — wersję bez używania terminala, klik-po-kliku.

## Co będziesz miał na końcu

Działający sklep Sellf pod `https://twoj-projekt.vercel.app` (albo `.netlify.app`), połączony z:
- **Supabase Free** — baza danych, autoryzacja, storage (500 MB bazy, 50k MAU)
- **Stripe test mode** — przetwarzanie fałszywych płatności (`4242 4242 4242 4242`)
- **Vercel Hobby** albo **Netlify Starter** — hosting (darmowy dla użytku osobistego)

Żeby później przejść z trybu testowego na prawdziwe płatności, zamieniasz `sk_test_…` / `pk_test_…` na `sk_live_…` / `pk_live_…` i tworzysz nowy webhook na Stripe Dashboard (tryb live).

## Limity darmowych planów

| Usługa | Plan | Limity | Uważaj na |
|---------|------|--------|---------------|
| Vercel Hobby | darmowy | 100 GB transferu, 1M wywołań funkcji, 4h aktywnego CPU, 1M edge requestów, 5k transformacji obrazów, 1 seat | **Tylko do użytku osobistego, niekomercyjnego** (w praktyce rzadko egzekwowane dla małych sklepów). Twarde limity (bez nadwyżek — sklep zwraca 503 po wyczerpaniu). Dla ścisłej zgodności z regulaminem dla sklepu komercyjnego — Vercel Pro ($20/mies) — albo obejdź problem ścieżką własnego VPS (~$5/mies). Pełna tabela + niuanse w [QUICK-START.md](./QUICK-START.md#vercel-hobby--co-jest-w-darmowym-planie-i-kiedy-uderza-w-twardy-stop). |
| Netlify Starter | darmowy | 100 GB transferu, 300 minut buildów/miesiąc, 125k wywołań funkcji | Spokojnie wystarczy dla małego sklepu |
| Supabase Free | darmowy | 500 MB bazy, 1 GB storage, 50k MAU | Hojny na lata dla typowego małego sklepu. Aktualizuj do Pro ($25/mies) gdy zbliżasz się do limitu bazy lub MAU, albo chcesz codzienne automatyczne backupy. |
| Stripe test mode | darmowy | nielimitowane | Żadne prawdziwe pieniądze nie ruszają się aż przełączysz na `sk_live_…` |

---

## Krok 1 — Wygeneruj cztery sekrety lokalnie (1 min)

Sellf nie wystartuje w produkcji bez nich. Uruchom w terminalu:

```bash
echo "CHECKOUT_BINDING_SECRET=$(openssl rand -base64 32)"
echo "APP_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "LOGINWALL_SECRET=$(openssl rand -hex 32)"
```

Zachowaj wynik pod ręką — wkleisz każdą wartość do formularza w Kroku 4.

> **Po co?** `CHECKOUT_BINDING_SECRET` podpisuje HMAC wiążący sesję checkout Stripe z konkretną parą (użytkownik, produkt), blokując manipulację metadanymi. `APP_ENCRYPTION_KEY` szyfruje klucze API Stripe i GUS przechowywane w panelu admina. `LOGINWALL_SECRET` podpisuje token przekierowania dla bramki dostępu do treści per-produkt. Nigdy nie trzeba ich zmieniać chyba że podejrzewasz wyciek.

## Krok 2 — Utwórz projekt Supabase (3 min)

Masz tu dwie ścieżki. Wybierz jedną:

### Ścieżka A — integracja Vercel-Supabase (tylko Vercel, mniej pisania)

Po kliknięciu Deploya w Kroku 4 i ukończeniu wdrożenia, otwórz projekt w dashboardzie Vercel → **Storage → Connect Database → Supabase**. Vercel utworzy projekt Supabase i automatycznie wstrzyknie trzy zmienne (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — Sellf czyta wszystkie te nazwy). Wciąż musisz pobrać **project ref** + **hasło do bazy** z dashboardu Supabase do Kroku 6.

Jeśli wybierzesz tę ścieżkę, pomiń 4 zmienne Supabase w formularzu Kroku 4 i zostaw puste — Vercel je wypełni po dodaniu integracji.

### Ścieżka B — Utwórz projekt ręcznie (działa dla Vercel i Netlify)

1. Wejdź na **https://supabase.com/dashboard** i zaloguj się (GitHub działa).
2. Kliknij **New project** → wypełnij:
   - **Name:** `sellf` (albo cokolwiek)
   - **Database password:** kliknij "Generate a password" i **zapisz w menedżerze haseł** — przyda się w Kroku 6.
   - **Region:** wybierz blisko klientów (`eu-central-1` dla EU, `us-east-1` dla USA)
   - **Plan:** Free
3. Poczekaj ~2 minuty na provisioning.
4. W **Settings → API** skopiuj te trzy wartości:
   - `Project URL` → `SUPABASE_URL`
   - klucz `anon` `public` → `SUPABASE_ANON_KEY`
   - klucz `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (trzymaj w tajemnicy — omija RLS)
5. Zanotuj **project ref** (string po `/project/` w URLu, wygląda jak `abcdefghijklmn`). Przyda się w Kroku 6.

## Krok 3 — Pobierz testowe klucze API Stripe (2 min)

1. Wejdź na **https://dashboard.stripe.com/test/apikeys** i zaloguj się (albo zarejestruj — bez konta bankowego dla trybu testowego).
2. Upewnij się że przełącznik **Test mode** w prawym górnym rogu jest WŁĄCZONY.
3. Skopiuj:
   - **Publishable key** (`pk_test_…`) → `STRIPE_PUBLISHABLE_KEY`
   - **Secret key** (`sk_test_…`) → `STRIPE_SECRET_KEY` (najpierw kliknij "Reveal")
4. Pomiń webhook secret na razie — utworzysz go w Kroku 7 po istnieniu URL deploya.

## Krok 4 — Kliknij Deploy (2 min)

Z [README](../../README.md) kliknij **Deploy with Vercel** albo **Deploy to Netlify**.

Zostaniesz poproszony o autoryzację platformy w swoim GitHubie, wybór nazwy projektu i wypełnienie zmiennych środowiskowych. Wklej:

| Zmienna | Wartość |
|----------|-------|
| `SUPABASE_URL` | z Kroku 2 |
| `SUPABASE_ANON_KEY` | z Kroku 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | z Kroku 2 |
| `STRIPE_SECRET_KEY` | `sk_test_…` z Kroku 3 |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…` z Kroku 3 |
| `STRIPE_WEBHOOK_SECRET` | **placeholder na razie**: `whsec_REPLACE_AFTER_DEPLOY_xxxxxxxxxxxxxxxxxxxxxxxxxxxx` (musi być ≥16 znaków bo build nie zaakceptuje) |
| `SITE_URL` | **najlepsze zgadnięcie** na razie: `https://<twoja-nazwa-projektu>.vercel.app` albo `.netlify.app` — naprawisz w Kroku 7 jeśli źle |
| `CHECKOUT_BINDING_SECRET` | z Kroku 1 |
| `TRUSTED_PROXY` | dosłownie `true` |
| `APP_ENCRYPTION_KEY` | z Kroku 1 |
| `LOGINWALL_SECRET` | z Kroku 1 |

Kliknij **Deploy**. Build trwa 3-5 minut.

> **Uwaga:** Gdy build się skończy, URL deploya na Vercel/Netlify jest pokazany, ale aplikacja zwróci **500 na każdej stronie**. Tak ma być — baza jest pusta. Kontynuuj do Kroku 5.

## Krok 5 — Zanotuj URL deploya

Skopiuj URL który Vercel/Netlify Ci dał. Przykłady:
- `https://sellf-abc123.vercel.app`
- `https://sellf.netlify.app`

Użyjesz go w Krokach 6 i 7.

## Krok 6 — Zaaplikuj migracje bazy (3 min)

Sellf ma 46 migracji tworzących 36 tabel, 73 funkcje RPC i 92 polityki RLS. Button deploya ich nie uruchamia — Ty to robisz, raz, z lokalnego komputera.

```bash
# W świeżym terminalu, gdziekolwiek:
git clone https://github.com/jurczykpawel/sellf.git
cd sellf

# Zaloguj się do Supabase (otworzy przeglądarkę):
npx supabase login

# Połącz checkout z projektem (użyj project ref z Kroku 2):
npx supabase link --project-ref <TWOJ_PROJECT_REF>
# Spyta o hasło do bazy z Kroku 2.

# Wypchnij migracje:
npx supabase db push
```

Oczekiwany wynik: `Applying migration ... done` dla każdej z 46 migracji. Łączny czas ~1 minuta.

> **Jeśli nie chcesz instalować Supabase CLI:** otwórz https://supabase.com/dashboard/project/<ref>/sql/new, potem wklej każdy plik `.sql` z `supabase/migrations/` chronologicznie i kliknij **Run**. Dużo wolniejsze; CLI rekomendowane.

Po migracjach odśwież URL deploya. Strona powinna się załadować (już bez 500). Zobaczysz "Powered by Sellf" — to Twój żywy sklep.

## Krok 7 — Podłącz webhook Stripe (3 min)

1. Wejdź na **https://dashboard.stripe.com/test/webhooks** i kliknij **Add endpoint**.
2. **Endpoint URL:** `https://<TWOJ_URL_DEPLOYA>/api/webhooks/stripe`
3. **Events to send** — kliknij **Select events** i zaznacz minimum:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
4. Kliknij **Add endpoint**.
5. Na stronie szczegółów endpointu kliknij **Reveal** pod "Signing secret" → skopiuj wartość `whsec_…`.
6. Zaktualizuj zmienne w platformie hostującej:
   - **Vercel:** Dashboard → Twój projekt → **Settings → Environment Variables** → edytuj `STRIPE_WEBHOOK_SECRET` → wklej prawdziwą wartość. Przy okazji popraw `SITE_URL` jeśli źle zgadnąłeś w Kroku 4.
   - **Netlify:** Dashboard → Twoja strona → **Site settings → Build & deploy → Environment** → to samo.
7. Redeploy: zakładka **Deployments** → najnowszy deploy → **Redeploy**. ~1 minuta.

## Krok 8 — Smoke test (2 min)

1. Otwórz `https://<twoj-deploy>/` — strona główna Sellfa się ładuje, bez 500.
2. Kliknij **Sign up** (albo idź na `/login`) → wpisz email → submit.
3. Sprawdź skrzynkę. Domyślny SMTP Supabase ma kilkuminutowe opóźnienie i często ląduje w spamie. Kliknij magic link.
4. Powinieneś trafić na `/dashboard` jako **admin** (Sellf czyni pierwszego użytkownika adminem przez trigger `handle_new_user_registration()`).
5. Idź na **/admin/products** → **New product** → wypełnij produkt testowy z `price = 5` USD → zapisz.
6. Kliknij slug produktu żeby otworzyć stronę publiczną, potem **Buy**. Użyj testowej karty Stripe: `4242 4242 4242 4242`, dowolna przyszła data ważności, dowolny CVC.
7. Po płatności powinieneś trafić na stronę sukcesu, zobaczyć produkt w **/my-products** i transakcję w **/admin/payments**.

Jeśli wszystko działa — jesteś live. 🎉

---

## Krok 9 — Podłącz własną domenę (opcjonalnie, ~5 min)

Zarówno Vercel Hobby jak i Netlify free pozwalają wskazać własną domenę (np. `shop.example.com` lub apex `example.com`) na deploy. Darmowy SSL przez Let's Encrypt automatycznie.

### Vercel

1. **Project → Settings → Domains → Add Domain** → wpisz domenę → **Add**.
2. Vercel pokazuje rekordy DNS do ustawienia u dostawcy:
   - **Apex** (`example.com`): rekord `A` → `76.76.21.21`
   - **Subdomena** (`shop.example.com`): rekord `CNAME` → `cname.vercel-dns.com`
3. Dodaj rekord u dostawcy DNS (Cloudflare, Namecheap, OVH itd.). Propagacja zwykle 1–10 min.
4. W Vercelu domena przeskakuje na **Valid Configuration**, cert SSL pobierany automatycznie (~30 s).

### Netlify

1. **Site → Domain management → Add custom domain** → wpisz domenę → **Verify**.
2. Dwie opcje u dostawcy DNS:
   - **Użyj Netlify DNS** (najprościej): zmień nameservery na Netlify, oni ogarniają resztę.
   - **Użyj swojego DNS**: dodaj `CNAME` dla subdomen (lub `ALIAS`/`ANAME` dla apex) wskazujący na `twoj-sklep.netlify.app`.
3. Netlify sam provisionuje cert Let's Encrypt gdy DNS się rozpropaguje (~1–5 min).

### Nie zapomnij — zaktualizuj dwie zmienne env

Gdy domena żyje, zmień obie w dashboard platformy:

```env
SITE_URL=https://shop.example.com
NEXT_PUBLIC_SITE_URL=https://shop.example.com
```

Wymuś redeploy żeby nowe wartości się załapały.

### Nie zapomnij — zaktualizuj też URL webhooka Stripe

URL webhooka ustawiony w **Kroku 7** wskazuje na stary `*.vercel.app` / `*.netlify.app`. Po przejściu na własną domenę:

1. **Stripe Dashboard → Developers → Webhooks** → klik na endpoint → **Update endpoint URL** → zmień na `https://shop.example.com/api/webhooks/stripe`.
2. Zapisz. Signing secret (`STRIPE_WEBHOOK_SECRET`) **nie** zmienia się — zostaw istniejący.

> **Przypomnienie ToS Vercel Hobby:** Hobby jest do użytku osobistego / niekomercyjnego. Custom domain technicznie dozwolony, ale sklep komercyjny w skali powinien przejść na Vercel Pro ($20/mies) lub ścieżkę własnego VPS. Netlify free nie ma klauzuli non-commercial.

---

## Rozwiązywanie problemów

### Vercel: każda strona zwraca 404 zaraz po deployu

Jeśli `/`, `/en`, `/api/health` wszystko zwraca `HTTP 404` z `x-vercel-error: NOT_FOUND`, deploy się udał ale Vercel nie wykrył projektu jako Next.js. Potwierdź wchodząc w **Settings → Build & Deployment** w dashboardzie Vercel — "Framework Preset" powinien mówić `Next.js`. Jeśli mówi `Other` albo jest puste, ustaw na `Next.js` i redeploy.

(To się dzieje gdy projekt jest utworzony z CLI z `--yes` zamiast przez URL clone. URL clone obsługuje framework detection automatycznie; CLI czasem nie.)

### Vercel: każda strona zwraca 401 z loginem Vercel SSO

Trafiłeś na **Vercel Authentication** (dawniej "Deployment Protection"), włączoną domyślnie dla nowych projektów Hobby, blokująca anonimowy ruch do wszystkich URL `*.vercel.app`. Wyłącz w **Settings → Deployment Protection → Vercel Authentication → Disabled** (albo przez CLI: `vercel project protection disable <name> --sso`).

URL clone nie włącza tego dla aliasów produkcyjnych — ale jeśli tworzysz projekt przez CLI, musisz wyłączyć ręcznie.

### Netlify + Next.js 16

`@netlify/plugin-nextjs@5.15.11` nie deklaruje peer dependency na Next.js, więc z manifestu nie wiadomo czy Next 16 jest wspierany. **Zweryfikowano że działa w praktyce** (2026-05-26): czysty deploy Sellfa na Netlify buduje się w ~55 sekund i serwuje wszystkie routes poprawnie. Nie trzeba specjalnej konfiguracji ponad to co jest w `netlify.toml`.

Jeśli przyszła wersja Sellfa zaktualizuje Next.js i plugin się popsuje, typowy objaw to błąd builda referencujący brakujące eksporty z `next/server` albo podobnie. Albo tymczasowo zdowngrade'uj Sellfa, albo przerzuć się na Vercel.

### Aplikacja pada od razu po deployu z "Refusing to start: CHECKOUT_BINDING_SECRET is not set"

Pominąłeś Krok 1 albo zostawiłeś pole puste. Wygeneruj sekret i dodaj przez env vars Vercel/Netlify, potem redeploy.

### Aplikacja pada z "Refusing to start: TRUSTED_PROXY is not 'true'"

Ustaw `TRUSTED_PROXY` dosłownie na `true` (małymi literami, bez cudzysłowów). Vercel i Netlify są oba reverse proxy, więc to jest obowiązkowe.

### Każda strona zwraca 500 po Kroku 4

Krok 6 (migracje) jeszcze nie zrobiony. Aplikacja jest uruchomiona ale baza pusta. Uruchom `npx supabase db push`.

### Webhook Stripe pokazuje "400 Bad Request" w dashboardzie Stripe

Zmienna `STRIPE_WEBHOOK_SECRET` nie pasuje do sekretu w aktywnym endpoincie webhook. Skopiuj ponownie z dashboardu Stripe i zaktualizuj zmienną, potem redeploy.

### Magic linki nigdy nie przychodzą na maila

Darmowy plan Supabase używa SMTP relay o niskim priorytecie. Dwa fixy:
- Sprawdź folder spam (Gmail agresywnie filtruje)
- W Supabase Dashboard → **Authentication → Email Templates** skonfiguruj własny SMTP (Resend, SendGrid, Postmark) — i tak rekomendowane dla produkcji

### Projekt Supabase pauzuje się po tygodniu

Zachowanie darmowego planu. Opcje:
- Aktualizacja do **Supabase Pro** ($25/miesiąc) — rekomendowane jeśli Sellf ma żywych klientów
- Utrzymuj ruch — codzienny ping na dowolny endpoint liczy się jako activity
- Self-host Supabase ([FULL-STACK.md](../FULL-STACK.md))

### Chcę przejść na żywo (prawdziwe płatności)

1. W Dashboardzie Stripe wyłącz przełącznik **Test mode**.
2. Wypełnij weryfikację konta (nazwa firmy, adres, konto bankowe, dokument tożsamości).
3. Poczekaj aż Stripe zatwierdzi (zwykle kilka minut dla osobistych, kilka godzin dla firmowych).
4. Po zatwierdzeniu wygeneruj klucze API w trybie Live (`sk_live_…`, `pk_live_…`).
5. Utwórz nowy endpoint webhook wskazujący na ten sam URL `/api/webhooks/stripe`, w trybie **Live**.
6. Zaktualizuj `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` na wartości live.
7. Redeploy.

Baza Supabase zostaje ta sama — płatności testowe i live są obok siebie w `payment_transactions` (kolumna `livemode` je odróżnia).

---

## Dodatek: w pełni zautomatyzowany deploy (dla agentów / CI)

### Najkrótsza ścieżka — użyj skryptów StackPilot

[StackPilot](https://github.com/jurczykpawel/stackpilot) dostarcza gotowe instalatory robiące wszystko z tego przewodnika automatycznie:

```bash
# Vercel + Supabase Cloud + Stripe test mode
./apps/sellf/install-vercel.sh --repo-path /sciezka/do/sellf

# Netlify + Supabase Cloud + Stripe test mode
./apps/sellf/install-netlify.sh --repo-path /sciezka/do/sellf

# Reużyj integracji Vercel "Connect Database → Supabase":
#   1. W UI Vercel: Storage → Connect Database → Supabase (tworzy projekt)
#   2. Zanotuj project URL, anon/service_role keys, project ref, hasło bazy
#   3. Uruchom:
./apps/sellf/install-vercel.sh --repo-path /sciezka/do/sellf \
    --skip-supabase \
    --supabase-url https://<ref>.supabase.co \
    --supabase-anon <jwt> --supabase-svc <jwt> \
    --supabase-ref <ref> --db-password <pwd>
```

Każdy skrypt wypisuje żywy URL + zapisuje wartości do `.env.deploy.<project>` po sukcesie.

### Albo zrób ręcznie

Pełna sekwencja komend bash w wersji angielskiej tego dokumentu ([DEPLOYMENT-VERCEL-NETLIFY.md](../DEPLOYMENT-VERCEL-NETLIFY.md#appendix-fully-scripted-deploy-for-agents--ci)).

---

## A co z plikiem `.env.example`?

[`.env.example`](../../admin-panel/.env.example) wymienia każdą opcjonalną zmienną którą Sellf wspiera (~30 ich). Te 11 powyżej to minimum wymagane do działającego deploya produkcyjnego. Opcjonalne rzeczy które możesz chcieć później:

| Zmienna | Co dodaje |
|----------|--------------|
| `ALTCHA_HMAC_KEY` | Samodzielnie hostowana CAPTCHA na checkoucie (bez Cloudflare) — `openssl rand -hex 32` |
| `CLOUDFLARE_TURNSTILE_SITE_KEY` + `CLOUDFLARE_TURNSTILE_SECRET_KEY` | Cloudflare Turnstile CAPTCHA zamiast ALTCHA |
| `GUS_API_KEY` | Auto-uzupełnianie danych firm GUS na checkoucie (rynek PL) |
| `OAUTH_PROVIDERS` | Dodaj logowanie Google/GitHub/Discord obok magic linków |
| `SELLF_EMBED_ALLOWED_ORIGINS` | Jeśli osadzasz checkout na zewnętrznych stronach, wypisz tu domeny |
| `NEXT_PUBLIC_SELLF_ALLOWED_DOWNLOAD_DOMAINS` | Jeśli hostujesz pliki produktów na własnym CDN |

Dodaj później przez panel env vars Vercel/Netlify — bez redeploya dla runtime envów, tylko restart.
