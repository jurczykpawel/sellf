---
title: Konfiguracja środowiska
description: Konfiguracja adresów i usług Sellf w runtime.
---

Ustaw `SITE_URL=https://twoj-sklep.pl` w środowisku uruchomieniowym Sellf (np.
`admin-panel/.env.local`). Podaj publiczny origin bez ścieżki. Ten adres jest używany
w e-mailach, checkout, metadanych i sitemap również w gotowych release’ach.
Restart aplikacji stosuje zmianę; ponowny build nie jest potrzebny.

Kolejność: `SITE_URL`, potem `MAIN_DOMAIN` (HTTPS, localhost HTTP), na końcu legacy
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL` odczytane w runtime.
Zmienne URL `NEXT_PUBLIC_*` nie są potrzebne przy instalowaniu release’u.
Placeholdery są odrzucane; produkcja nie uruchomi się bez poprawnego adresu.
Przeglądarka otrzymuje konfigurację przez `/api/runtime-config`; walidacja redirectów
w przeglądarce porównuje origin aktualnej strony.

Ustaw `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` i klucze Stripe
w runtime. Gdy Supabase jest dostępny dla serwera pod adresem wewnętrznym, ustaw
`PUBLIC_SUPABASE_URL` na adres osiągalny z przeglądarki. Brak runtime-config oznacza
błąd uwierzytelniania, a nie połączenie z hostem zastępczym.

W Supabase Auth dodaj `https://twoj-sklep.pl/auth/callback` lub
`https://twoj-sklep.pl/**` do **Redirect URLs**. Sellf gwarantuje absolutny callback
z `?`, ponieważ szablony dopisują `&token_hash`. Nie zmieniaj tego formatu szablonów.
Lista redirectów Supabase jest niezależna od konfiguracji Sellf; aplikacja nie może
jej tanio odczytać przy starcie. Sprawdź rzeczywisty link w dostarczonym e-mailu po
konfiguracji. Odrzucony redirect zostaje zastąpiony Site URL Supabase i może zepsuć link.

CI przed spakowaniem i podpisaniem release’u sprawdza artefakt na obecność placeholderów.
Regresja produkcyjna: `node scripts/run-runtime-url-tests.mjs` z `admin-panel/`.
Buduje z placeholderami, uruchamia na 3777 z prawdziwym runtime, sprawdza Mailpit,
logowanie, darmowy dostęp, embed Stripe, sitemap i metadane. Wymaga działającego
lokalnego Supabase z allowlistą dla 3777 i testowego klucza Stripe; nie resetuje bazy.
