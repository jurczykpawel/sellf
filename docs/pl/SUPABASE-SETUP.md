**Język:** 🇵🇱 Polski · [🇬🇧 English](../SUPABASE-SETUP.md)

# Konfiguracja Supabase dla sklepu Sellf

Sellf potrzebuje miejsca na przechowywanie Twoich produktów, klientów i zamówień. Tym miejscem jest **Supabase** — darmowa usługa, która daje Sellfowi wszystko co potrzebuje do działania. Nie musisz nic instalować ani konfigurować technicznie; Supabase działa na ich komputerach, a Sellf po prostu rozmawia z nim przez internet.

Ten przewodnik pokazuje **trzy sposoby konfiguracji Supabase**, w kolejności od najprostszego (nic nie instalujesz, tylko klikasz przyciski w przeglądarce) do najbardziej technicznego (używasz terminala swojego komputera). Wybierz ten, który pasuje do Twojej swobody w pracy z komputerem.

**Wszystkie trzy sposoby dają dokładnie ten sam efekt** — działający Supabase z którego Sellf może korzystać. Różnią się tylko ilością rzeczy które klikasz sam vs. które robi za Ciebie program.

---

## Co będziesz miał na końcu

Projekt Supabase z pięcioma kawałkami informacji do wklejenia do Sellfa:

1. **Adres projektu** — adres internetowy typu `https://abcd1234.supabase.co`
2. **Klucz publiczny** — długi ciąg zaczynający się od `eyJ...` (bezpieczny do udostępniania, używany przez przeglądarki klientów)
3. **Klucz prywatny** — kolejny długi ciąg zaczynający się od `eyJ...` (**trzymaj w tajemnicy** — kto go ma, może odczytać wszystkie dane sklepu)
4. **Nazwa projektu (referencja)** — 16-literowe losowe słowo
5. **Hasło do bazy danych** — hasło które sam utworzysz (albo Supabase wygeneruje)

Nie musisz rozumieć co to znaczy. Po prostu kopiujesz do ustawień Sellfa i działa.

---

## Krok 1: Załóż konto Supabase (raz na zawsze, 30 sekund)

Robisz to **raz**. Potem możesz tworzyć dowolnie wiele projektów Supabase bez ponownej rejestracji.

