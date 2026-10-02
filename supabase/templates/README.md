# Szablony Email Sellf

Szablony emaili dla Supabase Auth używane przez Sellf. Wszystkie linki
logowania (magic link, invite) muszą nieść `{{ .TokenHash }}`, bo tego
wymaga `/auth/callback` w admin-panelu — domyślne szablony GoTrue tego nie
robią.

**To jest źródło prawdy** — Supabase CLI (`supabase/config.toml`) czyta
szablony właśnie stąd, a te same pliki trafiają do release'u i obrazu
Dockera (`.github/workflows/build-release.yml`, `Dockerfile`), które
odrzucają dowiązania symboliczne w archiwum/obrazie. `admin-panel/public/auth-email-templates/*.html`
(Opcja 3 niżej) to zwykłe pliki będące **mirrorem** tej samej treści — nie
dowiązaniem — bo Sellf musi je serwować jako statyczne zasoby HTTP z
katalogu `public/`. Zgodność mirrora z oryginałem pilnuje test jednostkowy
(`admin-panel/tests/unit/scripts/docker-compose-contract.test.ts`, ten sam
wzorzec co dla `admin-panel/scripts/release-signing-key.pub.pem`). Aby
zaktualizować szablon: edytuj plik tutaj, skopiuj go 1:1 do
`admin-panel/public/auth-email-templates/`, potem uruchom
`bunx vitest run tests/unit/scripts/docker-compose-contract.test.ts` żeby
potwierdzić że oba pliki znów są bajt-w-bajt identyczne.

## Pliki

| Plik | Przeznaczenie | Pole API (Cloud) |
|------|---------------|----------|
| `magic-link.html` | Login przez email (magic link) | `mailer_templates_magic_link_content` |
| `confirmation.html` | Potwierdzenie rejestracji | `mailer_templates_confirmation_content` |
| `recovery.html` | Reset hasła | `mailer_templates_recovery_content` |
| `email-change.html` | Zmiana adresu email | `mailer_templates_email_change_content` |
| `invite.html` | Zaproszenie do aplikacji | `mailer_templates_invite_content` |

Pełny poradnik SMTP, DNS, szablonów i przekierowań: [po polsku](https://docs.sellf.app/pl/email-setup/) / [in English](https://docs.sellf.app/email-setup/).

## Konfiguracja

### Opcja 1: Dashboard Supabase (Cloud)

1. Przejdź do **Authentication** → **Email Templates** w dashboardzie Supabase
2. Skopiuj zawartość odpowiedniego pliku HTML
3. Wklej do edytora szablonu
4. Zapisz zmiany

### Opcja 2: API Management (Cloud)

```bash
# Przykład aktualizacji szablonu magic link
curl -X PATCH "https://api.supabase.com/v1/projects/{project_ref}/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mailer_templates_magic_link_content": "<zawartość HTML>"
  }'
```

Wymaga `SUPABASE_ACCESS_TOKEN` (Management API) dla Twojego projektu.

### Opcja 3: Self-hosted GoTrue (URL, bez kopiowania)

GoTrue w self-hosted Supabase pobiera szablon spod **URL-a**. Sellf serwuje
te same pliki jako statyczne zasoby pod `/auth-email-templates/*.html` — nie
trzeba nic kopiować, wystarczy wskazać własną domenę Sellfa w `.env`
Twojego stosu Supabase:

```env
GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=https://twoja-domena-sellf/auth-email-templates/magic-link.html
GOTRUE_MAILER_TEMPLATES_CONFIRMATION=https://twoja-domena-sellf/auth-email-templates/confirmation.html
GOTRUE_MAILER_TEMPLATES_RECOVERY=https://twoja-domena-sellf/auth-email-templates/recovery.html
GOTRUE_MAILER_TEMPLATES_INVITE=https://twoja-domena-sellf/auth-email-templates/invite.html
GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE=https://twoja-domena-sellf/auth-email-templates/email-change.html
GOTRUE_URI_ALLOW_LIST=https://twoja-domena-sellf/*
```

Pełny kontekst wdrożenia: [`full-stack.md`](https://docs.sellf.app/full-stack/#part-2--magic-link-email-templates).

## Dostępne zmienne

| Zmienna | Opis |
|---------|------|
| `{{ .Token }}` | Token jednorazowy |
| `{{ .TokenHash }}` | Hash tokena (do URL) |
| `{{ .SiteURL }}` | URL aplikacji |
| `{{ .Email }}` | Email użytkownika |
| `{{ .ConfirmationURL }}` | Pełny URL potwierdzenia |

## Tematy emaili (zalecane)

Ustaw w dashboardzie Supabase lub przez API:

| Pole | Wartość |
|------|---------|
| `mailer_subjects_magic_link` | `Zaloguj się do Sellf` |
| `mailer_subjects_confirmation` | `Potwierdź swój email - Sellf` |
| `mailer_subjects_recovery` | `Zresetuj hasło - Sellf` |
| `mailer_subjects_email_change` | `Potwierdź zmianę email - Sellf` |
| `mailer_subjects_invite` | `Zaproszenie do Sellf` |

## Testowanie

Po skonfigurowaniu szablonów przetestuj każdy typ emaila:

1. **Magic Link**: Zaloguj się przez "Wyślij magic link"
2. **Confirmation**: Zarejestruj nowe konto
3. **Recovery**: Użyj "Zapomniałem hasła"
4. **Email Change**: Zmień email w ustawieniach konta
5. **Invite**: Zaproś użytkownika (jeśli funkcja włączona)

## Branding

Szablony używają kolorystyki Sellf:
- Gradient: `#1e293b` → `#581c87` → `#1e293b`
- Akcent: `#7c3aed` (fioletowy)
- Sukces: `#10b981` (zielony)
- Ostrzeżenie: `#f59e0b` (żółty)
- Błąd: `#dc2626` (czerwony)

Aby zmienić logo, zaktualizuj URL w szablonach:
```html
<img src="{{ .SiteURL }}/icon.png" ...>
```
