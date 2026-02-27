# Szablony Email Sellf

Szablony emaili dla Supabase Auth używane przez Sellf.

## Pliki

| Plik | Przeznaczenie | Pole API |
|------|---------------|----------|
| `magic-link.html` | Login przez email (magic link) | `mailer_templates_magic_link_content` |
| `confirmation.html` | Potwierdzenie rejestracji | `mailer_templates_confirmation_content` |
| `recovery.html` | Reset hasła | `mailer_templates_recovery_content` |
| `email-change.html` | Zmiana adresu email | `mailer_templates_email_change_content` |
| `invite.html` | Zaproszenie do aplikacji | `mailer_templates_invite_content` |

## Konfiguracja

### Opcja 1: Dashboard Supabase

1. Przejdź do **Authentication** → **Email Templates** w dashboardzie Supabase
2. Skopiuj zawartość odpowiedniego pliku HTML
3. Wklej do edytora szablonu
4. Zapisz zmiany

### Opcja 2: Użyj skryptu setup

```bash
cd supabase/templates
./setup-templates.sh
```

Skrypt wymaga zmiennych środowiskowych:
- `SUPABASE_PROJECT_REF` - ID projektu Supabase
- `SUPABASE_ACCESS_TOKEN` - Token dostępu (Management API)

### Opcja 3: API Management

```bash
# Przykład aktualizacji szablonu magic link
curl -X PATCH "https://api.supabase.com/v1/projects/{project_ref}/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mailer_templates_magic_link_content": "<zawartość HTML>"
  }'
```

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
