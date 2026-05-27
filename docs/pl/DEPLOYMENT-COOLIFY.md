**Język:** 🇵🇱 Polski · [🇬🇧 English](../DEPLOYMENT-COOLIFY.md)

# Wdrożenie Sellfa na Coolify

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
- Masz (albo chcesz wynająć) VPS z **8 GB+ RAM**. Sam build Sellfa potrzebuje ~3 GB wolnego dla `bun run build` na Next.js 16 z Turbopack; na 4 GB VPS Coolify + Postgres + Redis zjadają już ~1 GB, więc build pada przez OOM. Zweryfikowano 2026-05-27: 4 GB Hetzner CX22 zabija build, 8 GB Hetzner CX32 buduje się w ~8 minut i serwuje poprawnie.
- Chcesz wszystko na własnej infrastrukturze (bez Supabase Cloud, bez Vercela)
- OK Ci self-hostować Postgresa (i własne backupy, w trybie self-hosted Coolify)
- Chcesz "deploy and forget" — Coolify obsługuje auto-renew TLS, automatyczne redeploy na `git push`, restarty kontenerów

Wybierz **Coolify Cloud** jeśli chcesz wszystkiego powyżej PLUS wolisz nie uruchamiać dashboardu Coolify samemu (auto-aktualizacje, backupy, alerty mailowe załatwione za Ciebie, ~$5/miesiąc).

Wybierz **Coolify Self-Hosted** jeśli chcesz zero powtarzających się opłat za oprogramowanie (i tak płacisz dostawcy VPS) ORAZ jesteś komfortowy z utrzymywaniem UI zarządzania Coolify samemu (`docker compose pull && restart` raz na miesiąc).

Nie wybieraj Coolify jeśli pasują Ci bardziej:

- **Hosting na free tier:** Coolify i tak wymaga VPS-a, ~$5-10/miesiąc minimum. Zobacz [DEPLOYMENT-VERCEL-NETLIFY.md](./DEPLOYMENT-VERCEL-NETLIFY.md) — Vercel + Supabase Cloud mają darmowy plan.
- **Najmniejszy możliwy footprint:** zobacz [DEPLOYMENT-MIKRUS.md](../DEPLOYMENT-MIKRUS.md) — sam Sellf chodzi na 35 zł/rok mikr.us bez Dockera.

## Najkrótsza ścieżka — użyj instalatora StackPilot

