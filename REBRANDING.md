# Rebranding Plan: GateFlow → Sellf

**Branch:** `feature/rebranding-sellf` (odbity z `feature/product-listed-flag`)
**Status:** Kod ukończony ✅ — pozostaje GitHub repo rename + deploy

---

## Mapowanie domen i emaili

| Stare | Nowe |
|-------|------|
| `gateflow.cytr.us` | `demo.sellf.app` |
| `app.gateflow.io` | `demo.sellf.app` |
| `gateflow.io` | `sellf.app` |
| `gateflow.pl` | `sellf.app` |
| `demo@gateflow.io` | `demo@sellf.app` |
| `support@gateflow.pl` | `support@sellf.app` |

---

## Mapowanie nazw (wszystkie warianty)

| Szukaj (regex) | Zamień na | Uwagi |
|----------------|-----------|-------|
| `GateFlow` | `Sellf` | PascalCase |
| `gateflow` | `sellf` | lowercase |
| `GATEFLOW` | `SELLF` | UPPERCASE (jeśli wystąpi) |
| `Gateflow` | `Sellf` | Sentence case — uwaga: grep case-sensitive |
| `gate-flow` | `sellf` | kebab-case (jeśli wystąpi) |
| `gate_flow` | `sellf` | snake_case (jeśli wystąpi) |

### Czego NIE zmieniamy

| Zostawić | Powód |
|----------|-------|
| `gatekeeper` / `GateKeeper` | Nazwa SDK — zmiana zerwie istniejące integracje klientów |
| `data-gatekeeper-product="..."` | HTML atrybut w stronach klientów |
| `/api/gatekeeper` | Endpoint URL — backward compat dla klientów |

### Decyzje (FINALNE)

| Element | Decyzja |
|---------|---------|
| Format licencji | `GF-` → `SF-` ✅ |
| GitHub repo | rename `jurczykpawel/gateflow` → `jurczykpawel/sellf` ✅ |
| Deploy skrypty | rename `deploy-gateflow.sh` → `deploy-sellf.sh` itd. ✅ |
| Migracje SQL | bezpośredni replace w plikach + `supabase db reset` (nie ALTER TABLE) ✅ |

---

## Specjalne przypadki (nie zwykły replace)

### 1. Kolumna DB: `gateflow_license` → `sellf_license`
**Wymaga:** migracji SQL + regeneracji typów TypeScript

Pliki do zmiany po migracji:
- `supabase/migrations/` — nowy plik migracji (ALTER TABLE + rename column)
- `admin-panel/src/types/database.ts` — regeneracja: `npx supabase gen types typescript --local`
- `admin-panel/src/lib/validations/integrations.ts` — klucz `gateflow_license` w schemacie Zod
- `admin-panel/src/lib/actions/integrations.ts` — odwołanie do pola
- `admin-panel/src/lib/actions/theme.ts` — `.select('gateflow_license')`
- `admin-panel/src/lib/theme-loader.ts` — `.select('gateflow_license')`
- `admin-panel/src/app/[locale]/checkout/[slug]/page.tsx` — `.select('gateflow_license')`
- `admin-panel/src/app/api/gatekeeper/route.ts` — `.select('gateflow_license')`
- `admin-panel/src/components/settings/LicenseSettings.tsx` — wszystkie referencje
- `admin-panel/tests/license-settings.spec.ts` — testy E2E
- `admin-panel/tests/unit/lib/validations/integrations.test.ts` — testy unit
- `admin-panel/tests/watermark-visibility.spec.ts`

### 2. Cookie consent: `gateflow_consent` → `sellf_consent`
**Skutek zmiany:** wszyscy istniejący użytkownicy zobaczą banner cookie ponownie (tracą stan zgody)
**Pliki:**
- `admin-panel/src/components/TrackingProvider.tsx:126` — `cookieName: 'gateflow_consent'`
- `admin-panel/src/lib/tracking/client.ts:34` — `startsWith('gateflow_consent=')`
- `admin-panel/tests/helpers/consent.ts` — 3 miejsca
- `admin-panel/docs/COOKIE-CONSENT.md` — dokumentacja

### 3. Custom JS events: `gateflow_*` → `sellf_*`
**Lokalizacja:** `gatekeeper.js:46-57`
**Skutek zmiany:** jeśli ktoś ma GTM/analitykę nasłuchującą na te eventy — przestanie działać.
Dla nowych klientów bez znaczenia.

