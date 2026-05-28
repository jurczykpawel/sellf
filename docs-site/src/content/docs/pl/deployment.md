---
title: "Opcje wdrożenia"
description: "Ta strona pokazuje wszystkie wspierane sposoby na postawienie Sellfa online, w kolejności od najprostszego (kilka kliknięć w przeglądarce) do najbardziej…"
---

**Język:** 🇵🇱 Polski · [🇬🇧 English](/deployment/)


Ta strona pokazuje wszystkie wspierane sposoby na postawienie Sellfa online, w kolejności od najprostszego (kilka kliknięć w przeglądarce) do najbardziej technicznego (komendy w terminalu na serwerze). Wszystkie dają działający sklep Sellf.

## 👋 Pierwszy raz? Zacznij tu

**[QUICK-START.md](/pl/quick-start/)** — Przewodnik klik-po-kliku używający tylko przeglądarki. Bez terminala. Wdraża na Vercel + Supabase + Stripe w ~20 minut. **To najprostsza ścieżka dla osób nietechnicznych.**

## Konfiguracja Supabase (używana przez wszystkie przewodniki wdrożenia)

**[SUPABASE-SETUP.md](/pl/supabase-setup/)** — Wyjaśnia trzy sposoby konfiguracji bazy danych której Sellf używa (tylko przeglądarka, kopiuj-wklej, albo przez skrypt). Przeczytaj jeśli nie jesteś pewien którą opcję Supabase wybrać w którymś z poniższych przewodników.

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

### [DEPLOYMENT-COOLIFY.md](/pl/deployment-coolify/) — Coolify (one-click samodzielny hosting)
**Wybierz gdy potrzebujesz:**
- Najbliżej "prawdziwego one-click" — migracje uruchamiają się automatycznie
- Samodzielnego hostingu pełnego stosu (Sellf + Supabase) na własnym VPS
- Auto TLS + auto-deploy na pushu do GitHuba

**Wymagania:** VPS z 8GB+ RAM (4 GB wystarcza na działanie ale build wypada przez OOM — zobacz przewodnik), Coolify zainstalowany (darmowy), 10 min konfiguracja

---

### [FULL-STACK.md](/full-stack/) — Samodzielny Supabase + Docker
**Wybierz gdy potrzebujesz:**
- Pełnej kontroli nad infrastrukturą (11 kontenerów Docker)
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
- Chcesz Docker + Supabase Cloud
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
