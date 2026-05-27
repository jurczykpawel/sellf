**Język:** 🇵🇱 Polski · [🇬🇧 English](../QUICK-START.md)

# Uruchamianie sklepu Sellf — najprostszy sposób

> ## 🏆 Najłatwiejsza metoda (ten przewodnik)
>
> - **Co:** przycisk one-click Vercel + wbudowana baza Supabase w Vercelu
> - **Wymagane umiejętności:** żadne — tylko przeglądarka
> - **Czas konfiguracji:** ~20 minut
> - **Koszt na start:** **$0/miesiąc**
> - **Koszt gdy sklep ma płacących klientów:** **$25/miesiąc** (Supabase Pro żeby baza nie pauzowała)
> - **Prowizja Stripe** (na każdej ścieżce): ~2,9% + 0,30 zł od transakcji
>
> **Dla kogo:** dla każdego kto nigdy nie stawiał oprogramowania na serwerze. Jeśli to Ty, przestań czytać zielony blok niżej i podążaj za tym przewodnikiem.
>
> ## 💰 Najtańsza metoda (wymaga terminala)
>
> - **Co:** Sellf na VPS-ie [mikr.us](https://mikr.us/?r=pavvel) (35 zł/rok) + darmowy Supabase
> - **Wymagane umiejętności:** komfort z SSH, kopiowanie komend Linuksowych, uruchomienie skryptu w terminalu
> - **Czas konfiguracji:** ~45 minut
> - **Koszt na start:** **~3 zł/miesiąc** (35 zł/rok + darmowy Supabase pod warunkiem tygodniowego ruchu)
> - **Koszt jeśli sklep jest spokojny:** ~$26/miesiąc (przejście na Supabase Pro żeby nie pauzowało — albo utrzymanie codziennego ruchu)
> - **Prowizja Stripe** (na każdej ścieżce): te same ~2,9% + 0,30 zł od transakcji
>
> **Dla kogo:** osoby przyzwyczajone do serwerów Linuksowych które chcą minimalizować miesięczne koszty. Trade-off: więcej odpowiedzialności, sam utrzymujesz serwer, brak ładnego panelu.
>
> **Chcesz pełne instrukcje najtańszej ścieżki?** Zobacz [DEPLOYMENT-MIKRUS.md](./DEPLOYMENT-MIKRUS.md). Albo dla nieco droższej ale z pełną kontrolą opcji [Coolify](./DEPLOYMENT-COOLIFY.md) (~$9/miesiąc na Hetznerze, z ładnym panelem).
>
> ---
>
> **Nie jesteś pewien co wybrać?** Jeśli nigdy nie używałeś SSH do serwera, najłatwiejsza metoda to właściwy wybór — różnica $25/miesiąc kupuje Ci spokój. Zawsze możesz przenieść się później na tańszą ścieżkę; dane i sklep zostają te same.

Ten przewodnik pokazuje krok po kroku tę najprostszą ścieżkę: **wszystko w przeglądarce, bez instalowania programów, bez terminala**.

**Łączny czas:** około 20 minut (większość to czekanie).

**Co będziesz miał na końcu:** działający sklep pod adresem typu `https://twoj-sklep.vercel.app`, gdzie możesz dodawać produkty i przyjmować płatności.

**Ile to kosztuje:** $0 na start. Wszystko czego tu używamy ma darmowy plan, który wystarczy na pierwsze miesiące. Gdy sklep będzie miał płacących klientów, najprawdopodobniej przejdziesz na Supabase za $25/miesiąc — wyjaśnione na końcu.

---

## Szybki przegląd: co się z czym łączy

Twój sklep Sellf to trzy elementy działające razem:

1. **Sam program sklepu** (Sellf) — działa na usłudze **Vercel**. To jest to, co widzą Twoi klienci gdy wchodzą na sklep.
2. **Dane** (produkty, zamówienia, klienci) — przechowywane w usłudze **Supabase**. Sellf zapisuje i czyta dane stamtąd.
3. **Obsługa płatności** — robi to **Stripe**. Gdy klient płaci, Stripe pobiera dane karty i przelewa pieniądze na Twoje konto bankowe.

Założysz po jednym koncie na każdej z tych trzech usług. Każde konto jest bezpłatne.

---

## Zanim zaczniesz

Upewnij się że masz:

- Przeglądarkę internetową (Chrome, Firefox, Safari, Edge — dowolną nowoczesną)
- Adres email do którego masz dostęp
- Około 20 minut czasu
- Menedżer haseł albo miejsce gdzie bezpiecznie zapiszesz hasła (bardzo ważne — utworzysz ich kilka)

To wszystko. Nie musisz nic instalować na komputerze.

---

## Krok 1: Załóż konto na GitHubie (1 minuta)

GitHub to usługa do przechowywania programów. Użyjemy go jako "paszportu" do logowania w innych usługach (Vercel i Supabase pozwalają logować się przez GitHub, co oszczędza czas).

1. Otwórz https://github.com/signup
2. Wpisz adres email, kliknij **Continue**
3. Utwórz hasło, kliknij **Continue**
4. Wybierz nazwę użytkownika (dowolną wolną), kliknij **Continue**
5. Rozwiąż "are you human?" — łamigłówkę dla weryfikacji
6. Kliknij **Create account**
7. GitHub wyśle Ci kod na email. Otwórz pocztę, skopiuj kod, wklej z powrotem na stronie GitHuba

Gotowe. Masz konto GitHub. **Nie musisz nic technicznego na GitHubie robić** — będziesz go używał tylko do logowania w innych miejscach.

> **Jeśli masz już konto GitHub, pomiń ten krok.**

---

## Krok 2: Załóż konto na Vercelu (1 minuta)

Vercel to miejsce gdzie Twój sklep Sellf będzie żył w internecie.

1. Otwórz https://vercel.com/signup
2. Kliknij **Continue with GitHub**
3. GitHub spyta "Authorize Vercel?" — kliknij **Authorize Vercel**
4. Vercel poprosi o nazwę użytkownika (zaproponuje na bazie Twojej nazwy z GitHuba) — zostaw albo zmień, kliknij **Continue**
5. Wybierz **Hobby** (darmowy) gdy spyta o plan — kliknij **Continue**
6. Pomiń promty typu "invite teammates" czy "first project" — za chwilę tam dojdziesz

Gotowe. Masz konto Vercel.

---

## Krok 3: Skopiuj kod Sellfa do swojego konta Vercel (3 minuty)

Nie będziesz pisał żadnego kodu. Po prostu tworzysz osobistą kopię Sellfa w swoim Vercelu.

1. Otwórz ten specjalny link: [https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjurczykpawel%2Fsellf&root-directory=admin-panel&env=CHECKOUT_BINDING_SECRET,TRUSTED_PROXY,APP_ENCRYPTION_KEY,LOGINWALL_SECRET,STRIPE_SECRET_KEY,STRIPE_PUBLISHABLE_KEY,STRIPE_WEBHOOK_SECRET,SITE_URL&project-name=sellf&repository-name=sellf](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjurczykpawel%2Fsellf&root-directory=admin-panel&env=CHECKOUT_BINDING_SECRET,TRUSTED_PROXY,APP_ENCRYPTION_KEY,LOGINWALL_SECRET,STRIPE_SECRET_KEY,STRIPE_PUBLISHABLE_KEY,STRIPE_WEBHOOK_SECRET,SITE_URL&project-name=sellf&repository-name=sellf)

   (Zobaczysz za chwilę dlaczego używamy tego specjalnego linku — ustawia kilka rzeczy automatycznie.)

2. Vercel poprosi o autoryzację dostępu do GitHuba. Kliknij **Install** albo **Authorize**.
3. Vercel skopiuje kod Sellfa do Twojego konta GitHub (zobaczysz "Creating Git Repository...") — poczekaj około 30 sekund
4. Trafisz na stronę zatytułowaną "Configure Project" z formularzem
5. **ZATRZYMAJ SIĘ TUTAJ** i nie wypełniaj jeszcze niczego. **Zostaw tę zakładkę otwartą**, wrócisz do niej. Najpierw musimy ustawić bazę danych.

> **Co się właśnie stało?** Vercel zrobił prywatną kopię ("fork" w żargonie) kodu źródłowego Sellfa w Twoim koncie GitHub i czeka teraz aż podasz kilka ustawień, zanim faktycznie wystartuje sklep online. Zaraz wypełnimy te ustawienia krok po kroku.

---

## Krok 4: Dodaj bazę danych do swojego projektu (5 minut)

Formularz "Configure Project" czeka na Ciebie. Dodamy bazę danych **PRZED** wypełnieniem formularza, bo dodanie bazy automatycznie wypełni niektóre pola.

1. **Otwórz nową zakładkę w przeglądarce** (nie zamykaj zakładki "Configure Project" — wrócisz do niej)
2. W nowej zakładce otwórz https://vercel.com/dashboard
3. Zobaczysz swój projekt Sellf na liście. Kliknij na niego.
4. W menu po lewej kliknij **Storage**
5. Kliknij przycisk **Create Database**
6. Zobaczysz listę baz danych. Kliknij **Supabase**
7. Kliknij **Continue with Supabase**

   - **Jeśli pierwszy raz używasz Supabase:** otworzy się strona rejestracji Supabase. Kliknij **Continue with GitHub**, potem **Authorize Supabase**. Masz konto Supabase.
   - **Jeśli masz już konto Supabase:** zaloguj się.

8. Vercel zapyta o szczegóły bazy:
   - **Display Name:** wpisz `sellf-baza-danych` (albo cokolwiek zapamiętasz)
   - **Region:** wybierz najbliższy temu gdzie mieszka większość Twoich klientów:
     - Europa → **eu-central-1 Frankfurt**
     - USA wschodnie wybrzeże → **us-east-1 N. Virginia**
     - USA zachodnie wybrzeże → **us-west-1 Oregon**
     - Azja → **ap-southeast-1 Singapur**
     - Australia → **ap-southeast-2 Sydney**
     - Ameryka Południowa → **sa-east-1 São Paulo**
   - **Database Password:** kliknij **Generate Password**. Potem kliknij **ikonkę oka** żeby zobaczyć hasło. **Skopiuj to hasło do menedżera haseł**. Zapisz notatkę: "Sellf — hasło do bazy Supabase."
9. Kliknij **Create**
10. Poczekaj około 2 minut aż Supabase przygotuje bazę. Zobaczysz "Connecting your database..."
11. Gdy będzie gotowe, zobaczysz zielony znaczek i przycisk **Connect Project**. Kliknij.
12. **Continue when ready** — Vercel automatycznie zapisze połączenie z bazą w Twoim projekcie.

> **Co się właśnie stało?** Vercel utworzył dla Ciebie bazę danych w Supabase i zapisał adres oraz klucze dostępu prosto w projekcie Sellfa. Sam nic nie musisz kopiować.

---

## Krok 5: Pobierz klucze do obsługi płatności (5 minut)

Teraz konfigurujemy Stripe, żeby Twój sklep mógł przyjmować płatności.

Najpierw uruchamiamy w "trybie testowym" — pozwala udawać przetwarzanie płatności fałszywymi numerami kart, żeby upewnić się że wszystko działa, zanim przyjmiesz prawdziwe pieniądze. Później przełączysz na płatności prawdziwe zmianą jednego ustawienia.

1. **Otwórz nową zakładkę w przeglądarce**
2. Przejdź na https://dashboard.stripe.com/register
3. Wypełnij:
   - **Email:** Twój prawdziwy adres email
   - **Full name:** Twoje imię i nazwisko
   - **Country:** kraj w którym jest Twoja firma
   - **Password:** utwórz mocne hasło, **zapisz w menedżerze haseł**
4. Kliknij **Create account**
5. Stripe wyśle Ci link weryfikacyjny. Otwórz pocztę, kliknij link
6. Wracając do Stripe, trafisz na dashboard. W **prawym górnym rogu** jest przełącznik o nazwie **"Activate payments"** albo pokazujący nazwę Twojego konta. **Upewnij się że "Test mode" jest WŁĄCZONY** (jest tam przełącznik "Test mode" — powinien być podświetlony na pomarańczowo/czerwono)
7. W menu po lewej kliknij **Developers**
8. Kliknij **API keys** w podmenu
9. Zobaczysz dwa klucze na stronie:
   - **Publishable key** — zaczyna się od `pk_test_...`. Kliknij ikonkę kopiowania obok. **Wklej w tymczasowy plik tekstowy** — będziesz tego potrzebował za chwilę.
   - **Secret key** — zaczyna się od `sk_test_...`. Kliknij **Reveal test key**, potem skopiuj. **Wklej w pliku tekstowym też**. Oznacz ten klucz jako "Stripe secret key — TRZYMAJ W TAJEMNICY."

Masz oba klucze Stripe. Nie zamykaj zakładki Stripe — wrócimy do niej później.

> **Co to jest "Test mode"?** Stripe Test mode pozwala udawać przetwarzanie płatności za pomocą fałszywych numerów kart (np. `4242 4242 4242 4242`). Nie ruszają się żadne prawdziwe pieniądze. Tak właśnie Sellf jest skonfigurowany domyślnie. Gdy będziesz gotowy przyjmować prawdziwe pieniądze, przejdziesz przez proces "Activate" w Stripe (zweryfikują Twoją firmę) i przełączysz na klucze "Live mode". Omawiamy to na końcu.

---

## Krok 6: Wygeneruj cztery klucze bezpieczeństwa (2 minuty)

Sellf potrzebuje czterech losowych wartości "sekretnych" żeby zabezpieczyć Twój sklep. Są jak bardzo długie losowe hasła. Użyjemy darmowej strony żeby je wygenerować.

1. **Otwórz nową zakładkę w przeglądarce**
2. Przejdź na https://www.random.org/strings/
3. Na stronie:
   - **Number of strings:** wpisz `4`
   - **Length of each string:** wpisz `40`
   - **Characters to use:** zaznacz **Alphabetic characters (uppercase only)** ORAZ **Numeric digits** (odznacz pozostałe)
   - **Make each string unique:** zaznacz **Yes**
4. Kliknij **Get Strings**
5. Zobaczysz 4 losowe ciągi znaków, każdy w osobnej linii. Skopiuj każdy do swojego pliku tekstowego z opisami:
   - Pierwszy ciąg → opis "CHECKOUT_BINDING_SECRET"
   - Drugi ciąg → opis "APP_ENCRYPTION_KEY"
   - Trzeci ciąg → opis "LOGINWALL_SECRET"
   - Czwarty ciąg → opis "(zapasowy — nie używany)"

> **Po co mi to?** Sellf używa tych losowych wartości żeby cyfrowo podpisywać rzeczy (np. upewniać się że potwierdzenie płatności jest prawdziwe a nie podrobione). Są jak unikalny identyfikator Twojego sklepu. Generujesz je raz i nigdy nie musisz na nie patrzeć. **Nie udostępniaj ich nikomu.**

---

## Krok 7: Wypełnij ustawienia projektu Sellf (3 minuty)

Teraz wracamy do zakładki "Configure Project" w Vercelu (tej zostawionej w kroku 3).

1. Wróć do zakładki Vercel "Configure Project"
2. Jeśli strona wygasła, nic się nie stało — wejdź na https://vercel.com/dashboard, kliknij swój projekt Sellf, potem **Settings** → **Environment Variables**
3. Zobaczysz listę pustych pól typu `CHECKOUT_BINDING_SECRET`, `STRIPE_SECRET_KEY` itp.
4. Wypełnij je **kopiując wartości z pliku tekstowego** (z poprzednich kroków):

   | Nazwa pola | Co wkleić |
   |---|---|
   | `CHECKOUT_BINDING_SECRET` | Pierwszy losowy ciąg z random.org |
   | `TRUSTED_PROXY` | Słowo `true` (po prostu tyle, cztery litery, małymi) |
   | `APP_ENCRYPTION_KEY` | Drugi losowy ciąg z random.org |
   | `LOGINWALL_SECRET` | Trzeci losowy ciąg z random.org |
   | `STRIPE_SECRET_KEY` | Klucz Stripe zaczynający się od `sk_test_...` |
   | `STRIPE_PUBLISHABLE_KEY` | Klucz Stripe zaczynający się od `pk_test_...` |
   | `STRIPE_WEBHOOK_SECRET` | Wpisz dokładnie: `whsec_PLACEHOLDER_will_replace_after_first_deploy_xx` — naprawimy w kroku 9 |
   | `SITE_URL` | Wpisz: `https://sellf-` + Twoja-nazwa-Vercel + `.vercel.app` — możesz też zostawić puste na razie |

   (Ustawienia Supabase są już wypełnione — Vercel dodał je w kroku 4.)

5. Kliknij duży przycisk **Deploy** na dole
6. Vercel zacznie stawiać Twój sklep online. Zobaczysz ekran z postępem. **Trwa to około 3-5 minut** — idź po kawę.

---

## Krok 8: Poczekaj i odwiedź swój sklep (5 minut)

1. Gdy deployment się skończy, zobaczysz animację świętowania i ekran z Twoim projektem
2. Kliknij przycisk **Visit** (albo kliknij nazwę projektu → **Domains** → adres `*.vercel.app`)
3. Powinieneś zobaczyć stronę główną Sellfa pod adresem typu `https://sellf-twoja-nazwa.vercel.app`
4. **Zapisz albo zakładkuj ten adres** — to Twój sklep

Jeśli widzisz błąd "500": nie panikuj. Czasem pierwsza wizyta zawodzi bo baza danych jeszcze się konfiguruje. Odśwież stronę po 30 sekundach. Jeśli wciąż nie działa, zobacz sekcję **Rozwiązywanie problemów** na dole.

---

## Krok 9: Podłącz płatności Stripe (5 minut)

Teraz sklep jest online ale Stripe jeszcze o nim nie wie. Musimy powiedzieć Stripe gdzie wysyłać powiadomienia o płatnościach.

1. Otwórz https://dashboard.stripe.com/test/webhooks
2. Kliknij **Add endpoint** (prawy górny róg)
3. W polu **Endpoint URL** wpisz:
   `https://ADRES-TWOJEGO-SKLEPU.vercel.app/api/webhooks/stripe`
   (Zamień `ADRES-TWOJEGO-SKLEPU` na prawdziwy URL Twojego sklepu z kroku 8 — upewnij się że kończy się `/api/webhooks/stripe`)
4. W polu **Description** (opcjonalne) wpisz: `Sellf powiadomienia o płatnościach`
5. Kliknij **Select events** i zaznacz te pola (tylko te, innych nie trzeba):
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `customer.subscription.created` (tylko jeśli sprzedajesz subskrypcje)
   - `customer.subscription.updated` (tylko jeśli sprzedajesz subskrypcje)
   - `customer.subscription.deleted` (tylko jeśli sprzedajesz subskrypcje)
   - `invoice.paid` (tylko jeśli sprzedajesz subskrypcje)
   - `invoice.payment_failed` (tylko jeśli sprzedajesz subskrypcje)
6. Kliknij **Add events**
7. Kliknij **Add endpoint** na dole
8. Jesteś na stronie pokazującej nowy webhook. Znajdź **Signing secret** — kliknij **Reveal**. Zobaczysz wartość zaczynającą się od `whsec_...`
9. **Skopiuj tę wartość** do pliku tekstowego

Teraz wróć do projektu Vercel i zaktualizuj placeholder:

10. Otwórz https://vercel.com/dashboard, kliknij swój projekt Sellf
11. Kliknij **Settings** → **Environment Variables**
12. Znajdź `STRIPE_WEBHOOK_SECRET` na liście, kliknij trzy kropki → **Edit**
13. Wklej prawdziwą wartość `whsec_...` (zastępując placeholder z kroku 7)
14. Kliknij **Save**
15. Teraz redeploy: idź do zakładki **Deployments**, znajdź ostatni deploy, kliknij trzy kropki → **Redeploy**
16. Poczekaj 2 minuty na redeploy

---

## Krok 10: Przetestuj czy płatności działają (2 minuty)

1. Otwórz adres swojego sklepu w przeglądarce
2. **Automatycznie zostaniesz adminem** — pierwsza osoba która zarejestruje się w nowym sklepie Sellf dostaje uprawnienia admina. Kliknij **Sign up** (albo **Login**), wpisz swój email, postępuj zgodnie z magic linkiem ze skrzynki.

   - **Nie dostałeś maila z magic linkiem?** Sprawdź spam. Domyślna usługa mailowa Supabase czasem tam ląduje. Po pierwszym udanym logowaniu możesz skonfigurować lepszą usługę mailową w ustawieniach Sellfa.

3. Jesteś w panelu admina. Spróbuj utworzyć testowy produkt:
   - Kliknij **Products** → **New product**
   - Title: "Produkt testowy"
   - Price: 5 (PLN/USD/EUR — wybierz walutę)
   - Kliknij **Save**
4. Odwiedź publiczną stronę produktu (kliknij link slug)
5. Kliknij **Buy**
6. Na stronie płatności Stripe użyj fałszywej karty testowej:
   - **Card number:** `4242 4242 4242 4242`
   - **Expiration:** dowolna przyszła data (np. `12/30`)
   - **CVC:** dowolne 3 cyfry (np. `123`)
   - **ZIP:** dowolny (np. `12345`)
7. Kliknij **Pay**
8. Powinieneś trafić na stronę "Success"

Teraz sprawdź czy Stripe dostał płatność:

9. Otwórz https://dashboard.stripe.com/test/payments
10. Powinieneś zobaczyć Twoją testową płatność na liście

Powinno być też w Twoim panelu admina:

11. Wróć do sklepu, kliknij **Admin → Payments**
12. Twoja testowa płatność też tu jest

🎉 Twój sklep w pełni działa. Dodawaj prawdziwe produkty, udostępniaj link światu, sprzedawaj.

---

## Przechodzenie na żywo: z trybu testowego na prawdziwe płatności

Gdy jesteś gotowy przyjmować prawdziwe pieniądze:

1. W Stripe kliknij **Activate payments** (prawy górny róg)
2. Wypełnij dane firmy: nazwę, adres, konto bankowe, weryfikacja tożsamości
3. Poczekaj aż Stripe zatwierdzi (zwykle kilka minut dla kont osobistych, kilka godzin dla firm)
4. Po zatwierdzeniu zobaczysz nowe "Live" klucze API w https://dashboard.stripe.com/apikeys (już nie test). Zaczynają się od `pk_live_...` i `sk_live_...`
5. Utwórz nowy webhook (tak samo jak w kroku 9, ale na stronie **Live** webhooks — https://dashboard.stripe.com/webhooks). Dostaniesz nowy `whsec_...` dla trybu live.
6. Zaktualizuj trzy ustawienia w Vercelu (Settings → Environment Variables):
   - `STRIPE_SECRET_KEY` → Twój `sk_live_...`
   - `STRIPE_PUBLISHABLE_KEY` → Twój `pk_live_...`
   - `STRIPE_WEBHOOK_SECRET` → nowy `whsec_...` z live webhook
7. Redeploy (Deployments → ostatni → trzy kropki → Redeploy)

Teraz przyjmujesz prawdziwe pieniądze. Prawdziwi klienci płacą prawdziwymi kartami, pieniądze lądują na Twoim koncie bankowym zgodnie z normalnym harmonogramem Stripe.

---

## Co kosztuje gdy sklep rośnie

Darmowy plan pokrywa Cię aż do momentu gdy zarabiasz sensowne pieniądze. Oto kiedy zaczniesz prawdopodobnie płacić:

| Kiedy | Co aktualizować | Dlaczego | Koszt |
|---|---|---|---|
| Dzień 1 (jesteś tu) | Nic | Darmowe plany pokrywają start | $0/miesiąc |
| Pierwszy płacący klient | Jeszcze nic | Darmowy plan dalej wystarcza | $0/miesiąc |
| Sklep nie miał wizyt przez tydzień | **Supabase Pro** ($25/mies) | Darmowy Supabase pauzuje po 7 dniach bez ruchu — irytujące dla prawdziwego sklepu | $25/miesiąc |
| Przekroczysz limit Vercel (100GB/miesiąc ruchu) | **Vercel Pro** ($20/mies) | Więcej transferu | $20/miesiąc |

Realnie: $0 na start, $25/miesiąc gdy masz klientów (Supabase Pro), $45/miesiąc jak sklep ma duży ruch.

Stripe pobiera prowizję od każdej transakcji (~2,9% + 0,30 zł w większości krajów) — zobacz https://stripe.com/pl/pricing dla swojego kraju.

## Wszystkie opcje wdrożenia wg kosztów

Ten przewodnik używa **najprostszej ścieżki** (Vercel + wbudowana Supabase). Są tańsze opcje jeśli jesteś chętny używać terminala i sam zarządzać serwerem. Pełen krajobraz:

| Ścieżka | Koszt miesięczny (gdy masz klientów) | Czas konfiguracji | Wymagana wiedza techniczna | Dla kogo |
|---------|--------------------------------------|-------------------|----------------------------|----------|
| **Vercel + Vercel-Supabase (ten przewodnik)** | **$25/mies** (Supabase Pro żeby uniknąć pauzy) | ~20 min | 🟢 Żadna — tylko przeglądarka | **Pierwszy własny sklep, użytkownik nietechniczny.** Ta ścieżka jest rekomendowana. |
| Vercel + Supabase Free + codzienny ruch | $0/mies (ale musisz utrzymać codzienny ruch albo baza pauzuje) | ~20 min | 🟢 Żadna — tylko przeglądarka | Projekty hobbystyczne, sklepy o małym ruchu |
| [Netlify + Supabase](./DEPLOYMENT-VERCEL-NETLIFY.md) | $25/mies | ~20 min | 🟢 Żadna — tylko przeglądarka | To samo co Vercel, inny host |
| [Coolify Cloud + Hetzner VPS](./DEPLOYMENT-COOLIFY.md) | **~$14/mies** ($5 Coolify Cloud + $9 Hetzner CX32) | ~30 min | 🟡 Podstawowa — wklejenie klucza SSH do VPS | Pełna kontrola + zarządzany panel Coolify |
| [Coolify self-hosted + Hetzner VPS](./DEPLOYMENT-COOLIFY.md) | **~$9/mies** ($9 Hetzner CX32, reszta darmowa) | ~45 min | 🟡 Podstawowa — komendy SSH, kilka sekretów | Pełna kontrola, najmniejszy rozsądny koszt |
| [mikr.us VPS + Supabase Free + codzienny ruch](./DEPLOYMENT-MIKRUS.md) | **~4 zł/mies** (35 zł/rok mikr.us + darmowa reszta) | ~45 min | 🔴 Średnia — SSH, terminal, PM2 | Najtańsza opcja dla osób komfortowych technicznie |
| [mikr.us + Supabase Pro](./DEPLOYMENT-MIKRUS.md) | ~$26/mies | ~45 min | 🔴 Średnia | Najtańsza opcja która nie pauzuje |

**Prowizja Stripe od transakcji** (~2,9% + 0,30 zł) jest taka sama na każdej ścieżce — tak Stripe zarabia. Wybierz ścieżkę pasującą do Twoich umiejętności; Stripe to nie obchodzi.

**Rekomendacja dla użytkownika nietechnicznego:** **zostań przy tym przewodniku**. Vercel + Vercel-Supabase to $25/miesiąc drożej niż mikr.us, ale jeśli nie jesteś komfortowy z terminalami i Linuksem, te $25/mies kupują Ci spokój. Zawsze możesz przejść na tańszą ścieżkę później — to nie jednokierunkowe drzwi.

**Rekomendacja dla osoby komfortowej z serwerami:** **Coolify self-hosted na Hetznerze** za ~$9/miesiąc. Najlepszy balans kosztu, kontroli i wygody. Zobacz [DEPLOYMENT-COOLIFY.md](./DEPLOYMENT-COOLIFY.md).

---

## Typowe problemy

### "Widzę błąd 500 gdy wchodzę na sklep"

Najczęstsza przyczyna: baza nie jest jeszcze w pełni gotowa. Poczekaj 1 minutę i odśwież.

Jeśli to nie pomoże:
1. Wejdź na https://supabase.com/dashboard
2. Kliknij swój projekt (ten o nazwie `sellf-baza-danych` z kroku 4)
3. Zobacz nagłówek — jeśli mówi "Paused", kliknij **Restore**
4. Poczekaj 1 minutę, odśwież sklep

### "Nigdy nie dostałem maila z magic linkiem"

1. Sprawdź folder spam/wiadomości-śmieci
2. Niektórzy dostawcy maili (Gmail, Yahoo) opóźniają lub blokują maile od domyślnego nadawcy Supabase. Poczekaj 5 minut.
3. Jeśli wciąż nic: wejdź do panelu admina sklepu (musisz raz się normalnie zarejestrować), potem **Settings → Email** żeby skonfigurować właściwą usługę mailową (SendGrid, Postmark, Resend — wszystkie mają darmowe plany)

### "Nie mogę się zalogować — pisze że sesja wygasła"

Wyczyść ciasteczka przeglądarki dla URL sklepu, potem zaloguj się ponownie.

### "Jak dodać własną domenę typu mojsklep.pl?"

1. Kup domenę (Namecheap, OVH, AZ.pl, Cloudflare — dowolny rejestrator)
2. W Vercelu otwórz projekt Sellf → **Settings** → **Domains** → **Add**
3. Wpisz swoją domenę (np. `mojsklep.pl`) i kliknij **Add**
4. Vercel pokaże rekordy DNS do dodania — idź do rejestratora domeny i dodaj je
5. Poczekaj 5-30 minut aż domena zacznie działać
6. Zaktualizuj `SITE_URL` w environment variables Sellfa na nową domenę

### "Jak zaktualizować Sellf do najnowszej wersji?"

1. Otwórz projekt sklepu w Vercelu
2. Idź do zakładki **Deployments**
3. Kliknij **Redeploy** na najnowszym wdrożeniu

Vercel pobierze najnowszy kod Sellfa z Twojej kopii w GitHubie. Jeśli od Twojej konfiguracji wyszły aktualizacje, będą włączone.

### "Chcę usunąć sklep i zacząć od nowa"

1. Vercel: projekt → **Settings** → **General** → przewiń na dół → **Delete Project**
2. Supabase: dashboard → Twój projekt → **Settings** → **General** → **Delete project**
3. Stripe: strona webhooks → usuń endpoint

To usuwa wszystko w 1 minutę. Bez opłat.

---

## Inne sposoby na postawienie Sellfa (nieco bardziej techniczne)

Jeśli chcesz mieć większą kontrolę albo mniejsze miesięczne koszty:

- **[Przewodnik Netlify](./DEPLOYMENT-VERCEL-NETLIFY.md)** — ta sama trudność co Vercel, inna firma hostująca. Wybierz jeśli wolisz interfejs Netlify.
- **[Przewodnik Coolify](./DEPLOYMENT-COOLIFY.md)** — postaw Sellfa na własnym serwerze (wynajmij za ~$5-10/miesiąc). Więcej pracy przy konfiguracji ale taniej w długim biegu i daje pełną kontrolę. **Wymaga podstawowej znajomości serwerów linuksowych.**
- **[Przewodnik VPS / mikr.us](./DEPLOYMENT-MIKRUS.md)** — uruchamia się na tanim serwerze za 35 zł/rok. **Wymaga używania terminala i pisania komend.** Dla osób które chcą poznać techniczną stronę.
- **[Szczegółowy przewodnik Vercel/Netlify](./DEPLOYMENT-VERCEL-NETLIFY.md)** — to samo co ten przewodnik ale ze szczegółami technicznymi, skrótami z linii komend i pełną automatyzacją dla deweloperów.

Jeśli nie wiesz co wybrać, **zostań przy tym przewodniku (Vercel)** — jest zdecydowanie najprostszy, zawsze możesz przejść później.