```js
// Zmienić:
ACCESS_GRANTED:      'gateflow_access_granted'     → 'sellf_access_granted'
ACCESS_DENIED:       'gateflow_access_denied'       → 'sellf_access_denied'
LOGIN_SHOWN:         'gateflow_login_shown'         → 'sellf_login_shown'
MAGIC_LINK_SENT:     'gateflow_magic_link_sent'     → 'sellf_magic_link_sent'
FREE_ACCESS_GRANTED: 'gateflow_free_access_granted' → 'sellf_free_access_granted'
ELEMENT_PROTECTED:   'gateflow_element_protected'   → 'sellf_element_protected'
ELEMENT_ACCESSED:    'gateflow_element_accessed'    → 'sellf_element_accessed'
BATCH_CHECK:         'gateflow_batch_check'         → 'sellf_batch_check'
ERROR:               'gateflow_error'               → 'sellf_error'
PERFORMANCE:         'gateflow_performance'         → 'sellf_performance'
LICENSE_VALID:       'gateflow_license_valid'       → 'sellf_license_valid'
LICENSE_INVALID:     'gateflow_license_invalid'     → 'sellf_license_invalid'
```

Także linia 452 w gatekeeper.js: `gateflow_version: CONSTANTS.VERSION`

### 4. `powered_by` watermark w gatekeeper.js
**Lokalizacja:** `gatekeeper.js:80`
```js
powered_by: 'Powered by GateFlow'  →  'Powered by Sellf'
```

---

## Pliki do zmiany — lista według kategorii

### A. User-facing UI (PRIORYTET 1)

**Komponenty React z hardkodowanymi URL-ami:**
- `admin-panel/src/components/GateFlowBranding.tsx`
  - tekst "GateFlow", link `gateflow.cytr.us?ref=checkout` → `demo.sellf.app`
- `admin-panel/src/app/[locale]/about/components/HeroSection.tsx`
  - link `gateflow.cytr.us/login` → `demo.sellf.app/login`
- `admin-panel/src/app/[locale]/about/components/SocialProofBar.tsx`
  - link `gateflow.cytr.us/login`
- `admin-panel/src/app/[locale]/about/components/SelfHostedComparison.tsx`
  - link `gateflow.cytr.us/login`
- `admin-panel/src/components/settings/LicenseSettings.tsx`
  - tekst i link do `gateflow.cytr.us`
- `admin-panel/src/app/[locale]/about/components/FeeComparisonSection.tsx`
  - zmienna `gateflowFee`, klucz `gateflow` w labelMap → `sellf`

**i18n (en.json i pl.json) — ~14 kluczy:**
- `admin-panel/src/messages/en.json`
- `admin-panel/src/messages/pl.json`

Klucze do zmiany (nazwy kluczy + wartości):
```
getGateflow         → getSellf
gateflow (sekcja)   → sellf
gateflowLabel       → sellfLabel
gateflowFeeNote     → sellfFeeNote
gateflowTitle       → sellfTitle
gateflowSubtitle    → sellfSubtitle
gateflowPlatformFees → sellfPlatformFees
gateflowFeeAmount   → sellfFeeAmount
gateflowStripeFees  → sellfStripeFees
gateflowStripeAmount → sellfStripeAmount
gateflowDataOwnership → sellfDataOwnership
gateflowTaxThresholds → sellfTaxThresholds
gateflowSelfHosted  → sellfSelfHosted
```
Wartości: "GateFlow" → "Sellf", "gateflow.cytr.us" → "demo.sellf.app", "demo@gateflow.io" → "demo@sellf.app"

**Demo email w LoginForm:**
- `admin-panel/src/components/LoginForm.tsx` — `demo@gateflow.io` → `demo@sellf.app`

### B. Publiczne pliki HTML/CSS

- `index.html` — `<title>Gateflow</title>` + treść
- `templates/index.html` — tytuł, nagłówek
- `templates/README.md` — nagłówek

### C. Konfiguracja projektu (PRIORYTET 2)

- `package.json` (root) — `"name": "gateflow"` → `"sellf"`, opis, repo URL
- `admin-panel/package.json` — sprawdzić czy jest "gateflow"
- `admin-panel/next.config.ts` — sprawdzić

**Meta tagi i SEO:**
- `admin-panel/src/app/[locale]/layout.tsx` — `<title>`, `<meta>` description, OpenGraph
- `admin-panel/public/` — favicon, manifest.json (jeśli zawierają "GateFlow")

### D. SDK gatekeeper.js (PRIORYTET 2)

- Linie 2, 18 — komentarze nagłówkowe: "GateFlow", URL-e
- Linia 46-57 — event names (`gateflow_*` → `sellf_*`)
- Linia 80 — `powered_by: 'Powered by GateFlow'`
- Linia 452 — `gateflow_version`
- Linia 1690 — `error.stack?.includes('gateflow')`

### E. Dokumentacja (PRIORYTET 3)

- `README.md` — ~25 zmian (tytuł, sekcje, linki)
- `docs/DEPLOYMENT.md`
- `docs/DEPLOYMENT-MIKRUS.md`
- `docs/DOCKER-SIMPLE.md`
- `docs/FULL-STACK.md`
- `docs/PM2-VPS.md`
- `docs/COOKIE-CONSENT.md`
- `AGENTS.md` / `CLAUDE.md` (symlink) — nazwa projektu, opisy

### F. Migracja DB (PRIORYTET 2 — zrobić przed PR merge)