[`install-coolify.sh`](https://github.com/jurczykpawel/stackpilot/blob/main/apps/sellf/install-coolify.sh) ze StackPilot automatyzuje cały ten przewodnik. Dwa style wywołania zależnie od tego którego wariantu Coolify używasz:

**Coolify Self-Hosted (domyślnie):**

```bash
./apps/sellf/install-coolify.sh \
    --ssh-host <alias-vps> \
    --repo-path /sciezka/do/sellf
```

Skrypt instaluje Coolify na targecie (jeśli go nie ma), rejestruje admina, generuje token API, tworzy aplikację, ustawia zmienne, aplikuje migracje bazy i tworzy webhook Stripe. Łączny czas: ~12 minut na świeżym VPS, ~7 minut jeśli Coolify już działa.

**Coolify Cloud:**

```bash
./apps/sellf/install-coolify.sh \
    --coolify-cloud \
    --coolify-token <twoj-token-api> \
    --server-uuid   <uuid-serwera-juz-dodanego-do-cloud> \
    --repo-path /sciezka/do/sellf
```

Dla Cloud zrobiłeś już jednorazową konfigurację w Coolify Cloud (rejestracja, dodanie serwera, wygenerowanie tokenu API). Skrypt tworzy tylko projekt + aplikację + zmienne + webhook Stripe przeciwko `https://app.coolify.io/api/v1/...`. Łączny czas: ~7 minut.

Zweryfikowano na Hetzner CX32 (8 GB RAM) 2026-05-27.

Jeśli wolisz ręczny flow (albo wdrażasz bez root SSH na VPS), użyj kroków poniżej.

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

## Krok 2 — Utwórz aplikację

W dashboardzie Coolify:

1. **Projects → New Project** → nazwij `sellf`
2. W projekcie **New Resource → Public Repository**
3. Wklej:
   - **Git Repository:** `https://github.com/jurczykpawel/sellf`
   - **Branch:** `main`
   - **Build Pack:** `Docker Compose`
   - **Compose File Location:** `docker-compose.fullstack.yml`
4. Kliknij **Continue**

## Krok 3 — Ustaw zmienne środowiskowe

Coolify odczyta plik compose i poprosi o zmienne z niego. Wypełnij:

### Wygeneruj lokalnie (uruchom w terminalu)

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-24)"
echo "JWT_SECRET=$(openssl rand -base64 32)"
echo "ANON_KEY=<wygeneruj przez narzędzie podpisu JWT Supabase, zobacz Krok 3.1>"
echo "SERVICE_ROLE_KEY=<to samo>"
echo "CHECKOUT_BINDING_SECRET=$(openssl rand -base64 32)"
echo "APP_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "LOGINWALL_SECRET=$(openssl rand -hex 32)"
```

### Krok 3.1 — Wygeneruj klucze JWT Supabase

Samodzielnie hostowane Supabase wymaga `ANON_KEY` i `SERVICE_ROLE_KEY` podpisanych Twoim `JWT_SECRET`. Użyj online narzędzia Supabase: https://supabase.com/docs/guides/self-hosting#api-keys (strona ma wbudowany generator). Albo uruchom lokalnie:

```bash
JWT_SECRET="<twoja wartość z góry>"
# anon key:
docker run --rm -i node:20-alpine sh -c "npm i -g jsonwebtoken-cli && jwt encode --secret '$JWT_SECRET' '{\"role\": \"anon\", \"iss\": \"supabase\"}'"
# service_role key:
docker run --rm -i node:20-alpine sh -c "npm i -g jsonwebtoken-cli && jwt encode --secret '$JWT_SECRET' '{\"role\": \"service_role\", \"iss\": \"supabase\"}'"
```

### Wklejone do Coolify

```
POSTGRES_PASSWORD=<z kroku 3>
JWT_SECRET=<z kroku 3>
ANON_KEY=<z kroku 3.1>
SERVICE_ROLE_KEY=<z kroku 3.1>
SUPABASE_URL=http://kong:8000              # wewnętrzna sieć Docker
SUPABASE_ANON_KEY=<to samo co ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<to samo co SERVICE_ROLE_KEY>
SITE_URL=https://<twoja-domena-coolify-app>
STRIPE_SECRET_KEY=sk_test_…                # albo sk_live_… dla produkcji
STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_WEBHOOK_SECRET=whsec_PLACEHOLDER     # zamienisz w Kroku 5
CHECKOUT_BINDING_SECRET=<z kroku 3>
APP_ENCRYPTION_KEY=<z kroku 3>
LOGINWALL_SECRET=<z kroku 3>
TRUSTED_PROXY=true
```

## Krok 4 — Deploy

Kliknij **Deploy** w Coolify. Pierwszy deploy trwa 5-10 minut (buduje bundle Next.js Sellfa i pobiera obrazy Supabase). Coolify pokazuje live logi builda.

**Bez osobnego kroku migracji** — `docker-compose.fullstack.yml` montuje `./supabase/migrations` do kontenera Postgresa w `/docker-entrypoint-initdb.d`, więc migracje uruchamiają się automatycznie przy pierwszym boocie. To główny powód dla którego Coolify jest bliżej prawdziwego one-click niż Vercel/Netlify.

## Krok 5 — Webhook Stripe

Po deployu Twoja aplikacja jest pod `https://<twoja-coolify-domena>`. Skonfiguruj webhook tak samo jak w przewodniku Vercel/Netlify:

