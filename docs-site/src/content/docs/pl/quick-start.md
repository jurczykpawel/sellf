---
title: "Uruchamianie sklepu Sellf — najprostszy sposób"
description: "Ten przewodnik pokazuje krok po kroku tę najprostszą ścieżkę: wszystko w przeglądarce, bez instalowania programów, bez terminala."
---

**Język:** 🇵🇱 Polski · [🇬🇧 English](/quick-start/)


> **Koszt w skrócie:** możesz wystartować za **$0/miesiąc** (Vercel + darmowy Supabase Cloud) i większość małych sklepów zostaje za darmo przez lata. Jeśli wolisz app na własnym serwerze, typowo **~$5/miesiąc** za tani VPS — Supabase wciąż zostaje na darmowym cloud planie obsługując bazę. Więcej płacisz tylko przy realnej skali, opisane niżej.
>
> ## 🏆 Najłatwiejsza metoda (ten przewodnik)
>
> - **Co:** przycisk one-click Vercel + wbudowana baza Supabase w Vercelu (Supabase Cloud, darmowy plan)
> - **Wymagane umiejętności:** żadne — tylko przeglądarka
> - **Czas konfiguracji:** ~20 minut
> - **Koszt:** **$0/miesiąc** na start i większość małych sklepów Sellf zostaje na $0/miesiąc przez lata (Vercel Hobby + Supabase Free mają hojne limity — szczegóły niżej)
> - **Prowizja Stripe** (na każdej ścieżce): ~2,9% + 0,30 USD od transakcji
>
> **Dla kogo:** dla każdego kto nigdy nie stawiał oprogramowania na serwerze. Jeśli to Ty, przestań czytać zielony blok niżej i podążaj za tym przewodnikiem.
>
> ## 💰 Własny VPS (wymaga terminala)
>
> - **Co:** appka Sellf na Twoim tanim VPS, Supabase wciąż na darmowym cloud planie obsługując bazę. Sam Sellf chodzi w ~500 MB RAM, więc podstawowy VPS w zupełności wystarczy.
> - **Wymagane umiejętności:** komfort z SSH, kopiowanie komend Linuksowych, uruchomienie skryptu w terminalu
> - **Czas konfiguracji:** ~45 minut
> - **Koszt:** typowo **~$5/miesiąc** (Hetzner CAX11, podstawowy droplet DigitalOcean itp.) za VPS; Supabase zostaje $0 na darmowym cloud planie. Spada do **~$1/miesiąc** z [mikr.us](https://mikr.us/?r=pavvel) (35 zł/rok, 384 MB RAM — wystarcza na Sellfa).
> - **Prowizja Stripe** (na każdej ścieżce): te same ~2,9% + 0,30 USD od transakcji
>
> **Dla kogo:** osoby przyzwyczajone do serwerów Linuksowych które chcą mieć app na własnej infrastrukturze ale bez kosztu prowadzenia pełnego Supabase samodzielnie.
>
> **Chcesz pełne instrukcje?** Zobacz [DEPLOYMENT-MIKRUS.md](/deployment-mikrus/) dla najtańszego mikr.us setup. Jeśli wolisz też self-hostować Supabase na tej samej maszynie (czyli zero Supabase Cloud), to osobna ścieżka wymagająca 8 GB+ RAM (~$9/miesiąc na Hetzner CX32) — zobacz [DEPLOYMENT-COOLIFY.md](/pl/deployment-coolify/).
>
> ## Kiedy faktycznie musisz aktualizować?
>
> Darmowy plan Supabase pokrywa typowy mały sklep Sellf przez **lata**, nie miesiące. Nie musisz aktualizować po prostu dlatego że masz klientów — darmowy plan jest hojny. Aktualizujesz gdy uderzasz w jeden z tych realnych limitów:
>
> | Limit (darmowy plan) | Mniej więcej kiedy to się staje istotne |
> |----------------------|------------------------------------------|
> | **500 MB bazy danych** | Sklep z ~50 000 klientów i rokiem zamówień spokojnie się mieści. Większość sklepów zapełnia 500 MB w 3-4 lata. |
> | **1 GB storage plików** | Tylko jeśli wrzucasz pliki produktów do Supabase. Większość operatorów hostuje pliki na tańszych usługach (Cloudflare R2, Backblaze B2) i nigdy nie dotyka tego limitu. |
> | **50 000 miesięcznie aktywnych użytkowników** | "Aktywny" = zalogowany. Mnóstwo miejsca dla sklepu z dziesiątkami tysięcy wracających klientów. |
> | **2 projekty na organizację** | Jeden projekt na sklep. Jeśli chcesz testowy obok produkcyjnego, to drugi slot. |
> | **Brak codziennych backupów (tylko 7-dniowe point-in-time recovery)** | Gdy utrata danych to "koniec biznesu", codzienne backupy z Pro są warte $25/miesiąc. |
>
> Praktycznie: **zacznij za darmo**, aktualizuj w dniu w którym jeden z tych limitów faktycznie Cię uderza. Vercel i Supabase oba pokazują wykresy zużycia w dashboardach więc zobaczysz to z tygodniami zapasu.
>
> ---
>
> **Nie jesteś pewien co wybrać?** Jeśli nigdy nie używałeś SSH do serwera, najłatwiejsza metoda (ten przewodnik) to właściwy wybór — sklep może zostać $0/miesiąc przez lata, a nawet przy skali koszty aktualizacji są skromne. Zawsze możesz później przenieść się na własny VPS żeby obciąć koszty; dane i sklep zostają te same.

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

1. Otwórz ten specjalny link: [https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjurczykpawel%2Fsellf&root-directory=admin-panel&env=CHECKOUT_BINDING_SECRET,TRUSTED_PROXY,APP_ENCRYPTION_KEY,LOGINWALL_SECRET,STRIPE_SECRET_KEY,STRIPE_PUBLISHABLE_KEY,SITE_URL&project-name=sellf&repository-name=sellf](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjurczykpawel%2Fsellf&root-directory=admin-panel&env=CHECKOUT_BINDING_SECRET,TRUSTED_PROXY,APP_ENCRYPTION_KEY,LOGINWALL_SECRET,STRIPE_SECRET_KEY,STRIPE_PUBLISHABLE_KEY,SITE_URL&project-name=sellf&repository-name=sellf)

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

## Krok 9: Podłącz płatności Stripe (1 minuta, 1 klik)

Sklep jest online ale Stripe jeszcze nie wie jak wysyłać mu powiadomienia o płatnościach. Sellf zrobi to za Ciebie jednym kliknięciem — bez wizyt w Stripe Dashboard.

1. Otwórz URL swojego sklepu (adres `*.vercel.app` z Kroku 8)
2. Kliknij **Sign up** albo **Login** → wpisz email → submit
3. Sprawdź skrzynkę (i spam — darmowy SMTP Supabase często tam ląduje). Kliknij magic link
4. Jesteś w panelu admina. **Pierwsza osoba która się zarejestruje automatycznie staje się adminem** — czyli Ty.
5. Kliknij **Settings** w menu po lewej (albo idź na `/dashboard/settings`)
6. Otwórz zakładkę **Payments**
7. Znajdź kafelek **Stripe Webhook**. Kliknij **Zarejestruj webhook**
8. To wszystko. Sellf wywołuje Stripe za Ciebie: tworzy webhook endpoint wskazujący na Twój sklep, subskrybuje wszystkie potrzebne eventy i zapisuje signing secret zaszyfrowany w Twojej bazie.

> **Co się właśnie stało?** Bez kopiowania, bez wycieczki do Stripe Dashboard, bez edytowania env vars. Sellf trzyma signing secret w Twojej bazie Supabase zamiast w env var, więc to działa w momencie kliknięcia przycisku.

---

## Krok 10: Przetestuj czy płatności działają (2 minuty)

Jesteś już zalogowany jako admin z Kroku 9 — teraz weryfikujesz że prawdziwa płatność przechodzi end-to-end.

1. W panelu admina utwórz testowy produkt:
   - Kliknij **Products** → **New product**
   - Title: "Produkt testowy"
   - Price: 5 (PLN/USD/EUR — wybierz walutę)
   - Kliknij **Save**
2. Odwiedź publiczną stronę produktu (kliknij link slug)
3. Kliknij **Buy**
4. Na stronie płatności Stripe użyj fałszywej karty testowej:
   - **Card number:** `4242 4242 4242 4242`
   - **Expiration:** dowolna przyszła data (np. `12/30`)
   - **CVC:** dowolne 3 cyfry (np. `123`)
   - **ZIP:** dowolny (np. `12345`)
5. Kliknij **Pay**
6. Powinieneś trafić na stronę "Success"

Teraz sprawdź czy Stripe dostał płatność:

7. Otwórz https://dashboard.stripe.com/test/payments
8. Powinieneś zobaczyć Twoją testową płatność na liście

Powinno być też w Twoim panelu admina:

9. Wróć do sklepu, kliknij **Admin → Payments**
10. Twoja testowa płatność też tu jest (webhook zarejestrowany w Kroku 9 to to co tworzy ten wiersz)

🎉 Twój sklep w pełni działa. Dodawaj prawdziwe produkty, udostępniaj link światu, sprzedawaj.

---

## Przechodzenie na żywo: z trybu testowego na prawdziwe płatności

Gdy jesteś gotowy przyjmować prawdziwe pieniądze:

1. W Stripe kliknij **Activate payments** (prawy górny róg)
2. Wypełnij dane firmy: nazwę, adres, konto bankowe, weryfikacja tożsamości
3. Poczekaj aż Stripe zatwierdzi (zwykle kilka minut dla kont osobistych, kilka godzin dla firm)
4. Po zatwierdzeniu zobaczysz nowe "Live" klucze API w https://dashboard.stripe.com/apikeys (już nie test). Zaczynają się od `pk_live_...` i `sk_live_...`
5. Zaktualizuj dwa ustawienia w Vercelu (Settings → Environment Variables):
   - `STRIPE_SECRET_KEY` → Twój `sk_live_...`
   - `STRIPE_PUBLISHABLE_KEY` → Twój `pk_live_...`
6. Redeploy (Deployments → ostatni → trzy kropki → Redeploy)
7. Wróć do admina sklepu → **Settings → Payments** → kliknij **Zarejestruj webhook** jeszcze raz. Sellf tworzy świeży webhook na endpoint live Stripe i zapisuje nowy signing secret w bazie — ten sam one-click flow co w trybie test.

Teraz przyjmujesz prawdziwe pieniądze. Prawdziwi klienci płacą prawdziwymi kartami, pieniądze lądują na Twoim koncie bankowym zgodnie z normalnym harmonogramem Stripe.

---

## Co kosztuje gdy sklep rośnie

Krótko: **większość małych sklepów Sellf zostaje na $0/miesiąc przez lata.** Zapłacisz coś dopiero gdy przerośniesz konkretne limity — a koszty aktualizacji są wtedy umiarkowane.

| Gdzie jesteś | Typowy koszt miesięczny | Co jest pokryte |
|--------------|-------------------------|------------------|
| Dzień 1, testujesz sklep | **$0** | Vercel Hobby + Supabase Free mają hojne limity |
| Pierwsi płacący klienci | **$0** | Darmowy plan dalej pasuje — sklep z setkami klientów/mies jest daleko od limitów |
| Stabilny sklep, umiarkowany ruch | **$0** | Limity Vercel Hobby i Supabase Free pokrywają większość małych sklepów cyfrowych 3-4 lata |
| Baza zapełnia się (~500 MB) | **$25/mies** (Supabase Pro) | Więcej miejsca w bazie (8 GB) + automatyczne codzienne backupy |
| Uderzysz w limit zasobu Vercel Hobby (rzadko; zobacz tabelę niżej) | **+$20/mies** (Vercel Pro) | Wyższe quoty, bez twardych stopów |
| Chcesz przerzucić app na własny VPS żeby ograniczyć koszty | **~$5/mies** | Tani VPS hostujący Sellfa; Supabase zostaje na darmowym cloud planie — zobacz [DEPLOYMENT-MIKRUS.md](/deployment-mikrus/) |
| Chcesz wszystko self-hostować (zero Supabase Cloud) | **~$9/mies** | 8 GB VPS z Sellfem + self-hosted Supabase stack — zobacz [DEPLOYMENT-COOLIFY.md](/pl/deployment-coolify/) |

Po polsku: **$0 na start, $0 dla większości małych sklepów przez lata, około $5/miesiąc jeśli wolisz mieć app na własnym serwerze, a $25-45/miesiąc tylko jeśli urośniesz na tyle żeby potrzebować Supabase Pro i/lub Vercel Pro.**

### Vercel Hobby — co jest w darmowym planie i kiedy uderza w twardy stop

Vercel Hobby jest hojny, ale w przeciwieństwie do "pay for what you use" ma twarde stopery — gdy uderzysz w limit sklep zwraca 503 do następnego cyklu. Dobra wiadomość: dla typowego sklepu Sellf te limity pokrywają **50 000-200 000 wizyt miesięcznie** zanim musisz myśleć o Vercel Pro.

| Zasób | Limit darmowy miesięczny | Co pokrywa dla sklepu Sellf |
|-------|--------------------------|------------------------------|
| **Fast Data Transfer** (transfer) | 100 GB | Każda wizyta ~200-500 KB → 100 GB pokrywa ~200 000 wizyt/miesiąc |
| **Function Invocations** | 1 000 000 | Jedno na ładowanie strony + kilka per webhook → 50-200k wizyt |
| **Active CPU** | 4 godziny | Sumaryczny czas procesora przez wszystkie funkcje; Sellf używa bardzo mało |
| **Edge Requests** | 1 000 000 | Cachowane statyczne assety — ~50k unikalnych wizyt miesięcznie |
| **Image Transformations** | 5 000 | Zdjęcia produktów scaled-on-the-fly |
| **Pamięć buildów** | 360 GB-godzin | Praktycznie nieograniczone dla Sellfa |
| **Deploymenty** | bez limitu | Redeploy ile chcesz |
| **Team members** | 1 seat | Tylko Ty |

### Uwaga: Vercel Hobby jest oficjalnie "do osobistego, niekomercyjnego użytku"

Regulamin Vercela mówi że Hobby jest "do osobistego, niekomercyjnego użytku." Ściśle mówiąc, sklep przyjmujący płatności od klientów jest komercyjny.

W praktyce Vercel rzadko flaguje małe sklepy komercyjne — wielu indie operatorów spokojnie chodzi na Hobby przez lata. Jeśli ruch jest mały a Twoje sumienie albo dział prawny chce Cię na Pro, upgrade kosztuje $20/miesiąc. Jeśli chcesz całkowicie uniknąć tego pytania, ścieżka własnego VPS (~$5/miesiąc) nie ma takich ograniczeń.

### Prowizja Stripe od transakcji (na każdej ścieżce)

Stripe pobiera ~2,9% + 0,30 USD od transakcji (stawki różnią się wg kraju — zobacz https://stripe.com/pl/pricing; w Polsce dla kart PLN to typowo 1,5% + 1 zł). Jest taka sama na każdej ścieżce wdrożenia.

## Wszystkie opcje wdrożenia wg kosztów

Ten przewodnik używa **najłatwiejszej ścieżki** (Vercel + Supabase Cloud, obie darmowe). Porównanie alternatyw:

| Ścieżka | Typowy koszt miesięczny | Czas konfiguracji | Wymagana wiedza | Dla kogo |
|---------|------------------------|-------------------|------------------|----------|
| **Vercel + Supabase Cloud (ten przewodnik)** | **$0**, zostaje za darmo dla większości małych sklepów przez lata | ~20 min | 🟢 Żadna — tylko przeglądarka | Pierwszy sklep, użytkownik nietechniczny. Rekomendowana ścieżka. |
| [Netlify + Supabase Cloud](/pl/deployment-vercel-netlify/) | To samo co Vercel: $0 | ~20 min | 🟢 Żadna — tylko przeglądarka | To samo co Vercel, inny host |
| [Tani VPS + Supabase Cloud](/deployment-mikrus/) | **~$5/mies** za VPS (Hetzner CAX11, podstawowy DO itp.); Supabase zostaje $0 na darmowym cloud planie | ~45 min | 🟡 Podstawowa — SSH, uruchomienie skryptu | Chcesz app na własnej infrastrukturze ale zachowujesz zarządzaną bazę |
| [mikr.us + Supabase Cloud](/deployment-mikrus/) | **~4 zł/mies** (35 zł/rok mikr.us 1.0); Supabase $0 | ~45 min | 🔴 Średnia — SSH, PM2 | Absolutnie najtaniej jeśli czas masz za darmo |
| [Coolify Cloud + Hetzner](/pl/deployment-coolify/) | **~$14/mies** ($5 Coolify Cloud + $9 Hetzner CX32). Pozwala self-hostować stos Supabase na tym samym VPS — bez Supabase Cloud | ~30 min | 🟡 Podstawowa — wklejenie klucza SSH | Pełna kontrola + zarządzany panel Coolify, bez rachunku za Supabase Cloud |
| [Coolify self-hosted + Hetzner](/pl/deployment-coolify/) | **~$9/mies** (Hetzner CX32, reszta darmowa). Self-hostuje cały stos włącznie z Supabase | ~45 min | 🟡 Podstawowa — SSH, kilka sekretów | Pełna kontrola, bez rachunku za Supabase Cloud |

**Prowizja Stripe od transakcji** (~2,9% + 0,30 USD) jest taka sama na każdej ścieżce.

**Rekomendacja dla użytkownika nietechnicznego:** **zostań przy tym przewodniku**. $0/miesiąc, i zostaje $0 dla większości małych sklepów przez lata. Zawsze możesz przejść na własny VPS później żeby ograniczyć koszty — to nie jednokierunkowe drzwi.

**Rekomendacja dla osoby komfortowej z serwerami i chcącej własnej infrastruktury:** ścieżka **~$5/mies VPS + Supabase Cloud free**. Najlepszy balans kosztu vs wysiłku: zachowujesz zarządzaną bazę, a app na tanim VPS daje Ci pełną kontrolę nad runtime. Jeśli chcesz też zrezygnować z Supabase Cloud, **Coolify self-hosted na Hetzner CX32 (~$9/mies)** uruchamia cały stos na jednej maszynie.

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

- **[Przewodnik Netlify](/pl/deployment-vercel-netlify/)** — ta sama trudność co Vercel, inna firma hostująca. Wybierz jeśli wolisz interfejs Netlify.
- **[Przewodnik Coolify](/pl/deployment-coolify/)** — postaw Sellfa na własnym serwerze (wynajmij za ~$5-10/miesiąc). Więcej pracy przy konfiguracji ale taniej w długim biegu i daje pełną kontrolę. **Wymaga podstawowej znajomości serwerów linuksowych.**
- **[Przewodnik VPS / mikr.us](/deployment-mikrus/)** — uruchamia się na tanim serwerze za 35 zł/rok. **Wymaga używania terminala i pisania komend.** Dla osób które chcą poznać techniczną stronę.
- **[Szczegółowy przewodnik Vercel/Netlify](/pl/deployment-vercel-netlify/)** — to samo co ten przewodnik ale ze szczegółami technicznymi, skrótami z linii komend i pełną automatyzacją dla deweloperów.

Jeśli nie wiesz co wybrać, **zostań przy tym przewodniku (Vercel)** — jest zdecydowanie najprostszy, zawsze możesz przejść później.
