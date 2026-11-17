---
title: "Opcje wdrożenia"
description: "Ta strona pokazuje wszystkie wspierane sposoby na postawienie Sellfa online, w kolejności od najprostszego (kilka kliknięć w przeglądarce) do najbardziej…"
---

Włącz **Confirm Email** w Supabase i zainstaluj szablony confirmation oraz magic-link. Zakupy gościa trafiają na konto po potwierdzeniu adresu użytego przy zakupie. Zobacz [konfigurację e-maili](/pl/email-setup/#włącz-potwierdzanie-adresów-e-mail).

> Aktualizacje z panelu: [obsługiwane środowiska, wykrywanie i migracje](/pl/ui-upgrades/). Kontenery nie wykonują migracji przy starcie.


**Język:** 🇵🇱 Polski · [🇬🇧 English](/deployment/)


Ta strona pokazuje wszystkie wspierane sposoby na postawienie Sellfa online, w kolejności od najprostszego (kilka kliknięć w przeglądarce) do najbardziej technicznego (komendy w terminalu na serwerze). Wszystkie dają działający sklep Sellf.

## 👋 Pierwszy raz? Zacznij tu

**[QUICK-START.md](/pl/quick-start/)** — Przewodnik klik-po-kliku używający tylko przeglądarki. Bez terminala. Wdraża na Vercel + Supabase + Stripe w ~20 minut. **To najprostsza ścieżka dla osób nietechnicznych.**

## Konfiguracja Supabase (używana przez wszystkie przewodniki wdrożenia)

**[SUPABASE-SETUP.md](/pl/supabase-setup/)** — Wyjaśnia trzy sposoby konfiguracji bazy danych której Sellf używa (tylko przeglądarka, kopiuj-wklej, albo przez skrypt). Przeczytaj jeśli nie jesteś pewien którą opcję Supabase wybrać w którymś z poniższych przewodników.

## Aktualizacja z 2026.10.6 lub starszej

2026.11.1 wymaga aktualizatora 2, instalowanego przez 2026.11.0. Jeśli Twoja
instalacja PM2 działa na 2026.10.6 lub starszej wersji, najpierw zainstaluj
**pakiet 2026.11.0** z aktualnego lokalnego repozytorium Stackpilot. Zastąp
`<server>` aliasem SSH serwera; przy kilku sklepach dodaj `--instance=<instance>`,
aby wybrać sklep:

```bash
curl -fL -o ./sellf-build-2026.11.0.tar.gz \
  https://github.com/jurczykpawel/sellf/releases/download/v2026.11.0/sellf-build.tar.gz
./local/deploy.sh sellf --ssh=<server> --update --build-file=./sellf-build-2026.11.0.tar.gz
```

Gdy sklep działa już na 2026.11.0, uruchom zwykłą aktualizację z panelu do
2026.11.1. W pierwszym kroku wskaż paczkę jak wyżej: samo `--update` bez
`--build-file` pobiera najnowsze wydanie, którym może już być 2026.11.1.

Na 2026.10.6 komunikat „No sellf-build.manifest asset found in latest release…”
jest spodziewany, gdy najnowsze wydanie wymaga aktualizatora 2. Stary aktualizator
zatrzymuje się przed zmianą kodu i bazy. Użyj wskazanej wyżej paczki 2026.11.0,
zamiast ponawiać tę samą aktualizację z panelu.

## Pozostałe przewodniki wdrożenia

Wybierz w zależności od tego co chcesz.

---

### [DEPLOYMENT-VERCEL-NETLIFY.md](/pl/deployment-vercel-netlify/) — Vercel albo Netlify (zarządzane w chmurze)
**Wybierz gdy potrzebujesz:**
- Najprostszego sposobu zarządzanego — bez utrzymania serwera
- Free tier wystarcza na początek
- Vercel albo Netlify hostuje aplikację, Supabase hostuje bazę

**Wymagania:** brak po Twojej stronie, wszystko w chmurze, ~15-20 min konfiguracja

---

### [DEPLOYMENT-COOLIFY.md](/pl/deployment-coolify/) — Coolify (samodzielny hosting)
**Wybierz gdy potrzebujesz:**
- Sellfa na własnym VPS, ściągniętego jako gotowy obraz (bez budowania)
- Opcjonalnie też samodzielnego Supabase, przez własny szablon Coolify
- Auto TLS + auto-deploy na pushu do GitHuba

**Wymagania:** VPS z 4GB+ RAM (więcej, jeśli obok stawiasz też samodzielny Supabase), Coolify zainstalowany (darmowy), 10 min konfiguracja. Migracje uruchamiasz raz na wydanie, nie automatycznie przy każdym restarcie — zobacz przewodnik.

---

### [FULL-STACK.md](/full-stack/) — Samodzielny Supabase + Docker
**Wybierz gdy potrzebujesz:**
- Pełnej kontroli nad infrastrukturą (własny kontener Sellfa plus oficjalny, samodzielnie hostowany stos Supabase)
- Samodzielnego Supabase (bez zależności od chmury)
- Zgodność RODO (wymagania co do lokalizacji danych)
- Duży ruch (1M+ requestów/miesiąc)

**Wymagania:** 8GB+ RAM, doświadczenie DevOps, 2-3h konfiguracja, ~$50-100/miesiąc

---

### [DEPLOYMENT-MIKRUS.md](/deployment-mikrus/) — VPS / mikr.us przez PM2
**Wybierz gdy potrzebujesz:**
- Najtańszego rozwiązania (35 zł/rok mikr.us)
- Pełnej kontroli nad serwerem
- Lekkiego wdrożenia bez Dockera

**Wymagania:** Linux VPS z 1 GB+ RAM, podstawowa znajomość terminala

---

### [PM2-VPS.md](/pm2-vps/) — Zaawansowany PM2
**Wybierz gdy potrzebujesz:**
- Tryb klastrowy (wykorzystanie wielu rdzeni)
- Wdrożenia bez przestojów
- Zaawansowany monitoring (PM2+, Prometheus, Grafana)
- Auto-skalowanie, rotacja logów, profilowanie CPU/pamięci

**Wymagania:** znajomość PM2, 4GB+ RAM

**Uwaga:** Dla podstawowej konfiguracji PM2 zobacz [DEPLOYMENT-MIKRUS.md](/deployment-mikrus/).

---

### [DOCKER-SIMPLE.md](/docker-simple/) — Prosty Docker
**Wybierz gdy:**
- Chcesz uruchomić gotowy obraz Sellfa przez `docker compose` z Supabase Cloud (albo własnym Supabase)
- Potrzebujesz dokładniejszego opisu niż w głównym przewodniku

---

### [UPSTASH-REDIS.md](/upstash-redis/) — Opcjonalne cache'owanie Redis
**Wybierz gdy chcesz:**
- 10× szybsze zapytania konfiguracji (50-100ms → 5-10ms)
- 50-70% mniejsze obciążenie bazy
- Darmowy plan: 10 000 requestów/dzień

---

## Nie jesteś pewien co wybrać?

**→ Zacznij od [QUICK-START.md](/pl/quick-start/)** — najprostsza ścieżka, sprawdza się dla większości pierwszych wdrożeń.