1. https://dashboard.stripe.com/test/webhooks → **Add endpoint**
2. **URL:** `https://<twoja-domena>/api/webhooks/stripe`
3. **Events:** zobacz [DEPLOYMENT-VERCEL-NETLIFY.md Krok 7](./DEPLOYMENT-VERCEL-NETLIFY.md#krok-7--podłącz-webhook-stripe-3-min)
4. Skopiuj signing secret `whsec_…`
5. W Coolify: **Environment Variables → STRIPE_WEBHOOK_SECRET** → wklej prawdziwą wartość → **Save**
6. **Restart** aplikacji z dashboardu Coolify

## Krok 6 — Własna domena + TLS

W dashboardzie Coolify:
1. Otwórz aplikację Sellf
2. **Domains → Add Domain** → wpisz własną domenę (np. `sklep.example.com`)
3. Ustaw rekord A swojej DNS na IP VPS Coolify
4. Coolify auto-provisionuje cert Let's Encrypt w ~30 sekund

**Zaktualizuj `SITE_URL`** żeby pasowała do nowej domeny, restartuj.

## Backup

Coolify nie widzi do wewnątrz Twojego Supabase Sellfa. Skonfiguruj własne backupy:

```bash
# W dashboardzie Coolify → projekt → Backups
# ALBO przez cron na VPS-ie:
0 3 * * * docker exec sellf-db pg_dumpall -U postgres > /backups/sellf-$(date +%F).sql
```

Dla backupów offsite kompatybilnych z S3, zobacz `vault/brands/_shared/infra/INDEX.md` dla wzorca backup-host-restic.sh.

## Aktualizacja Sellf

W dashboardzie Coolify:
1. Otwórz aplikację Sellf
2. **Deployments → Redeploy** — pobiera najnowsze `main` z GitHuba, przebudowuje
3. Migracje w nowszych wersjach Sellfa uruchamiają się automatycznie przy restarcie kontenera (idempotentne)

Jeśli chcesz auto-deploy przy każdym `git push` do `main`, włącz **Webhooks → GitHub** w ustawieniach projektu Coolify.

## Rozwiązywanie problemów

### Build OOM-zabija `bun` na 4 GB VPS

Objaw: Coolify pokazuje deploy jako "in progress" ale kontener builda znika bez błędu w UI logach. `dmesg` na hoście pokazuje:

```
Out of memory: Killed process <pid> (bun) total-vm:76GB ...
```

Przyczyna: Next.js 16 + Turbopack + `bun run build` szczytuje ~3 GB residentnej pamięci, a usługi Coolify + Postgres + Redis już używają ~1 GB. 4 GB VPS się nie mieści.

Fix: aktualizuj do **8 GB+** (Hetzner CX32, Contabo VPS 200, Linode g6-standard-2 itd.) i redeploy. Albo zbuduj obraz gdzie indziej i pozwól Coolify tylko go pobrać (zobacz "Build server" w ustawieniach Coolify).

### Kontener Postgres restartuje się w pętli

Objaw: kontener `sellf-db` ciągle restartuje, logi mówią `FATAL: password authentication failed`.

Przyczyna: zmienna `POSTGRES_PASSWORD` została zmieniona po pierwszym boocie. Katalog danych Postgresa został zainicjalizowany ze starym hasłem; nowe nie autoryzuje.

Fix: zatrzymaj stack, `docker volume rm sellf_postgres_data`, redeploy. **Niszczy wszystkie dane** — upewnij się że masz backup jeśli jesteś po pierwszym deployu.

### Kong API gateway zwraca 404 na każdy request

Przyczyna: brakuje albo nieprawidłowy plik `supabase/kong.yml` w repo. Compose montuje go tylko-do-odczytu.

Fix: sprawdź że plik istnieje pod ścieżką jakiej oczekuje `docker-compose.fullstack.yml` (`./supabase/kong.yml`).

### "Service quota exceeded" od Coolify

Darmowy plan Coolify pozwala na N zasobów na serwer. Sprawdź stronę cennika Coolify — jeśli przekroczyłeś, albo usuń nieużywane zasoby albo aktualizuj.

### Webhooki Stripe zwracają 400 "Missing signature"

Ten sam problem co w przewodniku Vercel/Netlify — zmienna `STRIPE_WEBHOOK_SECRET` nie pasuje do signing secret w dashboardzie Stripe. Skopiuj ponownie i zrestartuj kontener.

---

## Czemu to nie jest jeszcze opublikowane jako "Coolify Template"

Coolify wspiera szablony one-click z marketplace. Sellf jeszcze takiego nie ma bo:

- Plik compose fullstack używa obrazów Supabase wymagających kluczy podpisanych JWT (Krok 3.1) — format szablonu Coolify nie wspiera natywnie "wygeneruj ten JWT, podpisz tamtą inną wygenerowaną wartością." Wciąż potrzebowałbyś ręcznego kroku JWT.
- Self-Hosted Supabase to ruchomy cel (wersje auth/realtime/storage się zmieniają). Compose fullstack jest przypięty do znanych-dobrych wersji; szablon wymagałby utrzymania.

Jeśli ktoś chce wnieść szablon Coolify zawierający init container podpisujący JWT, byłby mile widziany — otwórz issue.