Nowy plik: `supabase/migrations/YYYYMMDDHHMMSS_rename_gateflow_license.sql`
```sql
ALTER TABLE payment_config
  RENAME COLUMN gateflow_license TO sellf_license;
```
Po migracji: `npx supabase gen types typescript --local > admin-panel/src/types/database.ts`

### G. Migracje SQL — replace w plikach + db reset

Zamiast pisać ALTER TABLE, robimy bezpośredni replace we wszystkich plikach migracji:
```bash
# Przykładowe komendy (wykonać w katalogu gateflow/)
sed -i '' 's/gateflow_license/sellf_license/g' supabase/migrations/*.sql
sed -i '' 's/gateflow_consent/sellf_consent/g' supabase/migrations/*.sql
sed -i '' 's/GF-/SF-/g' supabase/migrations/*.sql   # format licencji
# następnie:
npx supabase db reset
npx supabase gen types typescript --local > admin-panel/src/types/database.ts
```

### H. GitHub repo rename
- `jurczykpawel/gateflow` → `jurczykpawel/sellf`
- Po rename: update `GITHUB_REPO` w `mikrus-toolbox/apps/gateflow/update.sh`
  ```bash
  GITHUB_REPO="jurczykpawel/sellf"
  ```

### I. Mikrus-toolbox (osobne repo)

- `apps/gateflow/README.md` — tytuł i treść
- `apps/gateflow/update.sh` — komentarze + `GITHUB_REPO="jurczykpawel/sellf"`
- `local/deploy-gateflow.sh` → rename na `deploy-sellf.sh` ✅
- `local/setup-gateflow-config.sh` → rename na `setup-sellf-config.sh`
- Config lokalny: `~/.config/gateflow/` → `~/.config/sellf/`
  ```bash
  cp -r ~/.config/gateflow/ ~/.config/sellf/
  # update deploy-gateflow.sh żeby czytał z ~/.config/sellf/
  ```

### J. Walidacja formatu licencji

- `admin-panel/src/lib/validations/integrations.ts:75`
  ```ts
  // Regex: /^GF-[a-zA-Z0-9.*-]+-(?:UNLIMITED|\d{8})-[A-Za-z0-9_-]+$/
  // → /^SF-[a-zA-Z0-9.*-]+-(?:UNLIMITED|\d{8})-[A-Za-z0-9_-]+$/
  ```
- `admin-panel/tests/unit/lib/validations/integrations.test.ts` — zamienić `GF-` na `SF-` w testowych kluczach

---

## Kolejność wykonania

1. **Replace w migracjach SQL** + `supabase db reset` + regeneracja typów TS
2. **Zwykły replace w kodzie** (skryptami lub ręcznie):
   - `gateflow` → `sellf` (lowercase) we wszystkich `.ts`, `.tsx`, `.js`
   - `GateFlow` → `Sellf` we wszystkich `.ts`, `.tsx`, `.js`, `.md`, `.html`
   - `GF-` → `SF-` w walidacji i testach
   - URL-e i emaile według mapowania
3. **Klucze i18n** — rename kluczy + update wszystkich `t('gateflowXxx')` w komponentach
4. **Mikrus-toolbox** — rename plików + update zawartości
5. **Testy:**
   - `bun run typecheck`
   - `bun run build`
   - `bun run test:unit`
   - `bun run test:smoke`
6. **GitHub repo rename** (na końcu — żeby CI nadal działało podczas zmian)
7. **Deploy na serwer** po merge

---

## Grep commands do weryfikacji po rebrandingu

```bash
# Sprawdź czy coś zostało pominięte
grep -r "GateFlow" admin-panel/src --include="*.ts" --include="*.tsx" -l
grep -r "gateflow" admin-panel/src --include="*.ts" --include="*.tsx" -l
grep -r "gateflow\.pl\|gateflow\.io\|gateflow\.cytr" admin-panel/src -l
grep -r "gateflow" admin-panel/src/messages/ -l

# Sprawdź czy gatekeeper (zostaje) nie został nadpisany
grep -r "sellf-keeper\|sellfkeeper\|sellf_keeper" admin-panel/src -l  # powinno być 0 wyników
```

---

## Decyzje — wszystkie rozstrzygnięte ✅

| Element | Decyzja |
|---------|---------|
| Format licencji `GF-` | → `SF-` ✅ |
| `deploy-gateflow.sh` | → `deploy-sellf.sh` ✅ |
| `setup-gateflow-config.sh` | → `setup-sellf-config.sh` ✅ |
| Katalog `apps/gateflow/` | zostaje (wewnętrzna nazwa mikrus-toolbox) |
| GitHub repo rename | `jurczykpawel/gateflow` → `jurczykpawel/sellf` ✅ |
| Migracje SQL | replace w plikach + db reset, nie ALTER TABLE ✅ |
| `AGENTS.md` / `CLAUDE.md` | zmienić nazwy na Sellf ✅ |