1. Otwórz przeglądarkę i wejdź na **https://supabase.com/dashboard**
2. Zobaczysz stronę "Sign in"
3. Kliknij duży czarny przycisk **"Continue with GitHub"**
   - Jeśli nie masz konta GitHub, [załóż najpierw](https://github.com/signup) — darmowe, 1 minuta
4. GitHub spyta "Authorize Supabase?" — kliknij **Authorize Supabase**
5. Trafisz na dashboard Supabase (pusty bo nie masz jeszcze projektów)

To cała rejestracja. Bez potwierdzania emaila, bez karty kredytowej, bez czekania na akceptację.

> **Wskazówka:** "GitHub" to po prostu usługa do przechowywania kodu, ale Supabase używa go jako szybkiej metody na zweryfikowanie kim jesteś. Nie tworzysz żadnego kodu — używasz tylko nazwy użytkownika/hasła z GitHuba żeby zalogować się do Supabase.

---

## Krok 2: Utwórz projekt Supabase

Wybierz **jedną** z trzech opcji niżej. Najpierw przeczytaj wszystkie, potem wybierz tę która Ci najbardziej pasuje.

### 🟢 Opcja 1 — Najprostsza: niech Vercel utworzy projekt za Ciebie (bez terminala)

**Najlepsze dla:** osób które nie używały terminala, wolą klikać przyciski w przeglądarce.

**Czas:** około 5 minut.

**Będziesz potrzebował:** konta Vercel (https://vercel.com — zaloguj się przez GitHub, tak samo jak w Supabase).

**Jak to działa:** Vercel to firma która będzie hostować Twój sklep Sellf online. Mają wbudowaną funkcję która automatycznie tworzy dla Ciebie projekt Supabase. Autoryzujesz połączenie raz, klikasz "Create", a Vercel + Supabase załatwiają resztę w tle.

**Krok po kroku:**

1. Otwórz https://vercel.com/dashboard i zaloguj się
2. Kliknij **Add New** (prawy górny róg) → **Project**
3. W polu wyszukiwania wpisz `sellf`
4. Znajdź `jurczykpawel/sellf` na liście i kliknij **Import**
   - Jeśli nie widzisz, kliknij **Import Third-Party Git Repository** i wklej `https://github.com/jurczykpawel/sellf`
5. Zobaczysz ekran proszący o "Environment Variables". **Jeszcze nie wypełniaj** — zostaw stronę otwartą i kontynuuj:
6. Otwórz https://vercel.com/dashboard w **nowej zakładce przeglądarki** (żeby zostawić stronę deployu otwartą)
7. W nowej zakładce kliknij projekt Sellf który właśnie zaimportowałeś
8. W menu projektu kliknij **Storage** (lewy pasek boczny)
9. Kliknij **Connect Database**
10. Zobaczysz listę usług baz danych. Kliknij **Supabase**
11. Kliknij **Continue with Supabase**
12. Wyskoczy małe okienko pytające "Authorize Vercel to access Supabase?" — kliknij **Authorize**
13. Wybierz:
    - **Project name:** dowolne, np. `moj-sklep-sellf`
    - **Region:** najbliższy do miejsca gdzie mieszka większość Twoich klientów (zobacz [tabelę regionów](#który-region-wybrać) niżej)
    - **Database password:** kliknij **"Generate password"** — Supabase utworzy mocne dla Ciebie. **Kliknij ikonkę oka żeby pokazać hasło, potem skopiuj do menedżera haseł. Zapisz gdzieś bezpiecznie.** Będziesz potrzebował później jeśli zmieniasz bazy danych.
14. Kliknij **Create**
15. Vercel powie "Setting up your database..." — poczekaj około 2 minut
16. Gdy gotowe, zobaczysz Supabase na liście pod Storage z pięcioma podłączonymi zmiennymi środowiskowymi

Utworzyłeś projekt Supabase **i** połączyłeś go ze sklepem Sellf. Przejdź do [Kroku 3: Użyj tego co skonfigurowałeś](#krok-3-użyj-tego-co-skonfigurowałeś) niżej.

> **Co się właśnie stało?** Vercel utworzył konto na Supabase w Twoim imieniu (używając Twojej autoryzacji), utworzył tam projekt Supabase i automatycznie wpisał pięć potrzebnych wartości do ustawień projektu Vercel. Zobaczysz też ten projekt Supabase w swoim dashboardzie Supabase — pojawi się tam bo należy do Twojego konta Supabase.

---

### 🟡 Opcja 2 — Średnia: sam utwórz Supabase, potem skopiuj wartości (bez terminala)

**Najlepsze dla:** osób komfortowych z kopiowaniem długich ciągów między zakładkami przeglądarki.

**Czas:** około 8 minut.

**Będziesz potrzebował:** konta Supabase (z Kroku 1) i miejsca gdzie wkleisz wartości później (formularz deploya Sellfa, albo [Ścieżka 3](#-opcja-3--najbardziej-techniczna-niech-skrypt-wszystko-zrobi-z-twojego-komputera) niżej).

**Krok po kroku:**

1. Otwórz https://supabase.com/dashboard
2. Kliknij zielony przycisk **"New project"** (prawy górny róg dashboardu)
3. Wypełnij:
   - **Name:** coś co zapamiętasz, np. `moj-sklep-sellf`
   - **Database Password:** kliknij **"Generate a password"**. Gdy hasło pojawi się:
     - **Kliknij ikonkę oka żeby je pokazać**
     - **Skopiuj natychmiast** do menedżera haseł (albo wklej do pliku tekstowego który gdzieś bezpiecznie zapiszesz)
     - Nie zobaczysz tego hasła ponownie po zamknięciu strony (możesz zresetować, ale łatwiej zapisać teraz)
   - **Region:** wybierz najbliższy klientom. Zobacz [tabelę regionów](#który-region-wybrać) niżej
   - **Pricing Plan:** zostaw **Free**
4. Kliknij **"Create new project"** (prawy dolny róg)
5. Supabase pokaże ekran "Setting up project..." — poczekaj około 2 minut. Nie zamykaj strony.
6. Gdy dashboard się załaduje, spójrz na URL w przeglądarce. Wygląda jak:
   `https://supabase.com/dashboard/project/abcd1234efgh5678`
   Część po `/project/` (`abcd1234efgh5678` w tym przykładzie) to Twoja **referencja projektu**. **Zapisz to też.**
7. W lewym pasku bocznym kliknij ikonkę koła zębatego (**Settings**)
8. Kliknij **API** (w menu Settings)
9. Zobaczysz stronę "Project API". Ma trzy informacje których potrzebujesz:
   - **Project URL** — wygląda jak `https://abcd1234.supabase.co`. **Skopiuj.**
   - Sekcja **Project API keys** — dwa długie ciągi:
     - **anon public** — długi ciąg zaczynający się od `eyJhbGci...`. **Skopiuj.** To "klucz publiczny."
     - **service_role** **secret** — kolejny długi ciąg od `eyJhbGci...`. **Najpierw kliknij "Reveal"**, potem skopiuj. To "klucz prywatny." **Trzymaj w tajemnicy. Kto go ma, może odczytać wszystkie dane sklepu.**

Masz wszystko czego potrzebujesz:
- Project URL ✓
- Klucz publiczny (anon) ✓
- Klucz prywatny (service_role) ✓
- Referencja projektu (z URL) ✓
- Hasło do bazy (zapisałeś w kroku 3) ✓

Przejdź do [Kroku 3: Użyj tego co skonfigurowałeś](#krok-3-użyj-tego-co-skonfigurowałeś).

---

### 🔴 Opcja 3 — Najbardziej techniczna: niech skrypt wszystko zrobi z Twojego komputera

**Najlepsze dla:** osób które używały już terminala/linii komend.

**Czas:** około 5 minut gdy już zrobisz jednorazową konfigurację.

**Będziesz potrzebował:** aplikacji terminala (na Macu to "Terminal", na Windowsie to "PowerShell", na Linuksie wiesz już o co chodzi), plus trzech programów zwanych **narzędziami CLI**.

**Jednorazowa konfiguracja (tylko za pierwszym razem):**

1. Otwórz terminal
2. Zainstaluj trzy małe programy wpisując te komendy jedna po drugiej i naciskając Enter:
   ```
   npm install -g vercel supabase
   ```
   (Jeśli `npm` nie jest zainstalowane, najpierw [zainstaluj Node.js](https://nodejs.org/) — przychodzi z `npm`.)
3. Zainstaluj narzędzie Stripe ([instrukcje dla Twojego systemu](https://docs.stripe.com/stripe-cli#install))
4. Zaloguj się do wszystkich trzech uruchamiając:
   ```
   vercel login
   supabase login
   stripe login
   ```
   Każdy otworzy okno przeglądarki proszące o potwierdzenie.

**Za każdym razem gdy chcesz nowy sklep Sellf:**

```
git clone https://github.com/jurczykpawel/sellf.git
cd sellf
./scripts/install-vercel.sh
```

Skrypt zapyta o dwa klucze Stripe (możesz je dostać z https://dashboard.stripe.com/test/apikeys — szczegóły w przewodniku deploy) i potem zrobi wszystko automatycznie:
- Utworzy projekt Supabase
- Poczeka aż skończy konfigurację
- Pobierze pięć wartości Supabase
- Skonfiguruje resztę Sellfa
- Wyświetli działający adres internetowy na końcu

Nie musisz nic kopiować między zakładkami. Skrypt robi wszystko.

Jeśli wolisz żeby skrypt użył istniejącego projektu Supabase (utworzonego przez Opcję 1 albo 2), przekaż wartości:

```
./scripts/install-vercel.sh \
    --skip-supabase \
    --supabase-url     https://abcd1234.supabase.co \
    --supabase-anon    "<wklej klucz publiczny>" \
    --supabase-svc     "<wklej klucz prywatny>" \
    --supabase-ref     abcd1234 \
    --db-password      "<wklej hasło>"
```

---

## Krok 3: Użyj tego co skonfigurowałeś

Co robisz dalej zależy od opcji którą wybrałeś:

- **Opcja 1 (Vercel auto-integracja):** otwórz [Przewodnik Vercel/Netlify](./DEPLOYMENT-VERCEL-NETLIFY.md) i podążaj od **Kroku 4** (pomiń części Supabase — już je zrobiłeś)
- **Opcja 2 (ręcznie):** otwórz [Przewodnik Vercel/Netlify](./DEPLOYMENT-VERCEL-NETLIFY.md) i wklej pięć wartości do formularza gdy będzie poproszony
- **Opcja 3 (skrypt):** skrypt już wszystko zrobił — Twój sklep jest online

---

## Który region wybrać?

Wybierz najbliższy temu gdzie będzie większość Twoich klientów. Wybór dobrego regionu sprawia że sklep ładuje się 5-10× szybciej dla tych klientów.

| Gdzie są Twoi klienci | Wybierz |
|--------------------------|-------------------|
| Polska / Europa | `eu-central-1` Frankfurt |
| USA (wschód) lub mieszani | `us-east-1` N. Virginia |
| USA (zachód) | `us-west-1` Oregon |
| Azja (ogólnie) | `ap-southeast-1` Singapur |
| Japonia / Korea Płd. | `ap-northeast-1` Tokio |
| Brazylia / Ameryka Płd. | `sa-east-1` São Paulo |
| Australia / Nowa Zelandia | `ap-southeast-2` Sydney |

Jeśli nie jesteś pewien: wybierz kraj w którym mieszkasz. Nie da się zmienić regionu później bez tworzenia projektu od nowa, więc pomyśl o typowym kliencie.

---

## Co dostajesz za darmo (i co kosztuje później)

Darmowy plan Supabase wystarcza dla większości startujących sklepów.

| | Darmowy plan | Kiedy go przerośniesz |
|---|---|---|
| **Rozmiar bazy** | 500 MB | Sklep z 50 000 klientów i rokiem zamówień łatwo się mieści. Dane sklepowe (zamówienia, produkty, użytkownicy) są malutkie. |
| **Przestrzeń na pliki** | 1 GB | Tylko jeśli przechowujesz produkty cyfrowe w Supabase. Większość operatorów trzyma pliki produktów u tańszych hostów typu Cloudflare R2 lub Backblaze B2. |
| **Miesięcznie aktywnych użytkowników** | 50 000 | "Aktywny" znaczy zalogowany. Dużo dla typowego sklepu. |
| **Ile projektów możesz mieć** | 2 aktywne na organizację | Większość nigdy nie potrzebuje więcej niż jednego. Jeśli testujesz, możesz chcieć drugiej organizacji (darmowo zrobisz drugi login GitHub i zarejestrujesz się ponownie). |
| **Pauza nieaktywności** | Pauzuje się po 7 dniach zera ruchu na projekt | Każdy ruch na sklep resetuje licznik, więc dla wystartowanego sklepu z choćby okazjonalnymi gośćmi to rzadkość. |

**Kiedy aktualizować do Supabase Pro ($25/miesiąc):**

- Twoja baza zbliża się do 500 MB
- Przekroczysz 50 000 miesięcznie aktywnych użytkowników
- Potrzebujesz automatycznych codziennych backupów (darmowy plan robi tylko point-in-time recovery w ciągu 7 dni)
- Chcesz więcej zapasu — plan Pro również podnosi storage do 100 GB i limity transferu

Nie musisz aktualizować żeby wystartować. Zacznij za darmo, aktualizuj gdy uderzysz w limit (panel Supabase pokazuje wykresy zużycia więc zobaczysz to z wyprzedzeniem).

---

## Typowe pytania

### "Mój projekt Supabase się spauzował. Co zrobić?"

Jeśli przez 7 dni nie wejdziesz do sklepu Sellf, Supabase automatycznie pauzuje projekt żeby oszczędzić swoich kosztów. Odwiedzający widzą błędy, nikt nie może się zarejestrować, admini nie mogą się zalogować.

**Żeby go obudzić:**
1. Otwórz https://supabase.com/dashboard
2. Znajdź projekt (oznaczony "Paused")
3. Kliknij na niego, potem **Restore** u góry
4. Poczekaj około 1 minuty

Żeby **zapobiec** temu: albo aktualizuj do Pro, albo upewnij się że sklep ma przynajmniej jednego gościa tygodniowo (jakikolwiek normalny ruch się liczy).

### "A jeśli zapomnę hasła do bazy?"

Tak naprawdę nie potrzebujesz go większość czasu — Sellf go nie pyta po skonfigurowaniu. Ale jeśli potrzebujesz do czegoś specjalnego (np. przeniesienia na inny host), możesz zresetować:

1. Otwórz https://supabase.com/dashboard
2. Kliknij projekt
3. Kliknij ikonkę koła zębatego (Settings) w lewym pasku
4. Kliknij **Database**
5. Znajdź sekcję **Database password** i kliknij **Reset database password**
6. Zapisz nowe hasło gdzieś bezpiecznie

Po resecie musisz zaktualizować hasło w ustawieniach Sellfa (tam gdzie wkleiłeś wcześniej) i zrestartować sklep.

### "Czy mogę przenieść sklep Sellf do innego projektu Supabase później?"

Tak. Zrobiłbyś:
1. Utworzyć nowy projekt Supabase (jedna z trzech opcji wyżej)
2. Wyeksportować dane ze starego projektu (support hostingowy zwykle pomaga, albo uruchom `pg_dump`)
3. Zaimportować do nowego
4. Zaktualizować ustawienia Sellfa na wartości nowego projektu
5. Zrestartować sklep

To nie jest coś co robisz przypadkowo ale nie jest trudne jeśli potrzebujesz.

### "Nie chcę używać usługi chmurowej w ogóle. Mogę uruchomić Supabase samodzielnie?"

Tak, na własnym serwerze — zobacz [Przewodnik Coolify](./DEPLOYMENT-COOLIFY.md) (Coolify wdraża pełny stack Supabase obok Sellfa) albo [FULL-STACK.md](../FULL-STACK.md) (Docker Compose z 11 kontenerami).

### "Gdzie znajdę referencję projektu jeśli mi umknęła?"

Otwórz https://supabase.com/dashboard i kliknij projekt. Spójrz na pasek adresu w przeglądarce. URL jest typu:

```
https://supabase.com/dashboard/project/abcd1234efgh5678
```

Wszystko po `/project/` to referencja projektu (`abcd1234efgh5678` w tym przykładzie).
